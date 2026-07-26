import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const ensureVGamesAccount = vi.fn()
vi.mock('../../src/store/statsStore', () => ({
  useStatsStore: { getState: () => ({ ensureVGamesAccount }) },
}))

import { workerFetch, workerBaseUrl, WorkerError } from '../../src/net/http'

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

describe('net/http workerFetch', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    ensureVGamesAccount.mockReset()
  })

  it('defaults the base URL to localhost:8787 when VITE_VJAIPUR_WORKER_URL is unset', () => {
    expect(workerBaseUrl()).toBe('http://localhost:8787')
  })

  it('GETs with no body and no Authorization header when no token is given', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { ok: true }))
    const result = await workerFetch('/health')
    expect(result).toEqual({ ok: true })
    const [url, init] = mockFetch.mock.calls[0]
    expect(String(url)).toBe('http://localhost:8787/health')
    expect(init.method).toBe('GET')
    expect(init.headers.Authorization).toBeUndefined()
    expect(init.body).toBeUndefined()
  })

  it('infers POST when a body is given, and JSON-encodes it', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { gameId: 'ABC123' }))
    await workerFetch('/games', { body: { matchLength: 3 }, token: 'tok-1' })
    const [, init] = mockFetch.mock.calls[0]
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer tok-1')
    expect(JSON.parse(init.body)).toEqual({ matchLength: 3 })
  })

  it('401 -> silently re-authenticates via ensureVGamesAccount, then retries ONCE with the fresh token', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(401, { error: 'unauthorized' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
    ensureVGamesAccount.mockResolvedValueOnce({ token: 'fresh-tok', accountId: 'acc-1' })

    const result = await workerFetch('/games/ABC/sync', { token: 'stale-tok' })

    expect(result).toEqual({ ok: true })
    expect(ensureVGamesAccount).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer stale-tok')
    expect(mockFetch.mock.calls[1][1].headers.Authorization).toBe('Bearer fresh-tok')
  })

  it('401 -> re-auth fails (no account) -> surfaces a WorkerError(401), no further retry', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(401, { error: 'unauthorized' }))
    ensureVGamesAccount.mockResolvedValueOnce(null)

    await expect(workerFetch('/games/ABC/sync', { token: 'stale-tok' })).rejects.toMatchObject({
      status: 401,
      code: expect.stringContaining('unauthorized'),
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('401 -> even after a successful re-auth, a SECOND 401 is surfaced (only one retry)', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(401, { error: 'unauthorized' }))
      .mockResolvedValueOnce(jsonResponse(401, { error: 'unauthorized' }))
    ensureVGamesAccount.mockResolvedValueOnce({ token: 'fresh-tok', accountId: 'acc-1' })

    await expect(workerFetch('/games/ABC/sync', { token: 'stale-tok' })).rejects.toBeInstanceOf(WorkerError)
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(ensureVGamesAccount).toHaveBeenCalledTimes(1)
  })

  it('GET retries on 5xx with backoff (2 tries) before succeeding', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(500, { error: 'boom' }))
      .mockResolvedValueOnce(jsonResponse(502, { error: 'boom' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))

    const result = await workerFetch('/stats/leaderboard')
    expect(result).toEqual({ ok: true })
    expect(mockFetch).toHaveBeenCalledTimes(3)
  }, 10_000)

  it('GET gives up after exhausting 5xx retries and throws a WorkerError', async () => {
    mockFetch.mockResolvedValue(jsonResponse(500, { error: 'boom' }))
    await expect(workerFetch('/stats/leaderboard')).rejects.toMatchObject({ status: 500 })
    // initial + 2 retries = 3 attempts
    expect(mockFetch).toHaveBeenCalledTimes(3)
  }, 10_000)

  it('GET retries on a network error (fetch rejection), then succeeds', async () => {
    mockFetch
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
    const result = await workerFetch('/stats/leaderboard')
    expect(result).toEqual({ ok: true })
    expect(mockFetch).toHaveBeenCalledTimes(2)
  }, 10_000)

  it('a plain POST does NOT retry on 5xx by default (not automatically idempotent)', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(500, { error: 'boom' }))
    await expect(workerFetch('/games', { body: { matchLength: 1 } })).rejects.toMatchObject({ status: 500 })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('a POST opted into retryOn5xx (e.g. /move) DOES retry on 5xx', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(500, { error: 'boom' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
    const result = await workerFetch('/games/ABC/move', { body: { seatIndex: 0 }, retryOn5xx: true })
    expect(result).toEqual({ ok: true })
    expect(mockFetch).toHaveBeenCalledTimes(2)
  }, 10_000)

  it('a non-2xx, non-401 response throws a WorkerError carrying the worker error code', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(409, { error: 'not_your_turn' }))
    await expect(workerFetch('/games/ABC/move', { body: {} })).rejects.toMatchObject({
      status: 409,
      code: 'not_your_turn',
    })
  })

  it('falls back to a synthetic http_<status> code when the body has no error field', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) } as Response)
    await expect(workerFetch('/resolve?code=ZZZZZZ')).rejects.toMatchObject({ status: 404, code: 'http_404' })
  })
})

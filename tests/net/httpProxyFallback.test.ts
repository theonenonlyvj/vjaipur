import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// workerFetch only touches the stats store on a 401 — none of these tests
// 401, but the module import still needs the mock (same pattern as
// tokenRefresh.test.ts).
const ensureVGamesAccount = vi.fn()
vi.mock('../../src/store/statsStore', () => ({
  useStatsStore: { getState: () => ({ ensureVGamesAccount }) },
}))

import { workerFetch, workerBaseUrl, __setProxyBaseForTests } from '../../src/net/http'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function htmlResponse(): Response {
  // What the SPA catch-all serves for /api/* until the Render Blueprint is
  // synced: index.html with a 200.
  return new Response('<!doctype html><html></html>', {
    status: 200,
    headers: { 'content-type': 'text/html' },
  })
}

const networkDown = () => Promise.reject(new TypeError('Load failed'))

beforeEach(() => {
  fetchMock.mockReset()
  __setProxyBaseForTests('/api') // pretend PROD same-origin deployment
})

afterEach(() => {
  __setProxyBaseForTests(undefined)
})

describe('same-origin proxy fallback (workers.dev blocked on-device)', () => {
  it('retries a network-level throw through /api and succeeds; later calls go proxy-first', async () => {
    fetchMock.mockImplementation((url: string) =>
      String(url).startsWith('/api') ? Promise.resolve(jsonResponse({ ok: 1 })) : networkDown(),
    )

    const out = await workerFetch<{ ok: number }>('/games', { method: 'POST', body: {} })
    expect(out).toEqual({ ok: 1 })
    expect(fetchMock).toHaveBeenNthCalledWith(1, `${workerBaseUrl()}/games`, expect.anything())
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/games', expect.anything())

    // Sticky: the device is workers.dev-blocked — don't pay the failed direct
    // attempt on every call.
    fetchMock.mockClear()
    fetchMock.mockResolvedValue(jsonResponse({ ok: 2 }))
    const out2 = await workerFetch<{ ok: number }>('/games', { method: 'POST', body: {} })
    expect(out2).toEqual({ ok: 2 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/games', expect.anything())
  })

  it('rethrows the ORIGINAL network error when the proxy serves HTML (Blueprint not synced)', async () => {
    fetchMock.mockImplementation((url: string) =>
      String(url).startsWith('/api') ? Promise.resolve(htmlResponse()) : networkDown(),
    )

    await expect(workerFetch('/games', { method: 'POST', body: {} })).rejects.toThrow('Load failed')
    // And it did NOT go sticky — the next call tries direct first again.
    fetchMock.mockClear()
    fetchMock.mockResolvedValue(jsonResponse({ ok: 3 }))
    await workerFetch('/games', { method: 'POST', body: {} })
    expect(fetchMock).toHaveBeenCalledWith(`${workerBaseUrl()}/games`, expect.anything())
  })

  it('rethrows the original error when the proxy is also unreachable', async () => {
    fetchMock.mockImplementation(() => networkDown())
    await expect(workerFetch('/games', { method: 'POST', body: {} })).rejects.toThrow('Load failed')
  })

  it('no proxy configured (dev / explicit worker URL): network errors propagate untouched', async () => {
    __setProxyBaseForTests(null)
    fetchMock.mockImplementation(() => networkDown())
    await expect(workerFetch('/games', { method: 'POST', body: {} })).rejects.toThrow('Load failed')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('proxy-first mode self-heals back to direct if the proxy stops serving JSON', async () => {
    // Arm stickiness.
    fetchMock.mockImplementation((url: string) =>
      String(url).startsWith('/api') ? Promise.resolve(jsonResponse({ ok: 1 })) : networkDown(),
    )
    await workerFetch('/games', { method: 'POST', body: {} })

    // Proxy regresses to HTML (rollback); direct works again.
    fetchMock.mockClear()
    fetchMock.mockImplementation((url: string) =>
      String(url).startsWith('/api')
        ? Promise.resolve(htmlResponse())
        : Promise.resolve(jsonResponse({ ok: 4 })),
    )
    const out = await workerFetch<{ ok: number }>('/games', { method: 'POST', body: {} })
    expect(out).toEqual({ ok: 4 })
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/games', expect.anything())
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${workerBaseUrl()}/games`, expect.anything())
  })
})

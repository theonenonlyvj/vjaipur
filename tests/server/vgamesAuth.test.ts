import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { introspect, resolveSocketIdentity } from '../../server/vgamesAuth'

function jsonResponse(status: number, body: any): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

const VGAMES_URL = 'https://vgames.example'

describe('introspect', () => {
  beforeEach(() => { mockFetch.mockReset() })

  it('POSTs the token to /auth/introspect and returns the parsed result', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { valid: true, accountId: 'acc1', status: 'claimed' }))

    const result = await introspect('tok123', VGAMES_URL)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(String(url)).toBe(`${VGAMES_URL}/auth/introspect`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ token: 'tok123' })
    expect(result).toEqual({ valid: true, accountId: 'acc1', status: 'claimed' })
  })

  it('returns valid:false for a rejected token', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { valid: false }))
    expect(await introspect('bad', VGAMES_URL)).toEqual({ valid: false, accountId: undefined, status: undefined })
  })

  it('fails closed (valid:false) on a non-ok HTTP response', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(500, {}))
    expect(await introspect('tok', VGAMES_URL)).toEqual({ valid: false })
  })

  it('fails closed (valid:false) on a network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network down'))
    expect(await introspect('tok', VGAMES_URL)).toEqual({ valid: false })
  })
})

describe('resolveSocketIdentity', () => {
  beforeEach(() => { mockFetch.mockReset() })

  it('returns null when no token is present (unauthenticated / anonymous)', async () => {
    expect(await resolveSocketIdentity(undefined, VGAMES_URL)).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('rejects a token that fails introspection', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { valid: false }))
    expect(await resolveSocketIdentity('bad-token', VGAMES_URL)).toBeNull()
  })

  it('rejects a merged account even if the token itself is structurally valid', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { valid: true, accountId: 'acc1', status: 'merged' }))
    expect(await resolveSocketIdentity('tok', VGAMES_URL)).toBeNull()
  })

  it('accepts a valid, non-merged token and returns the canonical identity', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { valid: true, accountId: 'acc1', status: 'claimed' }))
    expect(await resolveSocketIdentity('tok', VGAMES_URL)).toEqual({ accountId: 'acc1', status: 'claimed' })
  })
})

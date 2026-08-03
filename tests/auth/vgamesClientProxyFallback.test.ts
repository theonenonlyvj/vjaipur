// Mirrors tests/net/httpProxyFallback.test.ts — BUG 1 (2026-08-03): identity
// calls (src/auth/vgamesClient.ts) now share the same blocked-device
// same-origin proxy fallback that game calls (src/net/http.ts) already had,
// via the extracted src/net/proxyFallback.ts core.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { vgamesQuick, vgamesBaseUrl, __setIdProxyBaseForTests } from '../../src/auth/vgamesClient'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function htmlResponse(): Response {
  // What the SPA catch-all serves for /id-api/* until the Render Blueprint
  // is synced: index.html with a 200.
  return new Response('<!doctype html><html></html>', {
    status: 200,
    headers: { 'content-type': 'text/html' },
  })
}

const networkDown = () => Promise.reject(new TypeError('Load failed'))

beforeEach(() => {
  fetchMock.mockReset()
  __setIdProxyBaseForTests('/id-api') // pretend PROD same-origin deployment
})

afterEach(() => {
  __setIdProxyBaseForTests(undefined)
})

describe('vgamesClient same-origin proxy fallback (workers.dev blocked on-device)', () => {
  it('retries a network-level throw through /id-api and succeeds; later calls go proxy-first', async () => {
    fetchMock.mockImplementation((url: string) =>
      String(url).startsWith('/id-api') ? Promise.resolve(jsonResponse({ token: 'tok-1', accountId: 'acc-1' })) : networkDown(),
    )

    const out = await vgamesQuick('cred-aaaa', 'Neo')
    expect(out).toEqual({ token: 'tok-1', accountId: 'acc-1', status: undefined })
    expect(fetchMock).toHaveBeenNthCalledWith(1, `${vgamesBaseUrl()}/auth/quick`, expect.anything())
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/id-api/auth/quick', expect.anything())

    // Sticky: the device is workers.dev-blocked — don't pay the failed direct
    // attempt on every call.
    fetchMock.mockClear()
    fetchMock.mockResolvedValue(jsonResponse({ token: 'tok-2', accountId: 'acc-1' }))
    const out2 = await vgamesQuick('cred-aaaa', 'Neo')
    expect(out2.token).toBe('tok-2')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/id-api/auth/quick', expect.anything())
  })

  it('rethrows the ORIGINAL network error when the proxy serves HTML (Blueprint not synced)', async () => {
    fetchMock.mockImplementation((url: string) =>
      String(url).startsWith('/id-api') ? Promise.resolve(htmlResponse()) : networkDown(),
    )

    await expect(vgamesQuick('cred', 'Name')).rejects.toThrow('Load failed')

    // And it did NOT go sticky — the next call tries direct first again.
    fetchMock.mockClear()
    fetchMock.mockResolvedValue(jsonResponse({ token: 'tok-3', accountId: 'acc-1' }))
    await vgamesQuick('cred', 'Name')
    expect(fetchMock).toHaveBeenCalledWith(`${vgamesBaseUrl()}/auth/quick`, expect.anything())
  })

  it('rethrows the original error when the proxy is also unreachable', async () => {
    fetchMock.mockImplementation(() => networkDown())
    await expect(vgamesQuick('cred', 'Name')).rejects.toThrow()
  })

  it('no proxy configured (dev / explicit VITE_VGAMES_URL): network errors propagate untouched', async () => {
    __setIdProxyBaseForTests(null)
    fetchMock.mockImplementation(() => networkDown())
    await expect(vgamesQuick('cred', 'Name')).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('proxy-first mode self-heals back to direct if the proxy stops serving JSON', async () => {
    // Arm stickiness.
    fetchMock.mockImplementation((url: string) =>
      String(url).startsWith('/id-api') ? Promise.resolve(jsonResponse({ token: 'tok-1', accountId: 'acc-1' })) : networkDown(),
    )
    await vgamesQuick('cred', 'Name')

    // Proxy regresses to HTML (rollback); direct works again.
    fetchMock.mockClear()
    fetchMock.mockImplementation((url: string) =>
      String(url).startsWith('/id-api')
        ? Promise.resolve(htmlResponse())
        : Promise.resolve(jsonResponse({ token: 'tok-4', accountId: 'acc-1' })),
    )
    const out = await vgamesQuick('cred', 'Name')
    expect(out.token).toBe('tok-4')
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/id-api/auth/quick', expect.anything())
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${vgamesBaseUrl()}/auth/quick`, expect.anything())
  })
})

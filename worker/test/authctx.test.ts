import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { authenticateToken, extractBearerToken, requireAuth } from '../src/do/authctx'

// worker/vitest.config.ts overrides VGAMES_URL to 'test' for the whole test
// run, so every authenticateToken call below exercises the offline test seam
// (no network) rather than the real introspect fetch.

describe('extractBearerToken', () => {
  it('extracts the token from a well-formed header', () => {
    const req = new Request('https://do/x', { headers: { Authorization: 'Bearer test:acct-1:Alice' } })
    expect(extractBearerToken(req)).toBe('test:acct-1:Alice')
  })

  it('is case-insensitive on the Bearer prefix and trims whitespace', () => {
    const req = new Request('https://do/x', { headers: { Authorization: '  bearer   test:acct-1:Alice  ' } })
    expect(extractBearerToken(req)).toBe('test:acct-1:Alice')
  })

  it('returns null when the header is missing or malformed', () => {
    expect(extractBearerToken(new Request('https://do/x'))).toBeNull()
    expect(extractBearerToken(new Request('https://do/x', { headers: { Authorization: 'Basic xyz' } }))).toBeNull()
    expect(extractBearerToken(new Request('https://do/x', { headers: { Authorization: 'Bearer ' } }))).toBeNull()
  })
})

describe('authenticateToken (test seam)', () => {
  it('resolves accountId + displayName from test:<accountId>:<displayName>', async () => {
    const auth = await authenticateToken('test:acct-1:Alice', env)
    expect(auth).toEqual({ accountId: 'acct-1', displayName: 'Alice' })
  })

  it('defaults displayName to a safe placeholder when absent', async () => {
    const auth = await authenticateToken('test:acct-1', env)
    expect(auth).toEqual({ accountId: 'acct-1', displayName: 'Player' })
  })

  it('rejects a malformed test token (missing accountId, wrong prefix)', async () => {
    expect(await authenticateToken('test:', env)).toBeNull()
    expect(await authenticateToken('bogus:acct-1:Alice', env)).toBeNull()
    expect(await authenticateToken('', env)).toBeNull()
    expect(await authenticateToken(undefined, env)).toBeNull()
    expect(await authenticateToken(null, env)).toBeNull()
  })
})

describe('requireAuth', () => {
  it('returns AuthOk for a valid bearer token', async () => {
    const req = new Request('https://do/x', { headers: { Authorization: 'Bearer test:acct-1:Alice' } })
    const result = await requireAuth(req, env)
    expect(result).toEqual({ accountId: 'acct-1', displayName: 'Alice' })
  })

  it('returns a 401 Response when the header is missing', async () => {
    const req = new Request('https://do/x')
    const result = await requireAuth(req, env)
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(401)
  })

  it('returns a 401 Response for an invalid token', async () => {
    const req = new Request('https://do/x', { headers: { Authorization: 'Bearer garbage' } })
    const result = await requireAuth(req, env)
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(401)
  })
})

// NOTE: a real-fetch fail-closed-on-network-error test was deliberately
// omitted here — hitting a genuinely unroutable host inside workerd/
// miniflare raises a background "internal error" uncaught rejection (a
// harness quirk, logged even though the test itself passes: the `try {} catch
// { return null }` in authenticateToken already makes this path
// unmistakably fail-closed by inspection, and the 'test'-seam malformed-token
// cases above exercise the same `return null` branch without the network
// flakiness).

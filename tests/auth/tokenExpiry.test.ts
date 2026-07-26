import { describe, it, expect } from 'vitest'
import { decodeJwtExp } from '../../src/auth/tokenExpiry'

// Builds a syntactically-real (unsigned) JWT string for decode tests — the
// helper under test never verifies the signature, only reads the payload.
function makeJwt(payload: unknown, opts: { corruptPayload?: boolean } = {}): string {
  const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' })).replace(/=+$/, '')
  const body = opts.corruptPayload
    ? 'not-valid-base64url!!!'
    : btoa(JSON.stringify(payload)).replace(/=+$/, '')
  return `${header}.${body}.signature`
}

describe('decodeJwtExp', () => {
  it('decodes the exp claim (epoch seconds) from a well-formed JWT', () => {
    const exp = 1_800_000_000
    const token = makeJwt({ sub: 'acc-1', aud: 'vgames-web', iss: 'vgames', exp })
    expect(decodeJwtExp(token)).toBe(exp)
  })

  it('returns null for null/undefined/empty input', () => {
    expect(decodeJwtExp(null)).toBeNull()
    expect(decodeJwtExp(undefined)).toBeNull()
    expect(decodeJwtExp('')).toBeNull()
  })

  it('returns null for a non-JWT string (no dots)', () => {
    expect(decodeJwtExp('vg-tok-1')).toBeNull()
  })

  it('returns null for a JWT-shaped string with an unparsable payload segment', () => {
    const token = makeJwt({}, { corruptPayload: true })
    expect(decodeJwtExp(token)).toBeNull()
  })

  it('returns null when the payload is valid JSON but has no exp claim', () => {
    const token = makeJwt({ sub: 'acc-1' })
    expect(decodeJwtExp(token)).toBeNull()
  })

  it('returns null when exp is present but not a number', () => {
    const token = makeJwt({ exp: 'soon' })
    expect(decodeJwtExp(token)).toBeNull()
  })

  it('never throws on garbage input', () => {
    expect(() => decodeJwtExp('...')).not.toThrow()
    expect(() => decodeJwtExp('a.b')).not.toThrow()
    expect(() => decodeJwtExp('a.b.c.d')).not.toThrow()
    expect(decodeJwtExp('...')).toBeNull()
    expect(decodeJwtExp('a.b')).toBeNull()
    expect(decodeJwtExp('a.b.c.d')).toBeNull()
  })
})

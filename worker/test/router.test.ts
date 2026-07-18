import { env, SELF } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  authenticateToken,
  INTROSPECT_CACHE_MAX_ENTRIES,
  INTROSPECT_CACHE_TTL_MS,
  __introspectCacheForTest,
} from '../src/do/authctx'
import { corsHeaders, handlePreflight } from '../src/do/cors'
import { applyD1Schema } from './helpers'

const DB = () => (env as unknown as { DB: D1Database }).DB

beforeAll(async () => {
  await applyD1Schema(DB())
})

// ---- test-only request helper (mirrors online-flow.test.ts's `req`) --------

function req(
  path: string,
  opts: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Request {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) }
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  return new Request(`https://worker${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
}

async function readJson(res: Response): Promise<any> {
  return res.json()
}

/** Always-legal greedy auto-move (test-only harness logic — mirrors
 *  online-flow.test.ts's `pickAutoMove`, duplicated here rather than shared
 *  since that file belongs to Wave 2 and isn't ours to import from). */
function pickAutoMove(game: { market: { type: string }[]; myHand: { type: string }[] }): Record<string, unknown> {
  const camelIdx = game.market.findIndex((c) => c.type === 'camel')
  if (camelIdx !== -1) return { type: 'TAKE_CAMELS' }
  if (game.myHand.length < 7) {
    const idx = game.market.findIndex((c) => c.type !== 'camel')
    if (idx !== -1) return { type: 'TAKE_SINGLE', marketIndex: idx }
  }
  const PRECIOUS = new Set(['diamond', 'gold', 'silver'])
  const counts = new Map<string, number>()
  for (const c of game.myHand) counts.set(c.type, (counts.get(c.type) ?? 0) + 1)
  for (const [good, count] of counts) {
    const minQty = PRECIOUS.has(good) ? 2 : 1
    if (count >= minQty) return { type: 'SELL', good, quantity: count }
  }
  throw new Error('pickAutoMove: no legal move found (should be unreachable)')
}

let ctr = 0
function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${ctr++}`
}

// =============================================================================
// Router: create / resolve / forward / health
// =============================================================================

describe('POST /games + GET /resolve + /games/:id/* forwarding', () => {
  it('creates a game (gameId === code), resolves it by code, and forwards /join + /sync + /move through to the DO', async () => {
    const alice = `test:${uniqueName('acct-alice')}:Alice`
    const bob = `test:${uniqueName('acct-bob')}:Bob`

    const createRes = await SELF.fetch(req('/games', { token: alice, body: { matchLength: 3 } }))
    expect(createRes.status).toBe(201)
    const created = await readJson(createRes)
    expect(typeof created.code).toBe('string')
    expect(created.code.length).toBe(6)
    expect(created.gameId).toBe(created.code) // see index.ts's stubFor docstring
    expect(created.view.status).toBe('waiting')

    const resolveRes = await SELF.fetch(req(`/resolve?code=${created.code}`, { method: 'GET' }))
    expect(resolveRes.status).toBe(200)
    const resolved = await readJson(resolveRes)
    expect(resolved).toEqual({ gameId: created.code, status: 'waiting' })

    // Case-insensitive resolve (the code is always minted uppercase).
    const lowerRes = await SELF.fetch(req(`/resolve?code=${created.code.toLowerCase()}`, { method: 'GET' }))
    expect((await readJson(lowerRes)).gameId).toBe(created.code)

    const joinRes = await SELF.fetch(req(`/games/${created.code}/join`, { token: bob, body: {} }))
    expect(joinRes.status).toBe(200)
    const joined = await readJson(joinRes)
    expect(joined.status).toBe('active')
    expect(joined.seatIndex).toBe(1)

    // The room is now active — /resolve reflects it.
    const resolveActive = await readJson(await SELF.fetch(req(`/resolve?code=${created.code}`, { method: 'GET' })))
    expect(resolveActive.status).toBe('active')

    const syncRes = await SELF.fetch(req(`/games/${created.code}/sync`, { token: alice, method: 'GET' }))
    expect(syncRes.status).toBe(200)
    const synced = await readJson(syncRes)
    expect(synced.view.phase).toBe('playing')

    const activeSeat = synced.view.game.activePlayer as 0 | 1
    const activeToken = activeSeat === 0 ? alice : bob
    const mine = activeSeat === 0 ? synced.view : await readJson(await SELF.fetch(req(`/games/${created.code}/sync`, { token: bob, method: 'GET' })))

    const moveRes = await SELF.fetch(
      req(`/games/${created.code}/move`, {
        token: activeToken,
        body: { seatIndex: activeSeat, move: pickAutoMove(mine.game), clientMoveId: crypto.randomUUID() },
      }),
    )
    expect(moveRes.status).toBe(200)
    const moveBody = await readJson(moveRes)
    expect(moveBody.ok).toBe(true)
    expect(moveBody.moveIndex).toBeGreaterThan(0)
  })

  it('/resolve 404s for an unknown code', async () => {
    const res = await SELF.fetch(req('/resolve?code=ZZZZZZ', { method: 'GET' }))
    expect(res.status).toBe(404)
  })

  it('/resolve 400s for a missing code', async () => {
    const res = await SELF.fetch(req('/resolve', { method: 'GET' }))
    expect(res.status).toBe(400)
  })

  it('a foreign-seat move is rejected 403 (the DO enforces this — the router is a dumb forwarder)', async () => {
    const alice = `test:${uniqueName('acct-alice2')}:Alice`
    const bob = `test:${uniqueName('acct-bob2')}:Bob`
    const created = await readJson(await SELF.fetch(req('/games', { token: alice, body: { matchLength: 3 } })))
    await SELF.fetch(req(`/games/${created.code}/join`, { token: bob, body: {} }))

    const stranger = `test:${uniqueName('acct-stranger')}:Eve`
    const res = await SELF.fetch(req(`/games/${created.code}/sync`, { token: stranger, method: 'GET' }))
    expect(res.status).toBe(403)
  })
})

describe('GET /health', () => {
  it('returns {ok:true}', async () => {
    const res = await SELF.fetch(req('/health', { method: 'GET' }))
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ ok: true })
  })
})

// =============================================================================
// WebSocket passthrough
// =============================================================================

describe('WS upgrade passthrough', () => {
  it('a WS upgrade to /games/:id/socket passes through to the DO unchanged (101)', async () => {
    const alice = `test:${uniqueName('acct-ws')}:Alice`
    const created = await readJson(await SELF.fetch(req('/games', { token: alice, body: { matchLength: 3 } })))

    const res = await SELF.fetch(
      new Request(`https://worker/games/${created.code}/socket`, {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      }),
    )
    expect(res.status).toBe(101)
    expect(res.webSocket).toBeTruthy()
  })
})

// =============================================================================
// CORS
// =============================================================================

describe('CORS', () => {
  it('preflight (OPTIONS) is answered with a permissive * when CLIENT_ORIGIN is unset (this test env)', async () => {
    const res = await SELF.fetch(
      new Request('https://worker/health', { method: 'OPTIONS', headers: { Origin: 'https://anything.example' } }),
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('a real (non-OPTIONS) response also carries CORS headers', async () => {
    const res = await SELF.fetch(new Request('https://worker/health', { headers: { Origin: 'https://anything.example' } }))
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(res.headers.get('Vary')).toBe('Origin')
  })

  // Direct unit coverage of the allowlist behavior (a custom CorsEnv, not
  // this test run's real unset-CLIENT_ORIGIN binding) — reflects an EXACT
  // allowlisted origin and rejects a foreign one, per design spec §4/ADDENDUM.
  describe('allowlist behavior (unit, custom env)', () => {
    const allowlistEnv = { CLIENT_ORIGIN: 'https://vjaipur-game.onrender.com,https://second.example' }

    it('reflects an EXACT allowlisted origin', () => {
      const request = new Request('https://worker/x', { headers: { Origin: 'https://vjaipur-game.onrender.com' } })
      expect(corsHeaders(request, allowlistEnv)['Access-Control-Allow-Origin']).toBe('https://vjaipur-game.onrender.com')
    })

    it('rejects (omits Allow-Origin for) a foreign origin', () => {
      const request = new Request('https://worker/x', { headers: { Origin: 'https://evil.example' } })
      expect(corsHeaders(request, allowlistEnv)['Access-Control-Allow-Origin']).toBeUndefined()
    })

    it('never matches via substring/suffix trickery', () => {
      const request = new Request('https://worker/x', {
        headers: { Origin: 'https://vjaipur-game.onrender.com.evil.com' },
      })
      expect(corsHeaders(request, allowlistEnv)['Access-Control-Allow-Origin']).toBeUndefined()
    })

    it('handlePreflight 204s with the allowlisted origin reflected', () => {
      const request = new Request('https://worker/x', {
        method: 'OPTIONS',
        headers: { Origin: 'https://second.example' },
      })
      const res = handlePreflight(request, allowlistEnv)
      expect(res?.status).toBe(204)
      expect(res?.headers.get('Access-Control-Allow-Origin')).toBe('https://second.example')
    })
  })
})

// =============================================================================
// Auth cache (ADDENDUM P) — direct unit tests of do/authctx.ts's
// authenticateToken, injecting a fetch spy + explicit `now` so caching/TTL/
// negatives can be verified deterministically without a real network call or
// real timers.
// =============================================================================

describe('introspect cache (ADDENDUM P)', () => {
  const FAKE_ENV = { VGAMES_URL: 'https://fake-identity.example' }

  beforeEach(() => {
    __introspectCacheForTest.clear()
  })

  function fakeFetch(
    result: { valid: boolean; accountId?: string; displayName?: string; status?: string } | 'network-error' | 'non-ok',
  ): { fn: typeof fetch; callCount: () => number } {
    let calls = 0
    const fn = (async () => {
      calls++
      if (result === 'network-error') throw new Error('simulated network failure')
      if (result === 'non-ok') return new Response('nope', { status: 500 })
      return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch
    return { fn, callCount: () => calls }
  }

  it('a positive result is cached: a 2nd call for the SAME token within the TTL does NOT re-fetch (spy/count)', async () => {
    const { fn, callCount } = fakeFetch({ valid: true, accountId: 'acct-cache-1', displayName: 'Cachey' })
    const t0 = 1_000_000

    const first = await authenticateToken('token-a', FAKE_ENV, fn, t0)
    expect(first).toEqual({ accountId: 'acct-cache-1', displayName: 'Cachey' })
    expect(callCount()).toBe(1)

    const second = await authenticateToken('token-a', FAKE_ENV, fn, t0 + 1000) // well within the 5-min TTL
    expect(second).toEqual({ accountId: 'acct-cache-1', displayName: 'Cachey' })
    expect(callCount()).toBe(1) // cache hit — no 2nd network call
  })

  it('a DIFFERENT token is never served from another token\'s cache entry', async () => {
    const { fn, callCount } = fakeFetch({ valid: true, accountId: 'acct-cache-x', displayName: 'X' })
    await authenticateToken('token-x1', FAKE_ENV, fn, 1_000_000)
    await authenticateToken('token-x2', FAKE_ENV, fn, 1_000_000)
    expect(callCount()).toBe(2) // two distinct tokens -> two distinct cache keys -> two fetches
  })

  it('entries are timestamped and expire after INTROSPECT_CACHE_TTL_MS (advance time)', async () => {
    const { fn, callCount } = fakeFetch({ valid: true, accountId: 'acct-cache-2', displayName: 'Stale' })
    const t0 = 2_000_000

    await authenticateToken('token-b', FAKE_ENV, fn, t0)
    expect(callCount()).toBe(1)

    await authenticateToken('token-b', FAKE_ENV, fn, t0 + INTROSPECT_CACHE_TTL_MS - 1) // just under TTL
    expect(callCount()).toBe(1) // still cached

    await authenticateToken('token-b', FAKE_ENV, fn, t0 + INTROSPECT_CACHE_TTL_MS + 1) // past TTL
    expect(callCount()).toBe(2) // expired -> re-introspected
  })

  it('negatives are NEVER cached: invalid / merged / network-error all re-fetch every call', async () => {
    const invalid = fakeFetch({ valid: false })
    expect(await authenticateToken('token-c', FAKE_ENV, invalid.fn, 3_000_000)).toBeNull()
    expect(await authenticateToken('token-c', FAKE_ENV, invalid.fn, 3_000_001)).toBeNull()
    expect(invalid.callCount()).toBe(2)

    const merged = fakeFetch({ valid: true, accountId: 'acct-merged', status: 'merged' })
    expect(await authenticateToken('token-d', FAKE_ENV, merged.fn, 3_000_000)).toBeNull()
    expect(await authenticateToken('token-d', FAKE_ENV, merged.fn, 3_000_001)).toBeNull()
    expect(merged.callCount()).toBe(2)
  })

  it('fail-closed on a network error or a non-2xx response — resolves null, never throws, never caches', async () => {
    const netErr = fakeFetch('network-error')
    await expect(authenticateToken('token-e', FAKE_ENV, netErr.fn, 4_000_000)).resolves.toBeNull()
    await expect(authenticateToken('token-e', FAKE_ENV, netErr.fn, 4_000_001)).resolves.toBeNull()
    expect(netErr.callCount()).toBe(2) // never cached -> re-tried every call

    const nonOk = fakeFetch('non-ok')
    await expect(authenticateToken('token-g', FAKE_ENV, nonOk.fn, 4_100_000)).resolves.toBeNull()
    expect(nonOk.callCount()).toBe(1)
  })

  it('the cache is BOUNDED: seeding it past the cap evicts down so a write never leaves it over the cap', async () => {
    const now = 5_000_000
    for (let i = 0; i < INTROSPECT_CACHE_MAX_ENTRIES + 10; i++) {
      __introspectCacheForTest.set(`synthetic-${i}`, {
        value: { accountId: `synthetic-account-${i}`, displayName: 'X' },
        expiresAt: now + INTROSPECT_CACHE_TTL_MS, // not expired — the bound must evict regardless
      })
    }
    expect(__introspectCacheForTest.size).toBe(INTROSPECT_CACHE_MAX_ENTRIES + 10)

    const { fn } = fakeFetch({ valid: true, accountId: 'acct-trigger', displayName: 'Trigger' })
    await authenticateToken('token-trigger-eviction', FAKE_ENV, fn, now)

    expect(__introspectCacheForTest.size).toBeLessThanOrEqual(INTROSPECT_CACHE_MAX_ENTRIES)
  })

  it('the VGAMES_URL===\'test\' seam still runs through the same cache (a synthetic token is cached too, harmlessly)', async () => {
    const { fn, callCount } = fakeFetch({ valid: true, accountId: 'unused', displayName: 'unused' })
    const testEnv = { VGAMES_URL: 'test' }
    const first = await authenticateToken('test:acct-seam:Seamy', testEnv, fn, 6_000_000)
    expect(first).toEqual({ accountId: 'acct-seam', displayName: 'Seamy' })
    const second = await authenticateToken('test:acct-seam:Seamy', testEnv, fn, 6_000_001)
    expect(second).toEqual({ accountId: 'acct-seam', displayName: 'Seamy' })
    expect(callCount()).toBe(0) // the test seam never calls fetch at all, cached or not
  })
})

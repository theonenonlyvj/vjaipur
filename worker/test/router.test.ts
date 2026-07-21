import { createExecutionContext, createScheduledController, env, runInDurableObject, SELF, waitOnExecutionContext } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  authenticateToken,
  INTROSPECT_CACHE_MAX_ENTRIES,
  INTROSPECT_CACHE_TTL_MS,
  __introspectCacheForTest,
} from '../src/do/authctx'
import { corsHeaders, handlePreflight } from '../src/do/cors'
import worker, { mintUnusedCode } from '../src/index'
import type { Env } from '../src/game-do'
import { WAITING_ABANDON_MS } from '../src/do/constants'
import { GameRepository, type SqlLike } from '../src/do/storage'
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

// =============================================================================
// mintUnusedCode (FIX 4 — room-code collision check)
//
// The room code doubles as the DO routing key (stubFor's docstring), so a
// birthday collision would silently reuse another game's DO. These tests
// force a deterministic first-attempt collision (rather than hoping for one
// at 1-in-32^6 random odds) via the injectable code generator.
// =============================================================================

describe('mintUnusedCode (FIX 4)', () => {
  async function seedGamesRow(code: string): Promise<void> {
    await DB()
      .prepare(`INSERT INTO games (game_uuid, code, status, match_length, created_at) VALUES (?, ?, 'waiting', 3, ?)`)
      .bind(crypto.randomUUID(), code, Date.now())
      .run()
  }

  it('retries past a colliding code and returns a fresh one (no DO reuse)', async () => {
    const collidingCode = `CX${crypto.randomUUID().slice(0, 4)}`.toUpperCase()
    await seedGamesRow(collidingCode)

    const freshCode = `FR${crypto.randomUUID().slice(0, 4)}`.toUpperCase()
    let calls = 0
    const genCode = () => {
      calls++
      return calls === 1 ? collidingCode : freshCode
    }

    const result = await mintUnusedCode(env as unknown as Env, genCode)
    expect(calls).toBe(2) // 1st attempt collided, 2nd succeeded
    expect(result).toBe(freshCode)
  })

  it('a fresh (non-colliding) code is returned on the FIRST attempt (no wasted retries)', async () => {
    const freshCode = `FR${crypto.randomUUID().slice(0, 4)}`.toUpperCase()
    let calls = 0
    const genCode = () => {
      calls++
      return freshCode
    }
    const result = await mintUnusedCode(env as unknown as Env, genCode)
    expect(calls).toBe(1)
    expect(result).toBe(freshCode)
  })

  it('gives up (returns null) after MAX_CODE_ATTEMPTS if every generated code collides', async () => {
    const alwaysCollides = `AC${crypto.randomUUID().slice(0, 4)}`.toUpperCase()
    await seedGamesRow(alwaysCollides)

    let calls = 0
    const genCode = () => {
      calls++
      return alwaysCollides
    }
    const result = await mintUnusedCode(env as unknown as Env, genCode)
    expect(result).toBeNull()
    expect(calls).toBe(5) // MAX_CODE_ATTEMPTS, never an unbounded loop
  })

  it('end-to-end: POST /games still succeeds normally (the extra D1 read is transparent on the happy path)', async () => {
    const alice = `test:${uniqueName('acct-mint-happy')}:Alice`
    const res = await SELF.fetch(req('/games', { token: alice, body: { matchLength: 3 } }))
    expect(res.status).toBe(201)
    const body = await readJson(res)
    expect(typeof body.code).toBe('string')
    expect(body.gameId).toBe(body.code)
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
// GET /my-games — best-effort players.last_seen_at "active now" stamp
// =============================================================================
//
// The lobby "your games" poll is a good "this account is active right now"
// signal — a good chunk of a session is spent polling it. It should stamp
// `players.last_seen_at`, but ONLY best-effort: a D1 hiccup on the stamp must
// never fail or delay the actual /my-games response.

describe('GET /my-games — best-effort last_seen_at stamp', () => {
  it("stamps the caller's players.last_seen_at without changing the response shape/status", async () => {
    const acctId = uniqueName('acct-mygames-lastseen')
    const token = `test:${acctId}:MyGamesUser`
    const before = Date.now()

    const res = await SELF.fetch(req('/my-games', { token, method: 'GET' }))
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(Array.isArray(body.games)).toBe(true)

    const row = await DB().prepare(`SELECT last_seen_at FROM players WHERE account_id = ?`).bind(acctId).first<{ last_seen_at: number }>()
    expect(row).toBeTruthy()
    expect(Number(row!.last_seen_at)).toBeGreaterThanOrEqual(before)
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

  // ---------------------------------------------------------------------
  // FIX 5 (minor): broadcast() must never leak activity metadata (nudge/
  // ai_cover/started frames) to a socket that never completed the
  // {type:'auth'} handshake — an unauthenticated party who merely guessed a
  // room code could otherwise sniff live activity without proving seat
  // ownership.
  // ---------------------------------------------------------------------

  /** In-order message reader for a client WebSocket (mirrors viota's
   *  packages/worker/test/websocket.test.ts pattern). */
  function reader(ws: WebSocket) {
    const queue: string[] = []
    const waiters: ((v: string) => void)[] = []
    ws.addEventListener('message', (e) => {
      const data = String((e as MessageEvent).data)
      const w = waiters.shift()
      if (w) w(data)
      else queue.push(data)
    })
    return () =>
      new Promise<any>((resolve) => {
        const q = queue.shift()
        if (q !== undefined) resolve(JSON.parse(q))
        else waiters.push((v) => resolve(JSON.parse(v)))
      })
  }

  async function openSocket(code: string): Promise<WebSocket> {
    const res = await SELF.fetch(
      new Request(`https://worker/games/${code}/socket`, { headers: { Upgrade: 'websocket', Connection: 'Upgrade' } }),
    )
    expect(res.status).toBe(101)
    const ws = res.webSocket!
    ws.accept()
    return ws
  }

  it('an unauthenticated socket never receives a broadcast nudge; an authed one does (FIX 5)', async () => {
    const alice = `test:${uniqueName('acct-bcast-alice')}:Alice`
    const created = await readJson(await SELF.fetch(req('/games', { token: alice, body: { matchLength: 3 } })))

    const authed = await openSocket(created.code)
    const authedNext = reader(authed)
    authed.send(JSON.stringify({ type: 'auth', token: alice }))
    const authOk = await authedNext()
    expect(authOk.type).toBe('auth_ok')

    const unauthed = await openSocket(created.code)
    let unauthedReceived = false
    unauthed.addEventListener('message', () => {
      unauthedReceived = true
    })
    // Deliberately send NO auth frame — this socket stays unauthenticated.

    const authedMsg = authedNext()
    const stub = env.GAME_DO.get(env.GAME_DO.idFromName(created.code))
    const sentCount = await runInDurableObject(stub, (instance) => instance.broadcast({ type: 'nudge', moveIndex: 42 }))
    expect(sentCount).toBe(1) // only the authed socket counted

    const nudge = await authedMsg
    expect(nudge).toEqual({ type: 'nudge', moveIndex: 42 })

    // A real async round-trip (the authed message above) already gave the
    // unauthed socket equal opportunity to receive something from the SAME
    // broadcast call; a short extra wait is just defensive margin.
    await new Promise((r) => setTimeout(r, 10))
    expect(unauthedReceived).toBe(false)

    authed.close(1000, 'done')
    unauthed.close(1000, 'done')
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

// =============================================================================
// Waiting-room abandon sweep (FIX 7)
//
// WAITING_ABANDON_MS was defined in constants.ts but never wired to
// anything: the cron only ever queried status='active', so an unclaimed
// 'waiting' room stayed /resolve-able forever.
// =============================================================================

describe('waiting-room abandon sweep (FIX 7)', () => {
  it('POST /tick (DO-side) on a still-open waiting room flips DO meta AND D1 games.status to abandoned', async () => {
    const alice = `test:${uniqueName('acct-tick-waiting')}:Alice`
    const created = await readJson(await SELF.fetch(req('/games', { token: alice, body: { matchLength: 3 } })))
    const stub = env.GAME_DO.get(env.GAME_DO.idFromName(created.code))

    const res = await stub.fetch(new Request('https://do/tick', { method: 'POST' }))
    expect(res.status).toBe(200)

    await runInDurableObject(stub, (_instance, state) => {
      const repo = new GameRepository(state.storage.sql as unknown as SqlLike)
      expect(repo.getMeta()!.status).toBe('abandoned')
    })

    const row = await DB().prepare(`SELECT status FROM games WHERE code = ?`).bind(created.code).first<any>()
    expect(row.status).toBe('abandoned')
  })

  it('the cron sweep picks up a STALE waiting room (past WAITING_ABANDON_MS) and marks it abandoned in D1', async () => {
    const code = `ST${crypto.randomUUID().slice(0, 4)}`.toUpperCase()
    const staleTs = Date.now() - WAITING_ABANDON_MS - 60_000
    await DB()
      .prepare(`INSERT INTO games (game_uuid, code, status, match_length, created_at, last_activity_at) VALUES (?, ?, 'waiting', 3, ?, ?)`)
      .bind(crypto.randomUUID(), code, staleTs, staleTs)
      .run()

    const ctx = createExecutionContext()
    await worker.scheduled(createScheduledController(), env as unknown as Env, ctx)
    await waitOnExecutionContext(ctx)

    const row = await DB().prepare(`SELECT status FROM games WHERE code = ?`).bind(code).first<any>()
    expect(row.status).toBe('abandoned')
  })

  it('a FRESH waiting room (not yet stale) is left untouched by the cron sweep', async () => {
    const code = `FW${crypto.randomUUID().slice(0, 4)}`.toUpperCase()
    const freshTs = Date.now()
    await DB()
      .prepare(`INSERT INTO games (game_uuid, code, status, match_length, created_at, last_activity_at) VALUES (?, ?, 'waiting', 3, ?, ?)`)
      .bind(crypto.randomUUID(), code, freshTs, freshTs)
      .run()

    const ctx = createExecutionContext()
    await worker.scheduled(createScheduledController(), env as unknown as Env, ctx)
    await waitOnExecutionContext(ctx)

    const row = await DB().prepare(`SELECT status FROM games WHERE code = ?`).bind(code).first<any>()
    expect(row.status).toBe('waiting') // untouched — not yet stale
  })

  it('an ACTIVE game is never mistakenly swept by the waiting-room branch', async () => {
    const code = `AV${crypto.randomUUID().slice(0, 4)}`.toUpperCase()
    const staleTs = Date.now() - WAITING_ABANDON_MS - 60_000
    await DB()
      .prepare(`INSERT INTO games (game_uuid, code, status, match_length, created_at, last_activity_at) VALUES (?, ?, 'active', 3, ?, ?)`)
      .bind(crypto.randomUUID(), code, staleTs, staleTs)
      .run()

    const ctx = createExecutionContext()
    await worker.scheduled(createScheduledController(), env as unknown as Env, ctx)
    await waitOnExecutionContext(ctx)

    const row = await DB().prepare(`SELECT status FROM games WHERE code = ?`).bind(code).first<any>()
    expect(row.status).toBe('active') // the waiting-only UPDATE predicate spared it
  })
})

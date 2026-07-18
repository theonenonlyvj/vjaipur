import { GameDO, type Env } from './game-do'
import { ABANDON_MS } from './do/constants'
import { authenticateToken, extractBearerToken, requireAuth } from './do/authctx'
import { handlePreflight, withCors } from './do/cors'
import { getHistory, getLeaderboard, getRollup, reportMatch, type ReportMatchBody } from './do/stats'

// Cloudflare resolves the Durable Object class from the entry module's exports.
export { GameDO }
export type { Env }

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Resolve the DO stub for a game. THE ROUTING KEY IS THE ROOM CODE, not a
 * separately-minted UUID — see `handleCreateGame`'s docstring for why: Wave
 * 2's `game-do.ts#handleCreateRoom` (pinned, not ours to edit) never threads
 * a client-supplied `gameUuid` through to `createWaitingRoom` (unlike
 * viota's `/create-room`, which does), so `MatchState.game_uuid` is always a
 * value the DO mints ENTIRELY INTERNALLY and never reports back in a form
 * this router could re-derive later. The room `code` is the one identifier
 * BOTH sides reliably agree on (the router mints it, and passes it into the
 * create body, which `handleCreateRoom` DOES honor via `body.code`), so it
 * is what every `/games/:id/*` URL's `:id` actually is.
 */
function stubFor(env: Env, gameId: string) {
  return env.GAME_DO.get(env.GAME_DO.idFromName(gameId))
}

/** JSON content-type + the caller's Authorization (forwarded to a DO that
 *  does its own requireAuth). Omits Authorization when absent so the DO
 *  returns 401. */
function authHeadersFrom(request: Request): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json' }
  const auth = request.headers.get('Authorization')
  if (auth) h.Authorization = auth
  return h
}

/** A short, human room code (lobby registry key) — viota's alphabet, excludes
 *  visually-ambiguous glyphs (no I/O/0/1). Doubles as the `gameId` (see
 *  `stubFor`'s docstring) — always uppercase, so `normalizeGameId` below
 *  keeps every `:id` lookup case-insensitive at the door. */
function generateCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('')
}

function normalizeGameId(raw: string): string {
  return decodeURIComponent(raw).trim().toUpperCase()
}

// ---- rate limiting (simple per-isolate token bucket per accountId) --------
//
// "Cheap, log-and-429 on breach, not load-bearing" (design spec §4): this is
// a courtesy backstop against a runaway/buggy client hammering the worker,
// NOT a security control (a restart/new isolate resets it, and a
// single-isolate Map is trivially bypassed by hitting a different colo). It
// only gates requests whose Bearer token resolves to a real account — an
// unauthenticated/malformed request is never rate-limited here (the DO's own
// requireAuth rejects it with a clean 401 instead of a confusing 429).

const RATE_LIMIT_MAX_TOKENS = 30
const RATE_LIMIT_WINDOW_MS = 10_000

type Bucket = { tokens: number; lastRefill: number }
const rateLimitBuckets = new Map<string, Bucket>()

/** Token-bucket check + consume. Returns `false` when the bucket is empty
 *  (breach). Refills continuously (not in discrete windows) so a burst right
 *  at a window boundary can't double an account's effective rate. */
function consumeRateLimitToken(accountId: string, now: number): boolean {
  let bucket = rateLimitBuckets.get(accountId)
  if (!bucket) {
    bucket = { tokens: RATE_LIMIT_MAX_TOKENS, lastRefill: now }
    rateLimitBuckets.set(accountId, bucket)
  }
  const elapsedMs = now - bucket.lastRefill
  if (elapsedMs > 0) {
    const refill = (elapsedMs / RATE_LIMIT_WINDOW_MS) * RATE_LIMIT_MAX_TOKENS
    bucket.tokens = Math.min(RATE_LIMIT_MAX_TOKENS, bucket.tokens + refill)
    bucket.lastRefill = now
  }
  if (bucket.tokens < 1) return false
  bucket.tokens -= 1
  return true
}

/** Best-effort accountId resolution for rate-limiting only — NEVER used for
 *  authorization (every handler below still does its own real auth check;
 *  this is purely "who do I charge this request's token to, if anyone"). A
 *  missing/invalid token resolves to `null` and is simply not rate-limited. */
async function tryResolveAccountId(request: Request, env: Env): Promise<string | null> {
  const token = extractBearerToken(request)
  if (!token) return null
  const auth = await authenticateToken(token, env)
  return auth?.accountId ?? null
}

// ---- route handlers ---------------------------------------------------------

/**
 * `POST /games` {matchLength} — mint a room code, create the DO (routed by
 * that code — see `stubFor`), forward the create call (Authorization passed
 * through so the DO's own `requireAuth` resolves the host), return
 * `{gameId, code, view}` with `gameId === code` (see `stubFor`'s docstring).
 * ADDENDUM R: the route is `/games`, matching viota (not `/create-room`).
 */
async function handleCreateGame(request: Request, env: Env): Promise<Response> {
  let body: { matchLength?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return json({ error: 'bad_json' }, 400)
  }

  const code = generateCode()
  const res = await stubFor(env, code).fetch(
    new Request('https://do/games', {
      method: 'POST',
      headers: authHeadersFrom(request),
      body: JSON.stringify({ matchLength: body.matchLength, code }),
    }),
  )
  // Surface the DO's own validation/401 verbatim (matches viota's pattern) —
  // matchLength legality is the DO's call, not re-validated here.
  if (!res.ok) return res

  const doBody = (await res.json()) as { view?: unknown }
  return json({ gameId: code, code, view: doBody.view }, res.status)
}

/** `GET /resolve?code=` — resolve a room code to its live game via the D1
 *  lobby registry (there is no API to enumerate DOs). Public: it only
 *  confirms a code is live and reports its status; joining still requires
 *  auth (the DO's own `/join`). `gameId` in the response is the code itself
 *  (see `stubFor`'s docstring) — NOT `games.game_uuid` (a DO-internal label
 *  this router never uses for routing). */
async function handleResolve(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const code = normalizeGameId(url.searchParams.get('code') ?? '')
  if (!code) return json({ error: 'missing_code' }, 400)

  const row = await env.DB.prepare(`SELECT status FROM games WHERE code = ? ORDER BY created_at DESC LIMIT 1`)
    .bind(code)
    .first<{ status: string }>()
  if (!row) return json({ error: 'not_found' }, 404)

  return json({ gameId: code, status: row.status })
}

type MyGamesRow = { code: string; status: string; match_length: number; last_activity_at: number | null; seat_index: number }

/** `GET /my-games` (authed) — the caller's active+waiting games, newest
 *  first. */
async function handleMyGames(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env)
  if (auth instanceof Response) return auth

  const { results } = await env.DB.prepare(
    `SELECT g.code AS code, g.status AS status, g.match_length AS match_length,
            g.last_activity_at AS last_activity_at, gp.seat_index AS seat_index
     FROM game_players gp
     JOIN games g ON g.game_uuid = gp.game_uuid
     WHERE gp.account_id = ? AND g.status IN ('waiting','active')
     ORDER BY g.last_activity_at DESC`,
  )
    .bind(auth.accountId)
    .all<MyGamesRow>()

  return json({
    games: results.map((r) => ({
      gameId: r.code,
      code: r.code,
      status: r.status,
      matchLength: r.match_length,
      lastActivityAt: r.last_activity_at,
      seatIndex: r.seat_index,
    })),
  })
}

const GAME_SUBROUTE = /^\/games\/([^/]+)\/(join|sync|move|heartbeat|reclaim|leave|next-round|resign|socket)$/

/** `ALL /games/:id/(join|sync|move|heartbeat|reclaim|leave|next-round|resign|socket)`
 *  — forward to the DO stub. The WS upgrade (`socket`) is forwarded as the
 *  ORIGINAL, untouched `Request` (Cloudflare ties a WebSocket pair to the
 *  exact incoming `Request` object; reconstructing a new one via
 *  `new Request(url, request)` would drop that association — this mirrors
 *  viota's index.ts exactly). Every other action gets a new `Request`
 *  pointed at the DO's internal path (`https://do/<action>`), cloning
 *  method/headers/body from the original via the two-arg `Request`
 *  constructor; `sync`'s `?since=` query string is preserved explicitly. */
function forwardToGame(request: Request, url: URL, env: Env): Response | Promise<Response> | null {
  const match = GAME_SUBROUTE.exec(url.pathname)
  if (!match) return null
  const gameId = normalizeGameId(match[1]!)
  const action = match[2]!
  const stub = stubFor(env, gameId)

  if (action === 'socket') return stub.fetch(request)
  if (action === 'sync') {
    return stub.fetch(new Request(`https://do/sync${url.search}`, { method: 'GET', headers: request.headers }))
  }
  return stub.fetch(new Request(`https://do/${action}`, request))
}

/**
 * The HTTP router. Returns the raw (pre-CORS) Response; the `fetch` wrapper
 * applies CORS to it. A WebSocket-upgrade response (101) is detected via
 * `.webSocket` by the wrapper and passed through WITHOUT CORS (the WS
 * handshake is not a CORS-governed fetch, and a 101's headers are immutable).
 */
async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname

  if (request.method === 'GET' && path === '/health') return json({ ok: true })

  if (request.method === 'POST' && path === '/games') return handleCreateGame(request, env)
  if (request.method === 'GET' && path === '/resolve') return handleResolve(request, env)
  if (request.method === 'GET' && path === '/my-games') return handleMyGames(request, env)

  const forwarded = forwardToGame(request, url, env)
  if (forwarded) return forwarded

  if (request.method === 'GET' && path === '/stats/leaderboard') {
    return json(await getLeaderboard(env.DB))
  }
  if (request.method === 'GET' && path === '/stats/history') {
    const auth = await requireAuth(request, env)
    if (auth instanceof Response) return auth
    return json({ matches: await getHistory(env.DB, auth.accountId) })
  }
  if (request.method === 'POST' && path === '/stats/report') {
    const auth = await requireAuth(request, env)
    if (auth instanceof Response) return auth
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return json({ error: 'bad_json' }, 400)
    }
    const result = await reportMatch(env.DB, auth.accountId, (body ?? {}) as ReportMatchBody)
    if ('error' in result) return json(result, 400)
    return json(result)
  }
  if (request.method === 'GET' && path === '/stats/rollup') {
    const accountId = url.searchParams.get('accountId')
    if (!accountId) return json({ error: 'missing_account_id' }, 400)
    return json(await getRollup(env.DB, accountId))
  }

  return json({ error: 'not_found' }, 404)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS preflight first — answer OPTIONS for EVERY route (incl. authed
    // ones) before anything else, so a browser can complete the real request
    // (which then carries CORS on its own success/error response).
    const preflight = handlePreflight(request, env)
    if (preflight) return preflight

    // Rate limit: only for a resolvable account, only advisory (see the
    // section header above) — a 429 here is a courtesy, never load-bearing.
    if (request.method === 'POST') {
      const accountId = await tryResolveAccountId(request, env)
      if (accountId && !consumeRateLimitToken(accountId, Date.now())) {
        console.warn(`rate limit exceeded for account ${accountId}`)
        return withCors(json({ error: 'rate_limited' }, 429), request, env)
      }
    }

    const response = await route(request, env)
    // The WebSocket-upgrade response (101) is exempt from CORS and its
    // headers are immutable — pass it straight through.
    if (response.webSocket) return response
    return withCors(response, request, env)
  },

  /**
   * Cron sweep (1-min trigger, `wrangler.toml`'s `[triggers]`): pokes stale
   * ACTIVE games' DOs so their heal/never-stall path (Wave 3) re-drives them
   * and drains any unflushed archive rows — the DO's own logic owns the real
   * abandon decision, this just wakes it up on a schedule so a game nobody
   * is actively polling doesn't sit un-ticked indefinitely. Lightweight: one
   * indexed D1 query + a fire-and-forget poke per stale game. `code` is the
   * routing key (see `stubFor`'s docstring), not `game_uuid`.
   */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = Date.now()
    const { results } = await env.DB.prepare(`SELECT code FROM games WHERE status = 'active' AND last_activity_at < ?`)
      .bind(now - ABANDON_MS)
      .all<{ code: string }>()
    for (const { code } of results) {
      ctx.waitUntil(stubFor(env, code).fetch('https://do/tick', { method: 'POST' }))
    }
  },
} satisfies ExportedHandler<Env>

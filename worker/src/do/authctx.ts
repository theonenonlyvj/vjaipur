/**
 * Per-request authentication context — introspect-only (design spec §2,
 * ADDENDUM O/P). Unlike viota's worker (which co-hosts identity and verifies
 * JWTs locally), vjaipur-worker has NO local secret: every Bearer token is
 * verified by calling out to `${env.VGAMES_URL}/auth/introspect`, modeled on
 * `server/vgamesAuth.ts`'s `introspect`/`resolveSocketIdentity` (fail-closed:
 * invalid / network error / `status==='merged'` all resolve to null/401).
 *
 * The acting account is ALWAYS token-derived (viota rule) — the caller never
 * trusts a body field for `accountId`. The acting SEAT is resolved live from
 * the seats table per request (never a token claim), so a stale token can
 * never assert ownership of a seat it was reclaimed out of.
 *
 * TEST SEAM (critical for offline tests — see worker/vitest.config.ts): when
 * `env.VGAMES_URL === 'test'`, a token is interpreted as
 * `test:<accountId>:<displayName>` with NO network call. Deploy always sets
 * VGAMES_URL to the real `https://vgames-identity.theonenonlyvj.workers.dev`
 * (ADDENDUM O) and never 'test', so this seam can never fire in production.
 *
 * WAVE 4 (ADDENDUM P): `authenticateToken` is wrapped with a 5-minute
 * POSITIVE-only introspect cache, keyed by `SHA-256(token)` (WebCrypto
 * `crypto.subtle.digest`) in a worker-isolate `Map`. Rules, verified by
 * worker/test/router.test.ts:
 *  - ONLY a successful resolution (`AuthOk`) is cached — a failure (missing/
 *    invalid token, network error, non-2xx, `status==='merged'`) is NEVER
 *    cached, so a revoked/merged account is re-checked on every call.
 *  - Entries are TIMESTAMPED and expire after `INTROSPECT_CACHE_TTL_MS` (5
 *    min); an expired entry is evicted the next time it's READ (lazy
 *    eviction) rather than on a timer.
 *  - The Map is bounded (`INTROSPECT_CACHE_MAX_ENTRIES`): on every write, we
 *    first sweep expired entries, then evict the oldest remaining entry
 *    (Map iteration order = insertion order) until back under the cap — so
 *    the cache can never grow unboundedly even under sustained traffic from
 *    distinct tokens.
 *  - This still runs through the `VGAMES_URL === 'test'` seam below (a
 *    cache hit on a synthetic `test:accountId:name` token is harmless — the
 *    seam is a pure function of the token string, so caching it changes
 *    nothing observable and keeps the code path uniform instead of
 *    special-casing tests).
 *  - `fetchImpl` (defaults to the global `fetch`) and `now` (defaults to
 *    `Date.now()`) are both injectable, unused by the two existing 2-arg
 *    call sites (`requireAuth` below, and `game-do.ts`'s WS auth handshake)
 *    — purely a test seam so tests can spy on/count network calls and
 *    advance the clock deterministically without real timers or a real
 *    network round-trip, matching this codebase's existing `now?: number`
 *    idiom (see `do/apply.ts`'s `ApplyParams.now`).
 */

type CacheEntry = { value: AuthOk; expiresAt: number }

/** 5 minutes — ADDENDUM P: "well under the 1h/24h token TTLs". */
export const INTROSPECT_CACHE_TTL_MS = 5 * 60 * 1000

/** Bound on the cache's size — vjaipur is a ~10-user-scale app tonight, so
 *  this is generous headroom, not a tuned production limit. */
export const INTROSPECT_CACHE_MAX_ENTRIES = 2000

/** TEST-ONLY escape hatch (also usable by an admin/ops "flush auth cache"
 *  affordance later): the live cache Map, exposed so tests can assert
 *  size/contents directly and pre-seed synthetic entries to exercise the
 *  bound-eviction path without paying for thousands of real SHA-256 digests. */
export const __introspectCacheForTest: Map<string, CacheEntry> = new Map()

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Evict everything expired as of `now`, then evict oldest-first until
 *  there's room for the write about to happen (`size < MAX`, not `<= MAX` —
 *  called BEFORE the new entry is inserted, so the map's size stays within
 *  the cap immediately AFTER the write too). Called before every write
 *  (never on every read — reads only evict their OWN key if it's
 *  individually expired). */
function pruneIntrospectCache(now: number): void {
  for (const [key, entry] of __introspectCacheForTest) {
    if (entry.expiresAt <= now) __introspectCacheForTest.delete(key)
  }
  while (__introspectCacheForTest.size >= INTROSPECT_CACHE_MAX_ENTRIES) {
    const oldestKey = __introspectCacheForTest.keys().next().value
    if (oldestKey === undefined) break
    __introspectCacheForTest.delete(oldestKey)
  }
}

export type AuthOk = { accountId: string; displayName: string }

/** Introspection never returns a name for an unset/blank displayName — every
 *  consumer (seats, views, archive) gets a safe non-empty placeholder instead
 *  of fabricating "Player N" downstream in multiple places. */
const DEFAULT_DISPLAY_NAME = 'Player'

export type AuthEnv = { VGAMES_URL: string }

function unauthorized(reason: string): Response {
  return new Response(JSON.stringify({ error: 'unauthorized', reason }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  })
}

/** Extract the raw token from an `Authorization: Bearer <token>` header. */
export function extractBearerToken(request: Request): string | null {
  const h = request.headers.get('Authorization')
  if (!h) return null
  const m = /^Bearer\s+(.+)$/i.exec(h.trim())
  const token = m ? m[1]!.trim() : ''
  return token.length > 0 ? token : null
}

function normalizeDisplayName(name: unknown): string {
  return typeof name === 'string' && name.trim().length > 0 ? name.trim() : DEFAULT_DISPLAY_NAME
}

/** The uncached resolution — test seam or real introspect fetch. Returns
 *  `null` on ANY failure (see `authenticateToken`'s docstring); never throws. */
async function resolveAuth(token: string, env: AuthEnv, fetchImpl: typeof fetch): Promise<AuthOk | null> {
  // ---- test seam (no network) --------------------------------------------
  if (env.VGAMES_URL === 'test') {
    const parts = token.split(':')
    if (parts[0] !== 'test' || !parts[1]) return null
    return { accountId: parts[1], displayName: normalizeDisplayName(parts[2]) }
  }

  // ---- real introspection -------------------------------------------------
  try {
    const res = await fetchImpl(`${env.VGAMES_URL}/auth/introspect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      valid?: boolean
      accountId?: string
      status?: string
      displayName?: string
    }
    if (!data.valid || !data.accountId || data.status === 'merged') return null
    return { accountId: data.accountId, displayName: normalizeDisplayName(data.displayName) }
  } catch {
    return null
  }
}

/**
 * Verify a raw token string (used both by `requireAuth` and the WS
 * first-frame handshake). Returns `null` on ANY failure — missing token,
 * network error, non-2xx, `valid:false`, missing `accountId`, or
 * `status==='merged'` (the account's identity has moved on; never attribute
 * writes to it). Never throws.
 *
 * WAVE 4 (ADDENDUM P): wraps `resolveAuth` with the 5-minute positive-only
 * cache described in the file header. `fetchImpl`/`now` are test-only
 * injection seams (both default to the real global) — production call sites
 * (`requireAuth` below, `game-do.ts`'s WS handshake) pass neither.
 */
export async function authenticateToken(
  token: string | null | undefined,
  env: AuthEnv,
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<AuthOk | null> {
  if (typeof token !== 'string' || token.length === 0) return null

  const cacheKey = await sha256Hex(token)
  const cached = __introspectCacheForTest.get(cacheKey)
  if (cached) {
    if (cached.expiresAt > now) return cached.value
    __introspectCacheForTest.delete(cacheKey) // lazy eviction of an expired entry
  }

  const result = await resolveAuth(token, env, fetchImpl)
  if (result) {
    // Cache POSITIVE results only — a failure (incl. network error/`merged`)
    // is NEVER cached, so it's re-checked on every subsequent call.
    pruneIntrospectCache(now)
    __introspectCacheForTest.set(cacheKey, { value: result, expiresAt: now + INTROSPECT_CACHE_TTL_MS })
  }
  return result
}

/**
 * @returns `{accountId, displayName}` on success, or a 401 `Response` the
 * handler returns as-is.
 */
export async function requireAuth(request: Request, env: AuthEnv): Promise<AuthOk | Response> {
  const token = extractBearerToken(request)
  if (!token) return unauthorized('missing_token')
  const auth = await authenticateToken(token, env)
  if (!auth) return unauthorized('invalid_token')
  return auth
}

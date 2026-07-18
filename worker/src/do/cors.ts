/**
 * CORS middleware — PORT of viota's `packages/worker/src/cors.ts` (design
 * spec §4 / file-by-file port map: "cors.ts | copy current allowlist
 * version"), adapted only in file location (vjaipur keeps it under
 * `do/cors.ts` rather than viota's top-level `src/cors.ts` — no behavioral
 * difference, Wave 4 owns this file either way).
 *
 * The deployed topology is CROSS-ORIGIN: the client is served from a Render
 * static site and the API is this Worker on `*.workers.dev` — every browser
 * call is a CORS request, so the Worker must opt the client origin in or the
 * browser blocks it.
 *
 * Auth model is a bearer token in the `Authorization` header, NOT cookies —
 * so we never send `Access-Control-Allow-Credentials`, and reflecting the
 * single configured origin (never `*` in prod, never an arbitrary origin
 * ever) is the correct, safe policy. Applied to every HTTP route; the
 * WebSocket upgrade (a 101 response) is exempt — its headers are immutable
 * and the handshake isn't governed by fetch CORS (see index.ts).
 */

/** The env surface CORS reads — a subset of the Worker Env (easy to fake in
 *  tests). */
export interface CorsEnv {
  /** Comma-separated allowlist of EXACT browser origins allowed to call this
   *  worker (e.g. `https://vjaipur-game.onrender.com`). Set in prod via
   *  `wrangler secret put CLIENT_ORIGIN`. Unset only in local dev, where we
   *  fall back to `*` (see wrangler.toml's [vars] comment). */
  CLIENT_ORIGIN?: string
}

const ALLOW_METHODS = 'GET,POST,OPTIONS'
const ALLOW_HEADERS = 'Authorization,Content-Type'
const MAX_AGE = '86400' // 24h — cache the preflight so it isn't re-sent per call

/**
 * Compute the CORS response headers for a request.
 *
 *  - `CLIENT_ORIGIN` set + request `Origin` EXACTLY equals one entry in the
 *    comma-separated allowlist → reflect it in `Access-Control-Allow-Origin`
 *    (the ONLY origin we ever allow for that request).
 *  - `CLIENT_ORIGIN` set + a foreign/absent `Origin` → emit NO
 *    `Allow-Origin` (the browser then blocks the cross-origin read). We
 *    NEVER reflect an arbitrary origin — exact string equality only, so
 *    `vjaipur-game.onrender.com.evil.com` never matches
 *    `vjaipur-game.onrender.com`.
 *  - `CLIENT_ORIGIN` unset (local dev) → permissive `*`. Safe ONLY because
 *    auth is a bearer token, never a cookie. PRODUCTION MUST set
 *    `CLIENT_ORIGIN`.
 *
 * `Vary: Origin` is always set so a shared cache can never hand one origin's
 * `Access-Control-Allow-Origin` to a different origin.
 */
export function corsHeaders(request: Request, env: CorsEnv): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': ALLOW_METHODS,
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    'Access-Control-Max-Age': MAX_AGE,
    Vary: 'Origin',
  }

  const configured = env.CLIENT_ORIGIN
  const origin = request.headers.get('Origin')

  if (!configured) {
    headers['Access-Control-Allow-Origin'] = '*'
  } else if (origin !== null) {
    const allowed = configured
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean)
    if (allowed.includes(origin)) {
      headers['Access-Control-Allow-Origin'] = origin
    }
  }
  // configured + foreign/absent origin → deliberately omit Allow-Origin (block).

  return headers
}

/**
 * Answer a CORS preflight. Returns a 204 with the CORS headers for an
 * `OPTIONS` request, or `null` for any other method (the caller continues
 * routing). A foreign-origin preflight still returns 204 but carries no
 * `Allow-Origin`, so the browser blocks the follow-up request — exactly the
 * intended outcome.
 */
export function handlePreflight(request: Request, env: CorsEnv): Response | null {
  if (request.method !== 'OPTIONS') return null
  return new Response(null, { status: 204, headers: corsHeaders(request, env) })
}

/**
 * Return a copy of `response` with the CORS headers merged in. The body is a
 * `ReadableStream` re-passed to a fresh `Response` (not consumed here). Do
 * NOT call this on a 101 WebSocket-upgrade response — its headers are
 * immutable and the WS handshake is not a CORS-governed fetch (index.ts
 * checks `response.webSocket` and skips this call for that case).
 */
export function withCors(response: Response, request: Request, env: CorsEnv): Response {
  const merged = new Headers(response.headers)
  for (const [k, v] of Object.entries(corsHeaders(request, env))) merged.set(k, v)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  })
}

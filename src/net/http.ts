// HTTP client for the vjaipur-worker (Phase 2C — see
// docs/superpowers/specs/2026-07-18-vjaipur-worker-online-design.md §7 +
// ADDENDUM). Every `/games/:id/*` call needs `Authorization: Bearer
// <vgamesToken>`; the worker introspects it (worker/src/do/authctx.ts) — this
// client never verifies anything locally, it just carries the token.
import { useStatsStore } from '../store/statsStore'

// The live worker (deployed 2026-07-18). An explicit VITE_VJAIPUR_WORKER_URL
// always wins; otherwise production builds bake the prod worker and local dev
// falls back to localhost. This makes the Render client cutover self-contained
// (no dashboard env var required) while keeping `npm run dev` pointed locally.
const PROD_WORKER_URL = 'https://vjaipur-worker.theonenonlyvj.workers.dev'

export function workerBaseUrl(): string {
  const explicit = import.meta.env.VITE_VJAIPUR_WORKER_URL as string | undefined
  if (explicit) return explicit
  return import.meta.env.PROD ? PROD_WORKER_URL : 'http://localhost:8787'
}

/** A non-2xx JSON response from the worker. `code` is the worker's `error`
 *  field (e.g. 'not_your_turn', 'HAND_LIMIT') when present, else a synthetic
 *  `http_<status>`. */
export class WorkerError extends Error {
  status: number
  code: string
  body: unknown
  constructor(status: number, code: string, body: unknown) {
    super(code)
    this.name = 'WorkerError'
    this.status = status
    this.code = code
    this.body = body
  }
}

export interface WorkerFetchOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  /** Bearer token. Omitted entirely (no header) when null/undefined, matching
   *  the worker router's own "absent Authorization -> 401" contract. */
  token?: string | null
  /** Opt a non-GET call into the 5xx/network backoff-retry path. Only safe
   *  for genuinely idempotent endpoints (e.g. /move — clientMoveId dedups
   *  server-side; /heartbeat — a repeat is a no-op refresh). Defaults to
   *  true for GET, false otherwise. */
  retryOn5xx?: boolean
}

const MAX_5XX_RETRIES = 2
const RETRY_BASE_DELAY_MS = 300

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return {}
  }
}

// Same-origin proxy fallback (2026-07-27, "Sureka's phone" failure class):
// some iOS content blockers / DNS filters block *.workers.dev wholesale, so
// the SITE loads (onrender.com) while every direct API fetch THROWS at the
// network layer. render.yaml rewrites /api/* -> the worker; when a direct
// fetch throws, we retry once through that first-party path. The proxy
// response must actually BE JSON: until the Render Blueprint is synced,
// /api/* falls into the SPA catch-all and returns index.html with a 200 —
// trusting that would corrupt every caller, so a non-JSON proxy response
// rethrows the ORIGINAL network error instead. After one proxy success the
// device is clearly workers.dev-blocked, so subsequent calls go proxy-first
// (sticky per session; falls back to direct if the proxy stops serving JSON).
// An explicit VITE_VJAIPUR_WORKER_URL disables the fallback entirely — the
// same-origin proxy targets PROD, which would be the wrong backend for a
// staging override. The WS nudge stays direct: a blocked WS just degrades to
// the sync polling that is the data path anyway.
const PROXY_BASE = '/api'
let proxyPreferred = false
let proxyBaseOverride: string | null | undefined // tests only

function proxyBase(): string | null {
  if (proxyBaseOverride !== undefined) return proxyBaseOverride
  if (!import.meta.env.PROD) return null
  if (import.meta.env.VITE_VJAIPUR_WORKER_URL) return null
  if (typeof window === 'undefined') return null
  return PROXY_BASE
}

/** Tests only — force/disable the proxy base and reset stickiness. */
export function __setProxyBaseForTests(base: string | null | undefined): void {
  proxyBaseOverride = base
  proxyPreferred = false
}

function isJsonResponse(res: Response): boolean {
  return (res.headers.get('content-type') ?? '').includes('json')
}

async function rawFetch(path: string, method: string, body: unknown, token: string | null | undefined): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const init: RequestInit = {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }
  const proxy = proxyBase()

  if (proxy && proxyPreferred) {
    const res = await fetch(`${proxy}${path}`, init)
    if (isJsonResponse(res)) return res
    // Proxy stopped serving JSON (Blueprint rolled back?) — back to direct.
    proxyPreferred = false
    return fetch(`${workerBaseUrl()}${path}`, init)
  }

  try {
    return await fetch(`${workerBaseUrl()}${path}`, init)
  } catch (err) {
    if (!proxy) throw err
    let res: Response
    try {
      res = await fetch(`${proxy}${path}`, init)
    } catch {
      throw err // both paths dead — surface the original network error
    }
    if (!isJsonResponse(res)) throw err // proxy not wired yet (SPA catch-all HTML)
    proxyPreferred = true
    return res
  }
}

/**
 * `workerFetch(path, {method, body, token})` — JSON in, JSON out.
 *  - 401: one silent re-auth via the existing vgamesClient quick flow
 *    (`statsStore.ensureVGamesAccount`), then ONE retry with the fresh token.
 *  - 5xx/network: retry with backoff (2 tries) — for GET by default, or any
 *    call that explicitly opts in via `retryOn5xx` (idempotent POSTs).
 *  - Any other non-2xx: thrown as a `WorkerError` (status + worker `error`
 *    code) for the caller to branch on.
 */
export async function workerFetch<T = unknown>(path: string, opts: WorkerFetchOptions = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET')
  const retryOn5xx = opts.retryOn5xx ?? method === 'GET'
  let token = opts.token ?? null
  let reauthed = false
  let attempt = 0
  // Diagnostic breadcrumb for 401 handling — folded into the thrown
  // WorkerError so a failing sync shows WHERE auth broke (2026-07-21:
  // 'unauthorized' alone was undiagnosable from a screenshot).
  let reauthNote: string | null = null

  for (;;) {
    let res: Response
    try {
      res = await rawFetch(path, method, opts.body, token)
    } catch (err) {
      if (retryOn5xx && attempt < MAX_5XX_RETRIES) {
        attempt++
        await delay(RETRY_BASE_DELAY_MS * attempt)
        continue
      }
      throw err
    }

    if (res.status === 401 && !reauthed) {
      reauthed = true
      // forceRefresh=true: a 401 means our token is invalid/expired, so mint a
      // FRESH one — never re-hand the cached (expired) token, which would just
      // 401 again ("Failed to create room").
      const account = await useStatsStore.getState().ensureVGamesAccount(true)
      if (account) {
        token = account.token
        reauthNote = 'reauth ok, retried'
        continue // one retry, immediately, with the fresh token
      }
      // Could not re-auth — fall through and surface the 401 as a WorkerError.
      reauthNote = 'reauth FAILED (identity unreachable or rejected)'
    }

    if (res.status >= 500 && retryOn5xx && attempt < MAX_5XX_RETRIES) {
      attempt++
      await delay(RETRY_BASE_DELAY_MS * attempt)
      continue
    }

    const data = await safeJson(res)
    if (!res.ok) {
      const body = data as { error?: string; reason?: string } | null
      let code = body?.error ?? `http_${res.status}`
      if (body?.reason) code += `/${body.reason}` // e.g. unauthorized/invalid_token
      if (reauthNote) code += ` [${reauthNote}]`
      throw new WorkerError(res.status, code, data)
    }
    return data as T
  }
}

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

async function rawFetch(path: string, method: string, body: unknown, token: string | null | undefined): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  return fetch(`${workerBaseUrl()}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
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
      const account = await useStatsStore.getState().ensureVGamesAccount()
      if (account) {
        token = account.token
        continue // one retry, immediately, with the fresh token
      }
      // Could not re-auth — fall through and surface the 401 as a WorkerError.
    }

    if (res.status >= 500 && retryOn5xx && attempt < MAX_5XX_RETRIES) {
      attempt++
      await delay(RETRY_BASE_DELAY_MS * attempt)
      continue
    }

    const data = await safeJson(res)
    if (!res.ok) {
      const code = (data as { error?: string } | null)?.error ?? `http_${res.status}`
      throw new WorkerError(res.status, code, data)
    }
    return data as T
  }
}

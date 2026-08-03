// Shared same-origin proxy fallback core (2026-07-27, "Sureka's phone"
// failure class; factored out 2026-08-03 — BUG 1). Originally lived only in
// src/net/http.ts, which meant only GAME calls (`/games/*`) got the
// resilience; src/auth/vgamesClient.ts's identity calls had none. Since
// identity auth runs FIRST on every cold boot (an app can't do anything
// online without a token), a blocked-device user could never even mint an
// identity, so the whole "same-origin proxy" resilience class could never
// actually engage. Both http.ts (base '/api', proxying to the game worker)
// and vgamesClient.ts (base '/id-api', proxying to the identity worker) now
// build their own fetcher off this one core.
//
// Some iOS content blockers / DNS filters block *.workers.dev wholesale, so
// the SITE loads fine (onrender.com) while every direct API fetch THROWS at
// the network layer. render.yaml rewrites a same-origin path to the real
// backend; when a direct fetch throws, callers retry once through that
// first-party path. The proxy response must actually BE JSON: until the
// matching Render Blueprint route is synced/live, the proxied path falls
// into the SPA catch-all and returns index.html with a 200 — trusting that
// would corrupt every caller, so a non-JSON proxy response rethrows the
// ORIGINAL network error instead. After one proxy success the device is
// clearly workers.dev-blocked, so subsequent calls on THAT fetcher go
// proxy-first (sticky — scoped per fetcher instance, so http.ts's stickiness
// never leaks into vgamesClient's or vice versa).

export function isJsonResponse(res: Response): boolean {
  return (res.headers.get('content-type') ?? '').includes('json')
}

/** Parse a response body as JSON, swallowing failure (e.g. an empty body or
 *  non-JSON error page) — callers get `{}` instead of a thrown SyntaxError.
 *  Shared by src/net/http.ts and src/auth/vgamesClient.ts (previously two
 *  byte-identical copies). */
export async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return {}
  }
}

export interface ProxyFallbackConfig {
  /** Resolves the direct backend base URL for this call (http.ts's
   *  workerBaseUrl / vgamesClient's vgamesBaseUrl — read fresh per call,
   *  never cached, since some callers key it off env at call time). */
  directBase: () => string
  /** Resolves the same-origin proxy base path (e.g. '/api', '/id-api'), or
   *  null to disable the fallback for this call (dev, an explicit backend
   *  URL override, or a non-browser environment). Ignored while a test
   *  override is armed (see `setProxyBaseForTests`). */
  proxyBase: () => string | null
}

export interface ProxyFallbackFetcher {
  /** Direct-then-proxy-on-throw fetch, sticky once the proxy has proven
   *  itself JSON-serving. */
  fetchWithFallback: (path: string, init: RequestInit) => Promise<Response>
  /** Tests only — force/disable the proxy base and reset stickiness. */
  setProxyBaseForTests: (base: string | null | undefined) => void
}

export function createProxyFallbackFetcher(config: ProxyFallbackConfig): ProxyFallbackFetcher {
  let proxyPreferred = false
  let proxyBaseOverride: string | null | undefined // tests only

  function resolveProxyBase(): string | null {
    if (proxyBaseOverride !== undefined) return proxyBaseOverride
    return config.proxyBase()
  }

  async function fetchWithFallback(path: string, init: RequestInit): Promise<Response> {
    const proxy = resolveProxyBase()

    if (proxy && proxyPreferred) {
      const res = await fetch(`${proxy}${path}`, init)
      if (isJsonResponse(res)) return res
      // Proxy stopped serving JSON (Blueprint rolled back?) — back to direct.
      proxyPreferred = false
      return fetch(`${config.directBase()}${path}`, init)
    }

    try {
      return await fetch(`${config.directBase()}${path}`, init)
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

  function setProxyBaseForTests(base: string | null | undefined): void {
    proxyBaseOverride = base
    proxyPreferred = false
  }

  return { fetchWithFallback, setProxyBaseForTests }
}

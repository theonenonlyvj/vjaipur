// VGames Identity client — talks to the shared VGames worker (see
// vgames-platform/docs/superpowers/plans/2026-07-09-vgames-p1.md, Phase A) for
// device-bound ghost accounts + username/password auth. Replaces vjaipur's old
// plaintext-secret Socket.IO SECURE_ACCOUNT/RESTORE_ACCOUNT flow (see Task C4).
import { createProxyFallbackFetcher } from '../net/proxyFallback'

// Account claim state as reported by the VGames worker's auth responses.
// 'ghost' = device-bound, never claimed; 'claimed' = has a username+password.
// Optional because older worker builds may omit it — callers must treat an
// absent status as "unknown" and fall back to their own signal, never as ghost.
export type VGamesStatus = 'ghost' | 'claimed'

export interface VGamesQuickResult {
  token: string
  accountId: string
  status?: VGamesStatus
}

export interface VGamesSetCredentialsResult {
  ok: boolean
  error?: string
  status?: VGamesStatus
}

export interface VGamesLoginResult {
  ok: boolean
  token?: string
  accountId?: string
  mustChangePassword?: boolean
  error?: string
  status?: VGamesStatus
}

const DEFAULT_VGAMES_URL = 'https://vgames-identity.theonenonlyvj.workers.dev'

export function vgamesBaseUrl(): string {
  return (import.meta.env.VITE_VGAMES_URL as string | undefined) ?? DEFAULT_VGAMES_URL
}

// Same-origin proxy fallback (BUG 1, 2026-08-03): identity calls run FIRST on
// every cold boot (nothing online can happen without a token), so before this
// they were the one call site that COULDN'T benefit from src/net/http.ts's
// blocked-device resilience (see src/net/proxyFallback.ts for the shared
// mechanics). render.yaml's matching `/id-api/*` rewrite is inactive until
// the Render Blueprint is synced — harmless (a non-JSON proxy response just
// rethrows the original network error, same as http.ts). An explicit
// VITE_VGAMES_URL (staging override) disables the fallback entirely, same
// rule as http.ts's VITE_VJAIPUR_WORKER_URL.
const ID_PROXY_BASE = '/id-api'

const proxyFallback = createProxyFallbackFetcher({
  directBase: vgamesBaseUrl,
  proxyBase: () => {
    if (!import.meta.env.PROD) return null
    if (import.meta.env.VITE_VGAMES_URL) return null
    if (typeof window === 'undefined') return null
    return ID_PROXY_BASE
  },
})

/** Tests only — force/disable the proxy base and reset stickiness. */
export const __setIdProxyBaseForTests = proxyFallback.setProxyBaseForTests

async function postJson(path: string, body: unknown, token?: string): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  return proxyFallback.fetchWithFallback(path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

async function safeJson(res: Response): Promise<any> {
  try {
    return await res.json()
  } catch {
    return {}
  }
}

/** POST /auth/quick — device-bound ghost mint/re-auth. Works for ghosts and migrated users alike.
 *  `game: 'jaipur'` labels a NEWLY-minted account's origin_game correctly on the
 *  worker (Fix M3); it's purely additive/cosmetic and ignored on re-auth of an
 *  existing account. */
export async function vgamesQuick(deviceCredential: string, displayName?: string): Promise<VGamesQuickResult> {
  const res = await postJson('/auth/quick', { deviceCredential, displayName, game: 'jaipur' })
  if (!res.ok) throw new Error(`vgamesQuick failed: ${res.status}`)
  const data = await safeJson(res)
  return { token: data.token, accountId: data.accountId, status: data.status }
}

/** POST /auth/set-credentials (Bearer) — claim the current ghost with a username+password, in place. */
export async function vgamesSetCredentials(
  token: string,
  username: string,
  password: string,
): Promise<VGamesSetCredentialsResult> {
  const res = await postJson('/auth/set-credentials', { username, password }, token)
  const data = await safeJson(res)
  if (res.ok) return { ok: true, status: data.status }
  return { ok: false, error: data.error ?? `http_${res.status}` }
}

/** POST /auth/login — restore/bind this device to an existing username+password account. */
export async function vgamesLogin(
  username: string,
  password: string,
  deviceCredential: string,
): Promise<VGamesLoginResult> {
  const res = await postJson('/auth/login', { username, password, deviceCredential })
  const data = await safeJson(res)
  if (!res.ok) return { ok: false, error: data.error ?? `http_${res.status}` }
  return { ok: true, token: data.token, accountId: data.accountId, mustChangePassword: data.mustChangePassword, status: data.status }
}

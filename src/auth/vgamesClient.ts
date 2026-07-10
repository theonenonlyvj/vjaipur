// VGames Identity client — talks to the shared VGames worker (see
// vgames-platform/docs/superpowers/plans/2026-07-09-vgames-p1.md, Phase A) for
// device-bound ghost accounts + username/password auth. Replaces vjaipur's old
// plaintext-secret Socket.IO SECURE_ACCOUNT/RESTORE_ACCOUNT flow (see Task C4).

export interface VGamesQuickResult {
  token: string
  accountId: string
}

export interface VGamesSetCredentialsResult {
  ok: boolean
  error?: string
}

export interface VGamesLoginResult {
  ok: boolean
  token?: string
  accountId?: string
  mustChangePassword?: boolean
  error?: string
}

const DEFAULT_VGAMES_URL = 'https://viota-worker.theonenonlyvj.workers.dev'

export function vgamesBaseUrl(): string {
  return (import.meta.env.VITE_VGAMES_URL as string | undefined) ?? DEFAULT_VGAMES_URL
}

async function postJson(path: string, body: unknown, token?: string): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  return fetch(`${vgamesBaseUrl()}${path}`, {
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
  return { token: data.token, accountId: data.accountId }
}

/** POST /auth/set-credentials (Bearer) — claim the current ghost with a username+password, in place. */
export async function vgamesSetCredentials(
  token: string,
  username: string,
  password: string,
): Promise<VGamesSetCredentialsResult> {
  const res = await postJson('/auth/set-credentials', { username, password }, token)
  const data = await safeJson(res)
  if (res.ok) return { ok: true }
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
  return { ok: true, token: data.token, accountId: data.accountId, mustChangePassword: data.mustChangePassword }
}

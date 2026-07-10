// VGames Identity introspection — verifies JWTs minted by the shared VGames
// worker (see vgames-platform/docs/superpowers/plans/2026-07-09-vgames-p1.md,
// Phase A/C). Used both at Socket.IO connection ("join") and again on
// SYNC_MATCH, so match writes are always attributed to a canonical,
// server-verified accountId instead of a client-asserted friendCode/secretKey.

export interface IntrospectResult {
  valid: boolean
  accountId?: string
  status?: string
}

export interface SocketIdentity {
  accountId: string
  status: string
}

/**
 * POST {vgamesUrl}/auth/introspect. Always resolves — never throws — and
 * fails closed (`valid:false`) on a non-2xx response or a network error, so a
 * VGames outage can't be used to smuggle an unverified identity through.
 */
export async function introspect(token: string, vgamesUrl: string): Promise<IntrospectResult> {
  try {
    const res = await fetch(`${vgamesUrl}/auth/introspect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    if (!res.ok) return { valid: false }
    const data = await res.json()
    return { valid: !!data.valid, accountId: data.accountId, status: data.status }
  } catch {
    return { valid: false }
  }
}

/**
 * Resolves the canonical VGames identity for an incoming socket's handshake
 * (or payload) token. Returns null for: no token (anonymous/guest — allowed
 * to keep playing locally, just has no linked account), a token that fails
 * introspection, or an account whose canonical status is 'merged' (its
 * epoch/identity has moved — callers must not attribute writes to it).
 */
export async function resolveSocketIdentity(
  token: string | undefined,
  vgamesUrl: string,
): Promise<SocketIdentity | null> {
  if (!token) return null
  const r = await introspect(token, vgamesUrl)
  if (!r.valid || !r.accountId || r.status === 'merged') return null
  return { accountId: r.accountId, status: r.status ?? 'unknown' }
}

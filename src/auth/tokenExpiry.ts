// Client-side JWT expiry peek — NEVER verifies the token (no signature
// check, no server round-trip), it just reads the `exp` claim out of the
// payload so the client can decide "is this worth refreshing proactively"
// before the server ever sees a 401. Any malformed/unexpected input (wrong
// shape, bad base64url, non-JSON payload, missing/non-numeric exp) resolves
// to null rather than throwing — a bad token must never crash a refresh
// check, it should just look "unknown" and let the caller decide to refresh.
export function decodeJwtExp(token: string | null | undefined): number | null {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const json = JSON.parse(base64UrlDecode(parts[1])) as { exp?: unknown }
    if (typeof json.exp !== 'number' || !Number.isFinite(json.exp)) return null
    return json.exp
  } catch {
    return null
  }
}

function base64UrlDecode(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  const binary = atob(padded) // throws on invalid base64 — caller catches
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

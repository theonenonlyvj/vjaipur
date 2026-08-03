// Small helpers shared between index.ts (the router) and game-do.ts (the
// Durable Object) — extracted because both files had byte-identical copies.

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Room-code alphabet (viota's — excludes visually-ambiguous chars: no I/O/0/1). */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/** A short, human room code (lobby registry key) — viota's alphabet, excludes
 *  visually-ambiguous glyphs (no I/O/0/1). Also used by index.ts as the
 *  `gameId` (see `stubFor`'s docstring there) — always uppercase, so
 *  `normalizeGameId` keeps every `:id` lookup case-insensitive at the door. */
export function generateCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
}

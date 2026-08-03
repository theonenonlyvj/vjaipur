// Thin localStorage wrappers that swallow failures (private-mode/quota
// throws, corrupt/missing entries) instead of propagating them — every
// caller here treats persistence as a nice-to-have, never a hard
// requirement. Extracted from src/net/outbox.ts and src/net/session.ts,
// which had near-identical try/catch bodies.

/** Parse a JSON value stored under `key`, or null if absent/unreadable. */
export function safeGetJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/** JSON-encode `value` into `key`. Failure (private mode / quota) is a
 *  silent no-op — losing persistence is the worst case, not a hard failure. */
export function safeSetJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // no-op
  }
}

/** Remove `key`. Failure is a silent no-op. */
export function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // no-op
  }
}

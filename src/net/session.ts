// Persisted online-session pointer + the match-lifetime heartbeat loop.
// ADDENDUM Q: heartbeat runs for the WHOLE online-match lifetime via this
// top-level interval (not a per-screen useEffect), so a player sitting on
// RoundEndScreen still keeps the server's presence window alive.
import * as onlineApi from './online'

const KEY = 'vjaipur-online-session'
const HEARTBEAT_INTERVAL_MS = 20_000

export interface OnlineSession {
  gameId: string
  code: string
  mySeat: 0 | 1
}

export function save(session: OnlineSession): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(session))
  } catch {
    // no-op — losing session persistence only affects reload-resume
  }
}

export function load(): OnlineSession | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.gameId !== 'string' || typeof parsed.mySeat !== 'number') return null
    return parsed as OnlineSession
  } catch {
    return null
  }
}

export function clear(): void {
  stopHeartbeat()
  try {
    localStorage.removeItem(KEY)
  } catch {
    // no-op
  }
}

let heartbeatTimer: ReturnType<typeof setInterval> | null = null

/** Start the 20s heartbeat loop for `gameId`. Idempotent: a re-start (e.g.
 *  re-entering the same game) replaces any prior interval rather than
 *  stacking a second one. Failures are swallowed — a missed heartbeat just
 *  means the server's absence clock ticks a little further; the next
 *  successful one resets it. */
export function startHeartbeat(gameId: string): void {
  stopHeartbeat()
  heartbeatTimer = setInterval(() => {
    onlineApi.heartbeat(gameId).catch(() => {})
  }, HEARTBEAT_INTERVAL_MS)
}

export function stopHeartbeat(): void {
  if (heartbeatTimer != null) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

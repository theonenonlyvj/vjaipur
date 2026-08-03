// Persisted online-session pointer + the match-lifetime heartbeat loop.
// ADDENDUM Q: heartbeat runs for the WHOLE online-match lifetime via this
// top-level interval (not a per-screen useEffect), so a player sitting on
// RoundEndScreen still keeps the server's presence window alive.
import * as onlineApi from './online'
import { safeGetJson, safeSetJson, safeRemove } from './safeStorage'

const KEY = 'vjaipur-online-session'
const HEARTBEAT_INTERVAL_MS = 20_000

export interface OnlineSession {
  gameId: string
  code: string
  mySeat: 0 | 1
}

export function save(session: OnlineSession): void {
  // no-op on failure — losing session persistence only affects reload-resume
  safeSetJson(KEY, session)
}

export function load(): OnlineSession | null {
  const parsed = safeGetJson<OnlineSession>(KEY)
  if (!parsed || typeof parsed.gameId !== 'string' || typeof parsed.mySeat !== 'number') return null
  return parsed
}

export function clear(): void {
  stopHeartbeat()
  safeRemove(KEY)
}

let heartbeatTimer: ReturnType<typeof setInterval> | null = null

/** Start the 20s heartbeat loop for `gameId`. Idempotent: a re-start (e.g.
 *  re-entering the same game) replaces any prior interval rather than
 *  stacking a second one. Failures are swallowed — a missed heartbeat just
 *  means the server's absence clock ticks a little further; the next
 *  successful one resets it. */
export function startHeartbeat(gameId: string): void {
  stopHeartbeat()
  // Fire ONE beat immediately (don't wait a full interval) so presence is
  // established the instant we enter/resume a game — otherwise the opponent
  // could see a spurious "away" for up to HEARTBEAT_INTERVAL_MS at kickoff or
  // on resume/reconnect.
  onlineApi.heartbeat(gameId).catch(() => {})
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

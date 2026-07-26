// Proactive session-persistence triggers — the client-side half of "the
// owner shouldn't get logged out every hour" (see statsStore's
// ensureVGamesAccount, which now refreses ahead of a token's expiry instead
// of waiting for a 401). This module owns WHEN that check runs: on start
// (app boot), whenever the tab becomes visible again, whenever the window
// regains focus, and on a low-frequency background interval while the tab
// stays open the whole time. Every trigger calls the plain (non-forced)
// ensureVGamesAccount() — it decides on its own whether the cached token is
// still fresh enough to skip the network entirely (the common case).
//
// Deliberately separate from src/net/session.ts: that module's heartbeat is
// scoped to a single online match's lifetime (started/stopped per game).
// This one runs for the WHOLE app session regardless of whether a match is
// active, so folding it into session.ts would conflate two different
// lifecycles.
import { useStatsStore } from '../store/statsStore'

const REFRESH_INTERVAL_MS = 15 * 60 * 1000 // 15 minutes

let intervalTimer: ReturnType<typeof setInterval> | null = null
let running = false

// Fire-and-forget, never throws, never blocks the caller — a failed refresh
// just means the next trigger (or an eventual 401's own self-heal in
// workerFetch) tries again. ensureVGamesAccount itself already never
// rejects, but this call boundary stays defensive regardless.
function refresh(): void {
  try {
    void useStatsStore.getState().ensureVGamesAccount().catch(() => {})
  } catch {
    // no-op
  }
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'visible') refresh()
}

function onFocus(): void {
  refresh()
}

/** Idempotent: re-starting replaces (never stacks) the interval/listeners,
 *  same convention as session.ts#startHeartbeat. Fires one refresh check
 *  immediately (the "app boot" trigger) before arming the rest. */
export function startTokenRefreshWatchers(): void {
  stopTokenRefreshWatchers()
  running = true
  refresh()
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('focus', onFocus)
  intervalTimer = setInterval(refresh, REFRESH_INTERVAL_MS)
}

export function stopTokenRefreshWatchers(): void {
  if (!running) return
  running = false
  document.removeEventListener('visibilitychange', onVisibilityChange)
  window.removeEventListener('focus', onFocus)
  if (intervalTimer != null) {
    clearInterval(intervalTimer)
    intervalTimer = null
  }
}

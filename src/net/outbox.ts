// At most ONE pending move, persisted so a refresh/crash mid-flight doesn't
// silently drop it. `clientMoveId` makes replay idempotent server-side
// (worker/src/do/apply.ts) — draining is always safe, even if the original
// POST actually landed and only the response was lost.
import type { Action } from '../engine'
import * as onlineApi from './online'
import type { ClientView } from './types'

const KEY = 'vjaipur-outbox'

export interface OutboxMove {
  gameId: string
  seatIndex: 0 | 1
  action: Action
  clientMoveId: string
}

export function save(entry: OutboxMove): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entry))
  } catch {
    // localStorage unavailable (private mode / quota) — the move still went
    // out over the wire; losing the retry-on-reload safety net is the worst
    // case, not a hard failure.
  }
}

export function load(): OutboxMove | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    return JSON.parse(raw) as OutboxMove
  } catch {
    return null
  }
}

export function clear(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // no-op
  }
}

/**
 * Drain any pending move for THIS game before a sync. Returns the resulting
 * view when a move was actually (re)posted, else null (nothing pending, a
 * pending move for a DIFFERENT game — left untouched, stale outboxes are
 * cleared by session teardown — or the drain itself failed, in which case
 * the entry is left in place for the next attempt).
 */
export async function drain(gameId: string): Promise<{ view: ClientView } | null> {
  const pending = load()
  if (!pending || pending.gameId !== gameId) return null
  try {
    const result = await onlineApi.move(pending.gameId, pending.seatIndex, pending.action, pending.clientMoveId)
    clear()
    return { view: result.view }
  } catch {
    return null // still unreachable — leave it queued for the next drain
  }
}

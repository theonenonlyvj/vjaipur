// At most ONE pending move, persisted so a refresh/crash mid-flight doesn't
// silently drop it. `clientMoveId` makes replay idempotent server-side
// (worker/src/do/apply.ts) — draining is always safe, even if the original
// POST actually landed and only the response was lost.
import type { Action } from '../engine'
import * as onlineApi from './online'
import { WorkerError } from './http'
import type { ClientView } from './types'
import { safeGetJson, safeSetJson, safeRemove } from './safeStorage'

const KEY = 'vjaipur-outbox'

export interface OutboxMove {
  gameId: string
  seatIndex: 0 | 1
  action: Action
  clientMoveId: string
}

export function save(entry: OutboxMove): void {
  // localStorage unavailable (private mode / quota) — the move still went
  // out over the wire; losing the retry-on-reload safety net is the worst
  // case, not a hard failure.
  safeSetJson(KEY, entry)
}

export function load(): OutboxMove | null {
  return safeGetJson<OutboxMove>(KEY)
}

export function clear(): void {
  safeRemove(KEY)
}

/**
 * Drain any pending move for THIS game before a sync. Returns the resulting
 * view when a move was actually (re)posted, else null (nothing pending, a
 * pending move for a DIFFERENT game — left untouched, stale outboxes are
 * cleared by session teardown — a definitively-rejected move, or the drain
 * itself failed, in which case the entry is left in place for the next
 * attempt).
 */
export async function drain(gameId: string): Promise<{ view: ClientView } | null> {
  const pending = load()
  if (!pending || pending.gameId !== gameId) return null
  try {
    const result = await onlineApi.move(pending.gameId, pending.seatIndex, pending.action, pending.clientMoveId)
    clear()
    return { view: result.view }
  } catch (err) {
    // BUG 8+10 (2026-08-03): a 4xx WorkerError means the worker definitively
    // rejected this move (illegal move, wrong turn, seat conflict, ...) — it
    // did NOT commit, and retrying it on every future drain would just keep
    // 404/409-ing forever. Same rule dispatchOnline already applies to a
    // fresh 4xx (see gameStore.ts#dispatchOnline): clear it as moot rather
    // than treating it like a transient/network failure. Only network
    // errors and 5xx (genuinely unknown outcome) stay queued for retry.
    if (err instanceof WorkerError && err.status < 500) {
      clear()
      return null
    }
    return null // still unreachable (network/5xx) — leave it queued for the next drain
  }
}

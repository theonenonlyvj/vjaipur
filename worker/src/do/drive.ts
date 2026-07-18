import type { Action } from '../../../src/engine'
import { pickMediumAction } from '../../../src/ai/mediumAi'
import { floorMove } from './floor'
import { applyAndPersist } from './apply'
import type { GameRepository, SqlLike } from './storage'
import { setTimer, clearTimer } from './timers'
import { isAnyHumanPresent } from './presence'
import { AI_STEP_MS } from './constants'

/**
 * The drive loop — the ONLY code path that produces AI moves. Ported from
 * viota's do/drive.ts (Wave 3, ADDENDUM K).
 *
 * `driveIfAI` runs after every applied move/deal, on heartbeat, on every
 * alarm fire (`ai_step`/`heal`), and on DO wake. It applies AT MOST ONE
 * medium-AI move per call and paces the next one with a chained durable
 * `ai_step` alarm — never a synchronous loop — so humans see each play land
 * and a reclaim mid-chain makes the next iteration a no-op that hands
 * control straight back.
 *
 * Freeze invariant: when NO human is present the loop does not drive (saves
 * compute); the first heartbeat re-triggers it and re-drives.
 *
 * ADDENDUM K: early-return whenever `MatchState.phase !== 'playing'` —
 * `pickMediumAction` itself returns null off `'playing'` and the engine
 * would reject WRONG_PHASE, so round_end/match_over must never reach the
 * AI/engine at all.
 *
 * Never a second write path: the AI move goes through `applyAndPersist`
 * inside `transactionSync`, exactly like a human move, with `byAi:true` + a
 * deterministic `clientMoveId` (`ai:seat:targetMoveIndex`) so an alarm
 * re-fire is a benign idempotent no-op, and with the reclaim-race guard
 * armed (`requireAiControlled`) so a returning human aborts the AI move at
 * commit.
 */
export interface DriveDeps {
  ctx: { storage: { transactionSync<T>(fn: () => T): T } }
  nudge(moveIndex: number): void
}

export function driveIfAI(deps: DriveDeps, repo: GameRepository, sql: SqlLike, now: number): void {
  const meta = repo.getMeta()
  if (!meta || meta.status !== 'active') {
    if (meta) clearTimer(sql, 'ai_step', meta.current_seat)
    return
  }

  // ADDENDUM K: round_end/match_over have no active turn to drive.
  if (meta.phase !== 'playing') {
    clearTimer(sql, 'ai_step', meta.current_seat)
    return
  }

  // FREEZE: zero humans present → do not drive; drop the current drive tick.
  if (!isAnyHumanPresent(repo, now)) {
    clearTimer(sql, 'ai_step', meta.current_seat)
    return
  }

  const currentSeat = meta.current_seat
  const seat = repo.getSeats()[currentSeat]
  if (!seat) return

  if (!seat.controlled_by_ai) {
    // A human's turn — nothing to drive. Drop any stale ai_step. A CONNECTED
    // player is NEVER auto-replaced no matter how long they think, so NO
    // cover is armed here (that's armDisconnectCoverIfAbsent's job).
    clearTimer(sql, 'ai_step', currentSeat)
    return
  }

  // Current seat is AI-controlled and a human is watching → drive ONE move.
  const snapshot = repo.getSnapshot()
  if (!snapshot) return
  // pickMediumAction returns null only off 'playing' (already guarded above)
  // or a genuinely zero-legal-move state (shouldn't happen — ADDENDUM N); the
  // floor fallback keeps this call site total regardless.
  const action: Action = pickMediumAction(snapshot) ?? floorMove(snapshot)
  const targetMoveIndex = meta.move_index + 1

  const result = deps.ctx.storage.transactionSync(() =>
    applyAndPersist(repo, {
      seatIndex: currentSeat,
      move: action,
      clientMoveId: `ai:${currentSeat}:${targetMoveIndex}`,
      accountId: null,
      byAi: true,
      aiDifficulty: 'medium',
      expectedSeat: currentSeat,
      requireAiControlled: true,
      now,
    }),
  )

  // The ai_step that scheduled this drive (if any) is now consumed.
  clearTimer(sql, 'ai_step', currentSeat)

  if ('ok' in result && result.ok) {
    deps.nudge(result.moveIndex)
    // Chain across consecutive AI seats: arm the next paced step ONLY if the
    // new current seat is itself AI-controlled AND still mid-round (a move
    // that just ended the round must never chain a stale ai_step onto a
    // round_end/match_over state — ADDENDUM K).
    const after = repo.getMeta()
    if (after && after.status === 'active' && after.phase === 'playing') {
      const nextRow = repo.getSeats()[after.current_seat]
      if (nextRow && nextRow.controlled_by_ai) {
        setTimer(sql, 'ai_step', after.current_seat, now + AI_STEP_MS)
      }
    }
  }
  // A 'reclaimed' abort (a human returned before commit) writes nothing and
  // arms no further tick — the drive stops and control is already back with
  // the human.
}

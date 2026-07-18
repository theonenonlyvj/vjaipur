import { applyAction, scoreRound } from '../../../src/engine'
import type { Action } from '../../../src/engine'
import { GLOBAL_SEAT } from './constants'
import { toPublicPayload } from './publicPayload'
import type { GameRepository, MatchStatus, MetaRow } from './storage'
import { buildClientView, type ClientView } from './view'

/**
 * Inputs to a single authoritative move application. `accountId` is the
 * TOKEN-DERIVED acting account (never a request-body field) — see
 * `do/authctx.ts`. `byAi` marks a server-minted AI/floor move (Wave 3),
 * which bypasses the human-ownership check.
 */
export type ApplyParams = {
  seatIndex: number
  move: Action
  clientMoveId: string | null
  accountId: string | null
  byAi?: boolean
  aiDifficulty?: string | null
  /**
   * Reclaim-race guard (Wave 3, ported from viota's do/apply.ts): a
   * server-minted AI/floor move must be for `expectedSeat` AND — when
   * `requireAiControlled` — that seat must STILL be `controlled_by_ai` at the
   * moment this txn reads storage. Checked INSIDE the synchronous write span
   * (`transactionSync`), so a reclaim that flips `controlled_by_ai` /
   * advances the turn before this move commits makes the AI move ABORT
   * (`{error:'reclaimed'}`) and write nothing. Level-triggered: it re-reads
   * the freshly-persisted seat/turn, never a value captured earlier by the
   * drive loop.
   */
  expectedSeat?: number
  requireAiControlled?: boolean
  /** created_at; injectable for deterministic tests. */
  now?: number
}

export type ApplyResult =
  | { ok: true; moveIndex: number; view: ClientView }
  | { duplicate: true; view: ClientView }
  | { error: string }

/**
 * The authoritative move pipeline — the ENTIRE read -> validate -> write
 * span, designed to run with ZERO awaits inside
 * `ctx.storage.transactionSync(...)` (ported from viota's `do/apply.ts`
 * ORDER verbatim: status -> authz -> idempotency -> turn -> engine ->
 * derive -> write move-first). The DO's `handleMove` parses the request body
 * and calls `requireAuth` (the only awaits) BEFORE calling this, so the
 * input gate stays closed across the whole span and a move POST can never
 * interleave with an alarm (Wave 3) onto the same `move_index`.
 *
 * Commit-then-nudge: this only WRITES. The caller calls `nudge(moveIndex)`
 * AFTER `transactionSync` returns (i.e. after the commit).
 *
 * ADDENDUM C/D — round/match transition, in THIS same span, when the engine
 * reports `newState.phase === 'round-end'` (note the ENGINE's phase string,
 * hyphenated, is distinct from MatchState's `'round_end'`, underscored —
 * ADDENDUM D): `scoreRound(newState)` -> seals update -> append a
 * server-minted `round_end` move (payload = the RoundResult + new seals) ->
 * `winnerSeat`/`match_over` iff `seals[seat] >= sealsNeeded` for EITHER seat
 * (NEVER a literal `>= 2` — that formula is bugged for matchLength ∈
 * {1, 5}, see gameStore.ts's online `startNextRound`, which ADDENDUM C
 * explicitly overrides). `MatchState.phase`/`seals`/`round` — never the
 * embedded engine GameState's own stale setup-time fields — are the ONLY
 * authoritative copies (ADDENDUM D); the actual NEXT deal happens on
 * `POST /next-round`, not here.
 */
export function applyAndPersist(repo: GameRepository, params: ApplyParams): ApplyResult {
  const now = params.now ?? Date.now()

  // (a) status gate
  const meta = repo.getMeta()
  if (!meta) return { error: 'game_not_found' }
  if (meta.status !== 'active') return { error: 'game_over' }

  const snapshot = repo.getSnapshot()
  if (!snapshot) return { error: 'no_snapshot' }

  const seats = repo.getSeats()
  const seat = seats[params.seatIndex]
  if (!seat) return { error: 'not_your_seat' }

  // (b) authz — must precede idempotency (a duplicate ack below returns a
  // per-seat ClientView, so an unauthorized caller must be rejected before
  // any hand is built, or replaying a known clientMoveId against a seat you
  // don't own would leak that seat's full hand).
  if (!params.byAi && (params.accountId == null || params.accountId !== seat.owner_account_id)) {
    return { error: 'not_your_seat' }
  }

  // (c) idempotency — a duplicate clientMoveId is a benign ack with the
  // CURRENT snapshot for the (now authz-verified) seat. Checked before the
  // TURN check so a reconnect retry never surfaces a false "not your turn".
  if (params.clientMoveId != null && repo.moveExistsByClientId(params.clientMoveId)) {
    return { duplicate: true, view: buildClientView(snapshot, meta, params.seatIndex, seats) }
  }

  // (c2) reclaim-race guard (Wave 3) — re-read turn + AI-control from the
  // freshly-persisted rows and ABORT if a reclaim beat this AI/floor move to
  // the commit. Runs inside the sync span so nothing is written when it fires.
  if (params.requireAiControlled) {
    if (params.expectedSeat == null || meta.current_seat !== params.expectedSeat) {
      return { error: 'reclaimed' }
    }
    const guardSeat = seats[params.expectedSeat]
    if (!guardSeat || !guardSeat.controlled_by_ai) return { error: 'reclaimed' }
  }

  // (d) turn — Jaipur has no wild_recycle analog; every engine action
  // consumes the turn (design spec §3.3), so this is a flat check.
  if (params.seatIndex !== meta.current_seat) {
    return { error: 'not_your_turn' }
  }

  // (e) apply via the engine — the SOLE legality gate.
  const applied = applyAction(snapshot, params.move)
  if (!applied.ok) return { error: applied.error.code }
  const newState = applied.value

  // (f) translated PUBLIC payload, computed from the PRE-move snapshot
  // (ADDENDUM H) — never the raw action (raw hand indices index the private
  // hand array).
  const payload = toPublicPayload(snapshot, params.seatIndex === 0 ? 0 : 1, params.move)

  const moveIndex = meta.move_index + 1
  const turnNumber = repo.countTurnCompletingMoves() + 1

  // (g) write — move row FIRST so a UNIQUE(client_move_id)/PK(move_index)
  // violation (should-be-impossible backstop in a sync span) writes nothing
  // else. On conflict return a benign error so the caller re-syncs, never a
  // 500.
  try {
    repo.insertMove({
      move_index: moveIndex,
      round: meta.round,
      turn_number: turnNumber,
      seat_index: params.seatIndex,
      type: params.move.type,
      payload: JSON.stringify(payload),
      by_ai: params.byAi ?? false,
      ai_difficulty: params.aiDifficulty ?? null,
      controlling_account_id: seat.owner_account_id,
      client_move_id: params.clientMoveId,
      reverted: false,
      created_at: now,
    })
  } catch {
    return { error: 'conflict' }
  }

  let newMeta: MetaRow

  if (newState.phase === 'round-end') {
    // ADDENDUM C/D: round/match transition, same span, mirroring
    // gameStore.ts's offline `nextRound` (~line 286-329) — NOT the buggy
    // online `startNextRound` (`>= 2`).
    const result = scoreRound(newState)
    const newSeals: [number, number] = [
      meta.seals0 + (result.sealAwardedTo === 0 ? 1 : 0),
      meta.seals1 + (result.sealAwardedTo === 1 ? 1 : 0),
    ]
    const sealsNeeded = Math.floor(meta.match_length / 2) + 1
    const matchOver = newSeals[0] >= sealsNeeded || newSeals[1] >= sealsNeeded

    const roundEndIndex = moveIndex + 1
    repo.insertMove({
      move_index: roundEndIndex,
      round: meta.round,
      turn_number: turnNumber,
      seat_index: GLOBAL_SEAT,
      type: 'round_end',
      payload: JSON.stringify({ type: 'round_end', result, seals: newSeals }),
      by_ai: false,
      ai_difficulty: null,
      controlling_account_id: null,
      client_move_id: null,
      reverted: false,
      created_at: now,
    })

    const newStatus: MatchStatus = matchOver ? 'completed' : 'active'
    newMeta = {
      ...meta,
      seals0: newSeals[0],
      seals1: newSeals[1],
      move_index: roundEndIndex,
      phase: matchOver ? 'match_over' : 'round_end',
      status: newStatus,
      winner_seat: matchOver ? (newSeals[0] >= sealsNeeded ? 0 : 1) : meta.winner_seat,
    }
  } else {
    newMeta = {
      ...meta,
      move_index: moveIndex,
      phase: 'playing',
      current_seat: newState.activePlayer,
    }
  }

  repo.putSnapshot(newState)
  repo.putMeta(newMeta)

  return { ok: true, moveIndex: newMeta.move_index, view: buildClientView(newState, newMeta, params.seatIndex, seats) }
}

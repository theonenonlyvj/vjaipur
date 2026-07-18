import { setupRound } from '../../../src/engine'
import type { GameState } from '../../../src/engine'
import { mulberry32 } from '../../../src/shared/rng'
import { GLOBAL_SEAT } from './constants'
import type { GameRepository, MatchLength, MetaRow } from './storage'

/** Fallback engine tag until the engine package exports a version. */
export const ENGINE_VERSION = 'vjaipur-engine@1'

export type CreateWaitingRoomOptions = {
  matchLength: MatchLength
  hostAccountId: string
  hostDisplayName: string
  code: string
  gameUuid?: string
}

/**
 * Create a 2-player waiting room: meta (`status:'waiting'`, `player_count:2`,
 * `seals:[0,0]`, `round:0`, `phase:'playing'`, the chosen `match_length`),
 * seat 0 = the host (human), seat 1 = `'open'` (claimable via `POST /join`).
 * Idempotent: a re-create on an already-initialized DO returns the existing
 * meta untouched (mirrors viota's `createWaitingRoom`/`dealInto`
 * write-once-per-DO idempotency).
 */
export function createWaitingRoom(repo: GameRepository, opts: CreateWaitingRoomOptions): MetaRow {
  const existing = repo.getMeta()
  if (existing) return existing

  const meta: MetaRow = {
    game_uuid: opts.gameUuid ?? crypto.randomUUID(),
    code: opts.code,
    status: 'waiting',
    player_count: 2,
    match_length: opts.matchLength,
    seals0: 0,
    seals1: 0,
    round: 0,
    phase: 'playing',
    current_seat: 0,
    move_index: 0,
    winner_seat: null,
    engine_version: ENGINE_VERSION,
    last_processed_at: null,
  }
  repo.putMeta(meta)

  repo.putSeat({
    seat_index: 0,
    owner_type: 'human',
    owner_account_id: opts.hostAccountId,
    display_name: opts.hostDisplayName,
    controlled_by_ai: false,
    ai_difficulty: null,
    last_seen_at: null,
    disconnected_at: null,
  })
  repo.putSeat({
    seat_index: 1,
    owner_type: 'open',
    owner_account_id: null,
    display_name: null,
    controlled_by_ai: false,
    ai_difficulty: null,
    last_seen_at: null,
    disconnected_at: null,
  })

  return meta
}

/**
 * Deal a round: mints a fresh 32-bit seed from `crypto.getRandomValues`, runs
 * the certified `setupRound(seals, prevLoser, mulberry32(seed))` (the SAME
 * path the offline client uses, per `src/store/gameStore.ts`'s `nextRound`),
 * and persists BOTH the seed and the post-deal state in one `rounds` row
 * (ADDENDUM G — replay can use either once determinism is verified; see
 * `worker/test/determinism.test.ts`). Also appends a server-minted
 * `round_start` move so the continuous move log narrates every round
 * transition (design spec §3.2) — its `seat_index` is the `GLOBAL_SEAT`
 * sentinel (-1) so it can never be confused with a player's move.
 *
 * `meta.seals`/`round`/`phase`/`current_seat`/`move_index` are updated to
 * reflect the new round — MatchState's columns are the ONLY authoritative
 * copies (ADDENDUM D); the embedded engine state's own `seals`/`round`/
 * `phase` fields are setup-time artifacts callers must never read for match
 * logic.
 *
 * Must run inside the caller's `ctx.storage.transactionSync` span (this
 * function itself does no I/O other than synchronous SQL + the RNG seed
 * draw, so it's safe to call from within one).
 */
export function dealRound(
  repo: GameRepository,
  round: number,
  prevLoser: 0 | 1 | undefined,
  now: number = Date.now(),
): GameState {
  const meta = repo.getMeta()
  if (!meta) throw new Error('dealRound: meta not initialized (createWaitingRoom must run first)')

  const seed = crypto.getRandomValues(new Uint32Array(1))[0]!
  const seals: [number, number] = [meta.seals0, meta.seals1]
  const state = setupRound(seals, prevLoser, mulberry32(seed))

  repo.putSnapshot(state)
  repo.putRound(round, seed, state)

  const moveIndex = meta.move_index + 1
  repo.insertMove({
    move_index: moveIndex,
    round,
    turn_number: repo.countTurnCompletingMoves(),
    seat_index: GLOBAL_SEAT,
    type: 'round_start',
    payload: JSON.stringify({ type: 'round_start', round }),
    by_ai: false,
    ai_difficulty: null,
    controlling_account_id: null,
    client_move_id: null,
    reverted: false,
    created_at: now,
  })

  repo.putMeta({
    ...meta,
    round,
    phase: 'playing',
    current_seat: state.activePlayer,
    move_index: moveIndex,
  })

  return state
}

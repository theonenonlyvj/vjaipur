// Client-side mirror of the worker's wire types (worker/src/do/view.ts,
// worker/src/do/stats.ts). Deliberately NOT imported from worker/ — this
// package builds independently of the worker bundle, and worker/ imports
// FROM src/engine, never the other way around. Keep these in sync by hand;
// "trust the code over the doc" per the build brief — these shapes were
// copied from the ACTUAL worker source, not the design doc's pseudo-types
// (e.g. ClientPlayer has no `accountId`/`present` field in the real code).
import type { BonusToken, Card, GoodsToken, RoundResult, TokenPiles } from '../engine'

export type MatchPhase = 'playing' | 'round_end' | 'match_over'
export type SeatOwnerType = 'human' | 'ai' | 'open'

export interface ClientPlayer {
  seat: number
  displayName: string
  ownerType: SeatOwnerType
  controlledByAi: boolean
}

export interface ClientViewGame {
  market: Card[]
  myHand: Card[]
  oppHandCount: number
  herds: [number, number]
  tokens: TokenPiles
  bonusTokenCounts: { three: number; four: number; five: number }
  myGoodsTokens: GoodsToken[]
  oppGoodsTokenCount: number
  myBonusTokens: BonusToken[]
  oppBonusTokens: { tier: 3 | 4 | 5 }[]
  deckCount: number
  myScore: number
  activePlayer: 0 | 1
}

export interface ClientView {
  mySeat: number
  phase: MatchPhase
  round: number
  seals: [number, number]
  matchLength: number
  winnerSeat: 0 | 1 | null
  lastRoundResult: RoundResult | null
  /** NEW (no-AI-takeover rework, 2026-07-18): is the OPPONENT currently
   *  present (heartbeated within the worker's presence window)? Drives the
   *  "waiting for them" banner instead of a silent freeze. See
   *  worker/src/do/view.ts's ClientView docstring. */
  opponentPresent: boolean
  /** NEW: may THIS seat call POST /claim-win right now? True only once the
   *  opponent has been genuinely, continuously absent past the worker's
   *  claim grace window — never merely `!opponentPresent`. Purely a client
   *  affordance; the worker re-validates independently at claim time. */
  claimWinAvailable: boolean
  players: ClientPlayer[]
  game: ClientViewGame
}

export interface WaitingRoomView {
  status: 'waiting'
  code: string | null
  matchLength: number
  seats: { seatIndex: number; ownerType: SeatOwnerType; displayName: string | null }[]
}

export type MoveType = 'TAKE_SINGLE' | 'TAKE_CAMELS' | 'TAKE_EXCHANGE' | 'SELL' | 'round_start' | 'round_end' | 'resign'

export interface ClientMove {
  moveIndex: number
  round: number
  seatIndex: number
  type: MoveType
  payload: unknown
  byAi: boolean
}

export interface SyncResponse {
  moveIndex: number
  view: ClientView
  moves: ClientMove[]
}

export interface CreateGameResponse {
  gameId: string
  code: string
  view: WaitingRoomView
}

export interface JoinResponse {
  seatIndex: 0 | 1
  status: string
  view: ClientView | WaitingRoomView
}

export interface ResolveResponse {
  gameId: string
  status: string
}

export type MoveResult = { ok: true; moveIndex: number; view: ClientView } | { duplicate: true; view: ClientView }

export type NextRoundResult = { view: ClientView } | { already: true; view: ClientView }

export interface ResignResponse {
  view: ClientView
}

/** POST /claim-win success shape. On failure the worker returns 409
 *  `{error:'opponent_present'}` (opponent isn't genuinely absent yet) or 409
 *  `{error:'match_over'}` (raced/already ended) — surfaced as a WorkerError,
 *  not part of this success type. */
export interface ClaimWinResponse {
  view: ClientView
}

export interface ReclaimResponse {
  moveIndex: number
  view: ClientView
}

export interface HeartbeatResponse {
  ok: true
  seat: number
}

export interface LeaveResponse {
  ok: true
  seat: number
}

export interface MyGamesRow {
  gameId: string
  code: string
  status: string
  matchLength: number
  lastActivityAt: number | null
  seatIndex: number
}

export interface MyGamesResponse {
  games: MyGamesRow[]
}

// ---- stats (worker/src/do/stats.ts) ----------------------------------------

export interface LeaderboardRow {
  accountId: string
  displayName: string
  games: number
  wins: number
  winRate: number
}

export interface LeaderboardResponse {
  overall: LeaderboardRow[]
  verified: LeaderboardRow[]
}

export interface MatchHistoryRow {
  id: number
  opponentType: string
  opponentAccountId: string | null
  playerScore: number
  opponentScore: number
  won: boolean
  source: string
  aiCovered: boolean
  gameUuid: string | null
  timestamp: number
}

export interface HistoryResponse {
  matches: MatchHistoryRow[]
}

export interface ReportMatchBody {
  opponent_type: string
  player_score: number
  opponent_score: number
  won: boolean
  timestamp: number
}

export type ReportMatchResult = { ok: true; duplicate?: true }

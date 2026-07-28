// Client-side mirror of the worker's wire types (worker/src/do/view.ts,
// worker/src/do/stats.ts). Deliberately NOT imported from worker/ — this
// package builds independently of the worker bundle, and worker/ imports
// FROM src/engine, never the other way around. Keep these in sync by hand;
// "trust the code over the doc" per the build brief — these shapes were
// copied from the ACTUAL worker source, not the design doc's pseudo-types
// (e.g. ClientPlayer has no `accountId`/`present` field in the real code).
import type { BonusToken, Card, GoodsToken, RoundResult, TokenPiles } from '../engine'
// StyleFinalized is DIFFERENT from every other type in this file: it isn't
// hand-mirrored from worker/ because it doesn't need to be — src/shared/
// styleAgg.ts lives in THIS package (src/), and the worker imports it FROM
// here (same direction as its src/engine/src/ai/tiers imports), so the
// worker's wire shape and this client type are structurally guaranteed to
// match, not just kept in sync by hand.
import type { StyleFinalized } from '../shared/styleAgg'

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

/** Round-end/match_over reveal of the ended round's real per-seat goods
 *  tokens + realized bonus-point SUMS — mirrors
 *  worker/src/do/view.ts's `LastRoundReveal`. Both arrays are indexed by
 *  SEAT (0/1), not mine/opponent — same convention `seals`/`winnerSeat`
 *  already use. */
export interface LastRoundReveal {
  goodsTokens: [GoodsToken[], GoodsToken[]]
  bonusPoints: [number, number]
}

export interface ClientView {
  mySeat: number
  phase: MatchPhase
  round: number
  seals: [number, number]
  matchLength: number
  winnerSeat: 0 | 1 | null
  lastRoundResult: RoundResult | null
  /** The ended round's real opponent goods tokens + both seats' realized
   *  bonus-point sums — ONLY populated at `round_end`/`match_over`, `null`
   *  mid-round. See worker/src/do/view.ts's `ClientView.lastRoundReveal`
   *  docstring for exactly why goods values are safe to reveal here while
   *  individual bonus token values stay hidden (only their SUM is here). */
  lastRoundReveal: LastRoundReveal | null
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
  /** MATCH count (kept for compat — see worker/src/do/stats.ts's
   *  LeaderboardRow docstring). NOT the primary record anymore. */
  games: number
  /** MATCH wins (compat). */
  wins: number
  /** MATCH win rate (compat). */
  winRate: number
  /** Per-GAME win/loss totals — the PRIMARY lifetime record (owner's
   *  2026-07-28 GAMES-first ruling; see worker/src/do/stats.ts's
   *  LeaderboardRow docstring for the exact per-row resolution rule). Also
   *  what the ranking (server-side rankBySkill) is fed. */
  gamesWon: number
  gamesLost: number
}

export interface LeaderboardResponse {
  /** All matches, or (when a filter was requested) only that opponentType's
   *  matches — see worker/src/do/stats.ts's LeaderboardResponse docstring. */
  overall: LeaderboardRow[]
  /** The online_authoritative SUBSET of `overall` (see the worker docstring
   *  for the exact per-filter semantics: empty for an AI-tier filter, equal
   *  to `overall` for the 'online' filter). */
  verified: LeaderboardRow[]
  /** DISTINCT opponent_type values with at least one match — present ONLY on
   *  the unfiltered call (no opponentType passed), so the client knows which
   *  filter toggles to even show. */
  availableOpponents?: string[]
}

export interface MatchHistoryRow {
  id: number
  opponentType: string
  opponentAccountId: string | null
  /** The opponent's resolved display name (worker/src/do/stats.ts#getHistory's
   *  `players` LEFT JOIN) — `null` for a local vs-AI report or the rare
   *  online match whose opponent has no cached `players` row yet. */
  opponentName: string | null
  playerScore: number
  opponentScore: number
  won: boolean
  source: string
  aiCovered: boolean
  gameUuid: string | null
  timestamp: number
  /** This row's per-GAME split — always present (never null); see
   *  worker/src/do/stats.ts#getHistory's MatchHistoryRow docstring for the
   *  exact/approximated resolution rule. */
  gamesWon: number
  gamesLost: number
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
  /** Optional per-move play-by-play for a local vs-ai match (see
   *  src/store/aiGameLog.ts's capLogForReport) — an already-JSON-stringified,
   *  size-capped array. worker/src/do/stats.ts#reportMatch validates it
   *  independently and simply skips storing it (never fails the report) on
   *  anything malformed or oversized. */
  log?: string
  /** Optional exact per-GAME split for this vs-ai match (the match's final
   *  `seals` — see src/store/gameStore.ts's nextRound). Both fields must be
   *  present and sane or the worker skips storing either (never fails the
   *  report over it) — see worker/src/do/stats.ts#reportMatch's docstring. */
  games_won?: number
  games_lost?: number
}

export type ReportMatchResult = { ok: true; duplicate?: true }

// ---- my-style (worker/src/do/style.ts) -------------------------------------

export interface MyStyleAvailableTier {
  tier: string
  games: number
}

/** GET /stats/my-style response — see worker/src/do/style.ts's MyStyleResponse
 *  docstring for the lazy/incremental-cache contract this is backed by. */
export interface MyStyleResponse {
  tier: string
  games: number
  availableTiers: MyStyleAvailableTier[]
  style: StyleFinalized
}

export type { StyleFinalized }

// ---- rivalry (worker/src/do/rivalry.ts) ------------------------------------
//
// VOCABULARY (owner's explicit call, 2026-07-28): a GAME is one deal/round
// (produces a score + a seal); a MATCH is the best-of-N wrapper for one
// sitting (the app's own "MATCH LENGTH: 1 GAME / 3 GAMES" picker). GAMES are
// the lifetime stat (the hero record + streak); MATCHES are session context
// (a secondary line). See worker/src/do/rivalry.ts's file header for the
// full rationale — these types are its RivalryResponse, hand-mirrored.

export interface RivalryStreak {
  who: 'me' | 'them'
  n: number
}

export interface RivalryGamesRecord {
  wins: number
  losses: number
  currentStreak: RivalryStreak
}

export interface RivalryMatchesRecord {
  wins: number
  losses: number
}

export interface RivalryRecord {
  games: RivalryGamesRecord
  matches: RivalryMatchesRecord
}

export interface RivalryTotals {
  myPoints: number
  theirPoints: number
  /** [mine, theirs] */
  gamesWon: [number, number]
  /** [mine, theirs] */
  camelMajorityGames: [number, number]
}

export interface RivalryBiggestGame {
  myScore: number
  theirScore: number
  matchCode: string
  gameNumber: number
}

export interface RivalryPerGameEntry {
  matchCode: string
  gameNumberInMatch: number
  myScore: number
  theirScore: number
  won: boolean
  endedAt: number | null
}

export interface RivalryTokensPerCard {
  mine: number
  theirs: number
  myCards: number
  theirCards: number
  eligible: boolean
}

export interface RivalryBonusSales {
  mine3: number
  mine4: number
  mine5: number
  theirs3: number
  theirs4: number
  theirs5: number
  eligible: boolean
}

export interface RivalryCraft {
  tokensPerCard: RivalryTokensPerCard
  bonusSales: RivalryBonusSales
}

/** `GET /stats/rivalry?opponent=` response — see worker/src/do/rivalry.ts's
 *  RivalryResponse docstring for what each field means and the games-vs-
 *  matches distinction. */
export interface RivalryResponse {
  opponentName: string
  record: RivalryRecord
  totals: RivalryTotals
  biggestGame: RivalryBiggestGame | null
  perGame: RivalryPerGameEntry[]
  craft: RivalryCraft
  edgeFinder: string
}

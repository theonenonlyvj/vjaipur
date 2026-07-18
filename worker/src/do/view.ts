import { scoreRound } from '../../../src/engine'
import type {
  BonusToken,
  Card,
  GameState,
  GoodsToken,
  RoundResult,
  TokenPiles,
} from '../../../src/engine'
import type { GameRepository, MatchPhase, MetaRow, MoveRow, SeatRow } from './storage'

/**
 * ADDENDUM I — the redaction-critical view builder. `ClientView` is a CLOSED
 * allowlist, never a denylist: only fields listed here are ever serialized.
 * Audited against `src/screens/GameScreen.tsx` + `StatusBar.tsx` +
 * `OpponentStrip.tsx` + `MarketRow`/`HandRow`/`ScoreCard`/`TokenRail` for the
 * exact data those components render.
 *
 * NEVER emitted, anywhere in `game`: the opponent's hand cards, deck
 * contents/order, the round seed, the opponent's bonus-token VALUES, or the
 * opponent's running score mid-round (scores go public only via
 * `lastRoundResult`, at `round_end`/`match_over`).
 *
 * One addition beyond the addendum's literal field list: `bonusTokenCounts`
 * (the board's remaining three/four/five bonus-pile COUNTS — never values,
 * which are face-down/shuffled). `TokenRail.tsx` (used by `GameScreen.tsx`)
 * renders exactly this — the pile counts are public (everyone can see how
 * many face-down tokens remain in each tier), so this extends the allowlist
 * deliberately rather than opportunistically; it is still a closed field,
 * still counts-only, never the (face-down, private-until-drawn) values.
 */
export type ClientPlayer = {
  seat: number
  displayName: string
  ownerType: SeatRow['owner_type']
  controlledByAi: boolean
}

export type ClientView = {
  mySeat: number
  phase: MatchPhase
  round: number
  seals: [number, number]
  matchLength: number
  winnerSeat: 0 | 1 | null
  /** Full RoundResult (scores + camelWinner + sealAwardedTo) — ONLY populated
   *  at `round_end`/`match_over` (scores are private information mid-round). */
  lastRoundResult: RoundResult | null
  players: ClientPlayer[]
  game: {
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
}

/** A seat's public display label: its real name when set, else an
 *  ownerType-appropriate placeholder (never a fabricated "Player N" for a
 *  real human whose name just hasn't synced yet vs. a genuinely open seat). */
function playerLabel(s: SeatRow): string {
  if (s.display_name && s.display_name.length > 0) return s.display_name
  if (s.owner_type === 'open') return 'Open'
  return `Player ${s.seat_index + 1}`
}

export function buildPlayerRoster(seats: SeatRow[]): ClientPlayer[] {
  return seats.map((s) => ({
    seat: s.seat_index,
    displayName: playerLabel(s),
    ownerType: s.owner_type,
    controlledByAi: s.controlled_by_ai,
  }))
}

function ownScore(player: GameState['players'][0]): number {
  const goods = player.tokens.reduce((s, t) => s + t.value, 0)
  const bonus = player.bonusTokens.reduce((s, t) => s + t.value, 0)
  return goods + bonus
}

/**
 * Build the per-seat redacted view. `state` is the CURRENT round's snapshot;
 * `meta` is MatchState (the ONLY authoritative seals/round/phase — ADDENDUM
 * D). At `round_end`/`match_over`, `state` is still the just-ended round's
 * final GameState (the DO never advances the snapshot until the next
 * `dealRound`), so `scoreRound(state)` recomputes the SAME `RoundResult`
 * `src/screens/RoundEndScreen.tsx` computes client-side offline — no separate
 * storage/threading needed for `lastRoundResult`.
 */
export function buildClientView(
  state: GameState,
  meta: MetaRow,
  seatIndex: number,
  seats: SeatRow[],
): ClientView {
  const mine = seatIndex === 0 ? 0 : 1
  const oppIndex = mine === 0 ? 1 : 0
  const me = state.players[mine]
  const opp = state.players[oppIndex]

  const lastRoundResult: RoundResult | null =
    meta.phase === 'round_end' || meta.phase === 'match_over' ? scoreRound(state) : null

  return {
    mySeat: seatIndex,
    phase: meta.phase,
    round: meta.round,
    seals: [meta.seals0, meta.seals1],
    matchLength: meta.match_length,
    winnerSeat: meta.winner_seat,
    lastRoundResult,
    players: buildPlayerRoster(seats),
    game: {
      market: state.market,
      myHand: me.hand,
      oppHandCount: opp.hand.length,
      herds: [state.players[0].herd, state.players[1].herd],
      tokens: state.tokens,
      bonusTokenCounts: {
        three: state.bonusTokens.three.length,
        four: state.bonusTokens.four.length,
        five: state.bonusTokens.five.length,
      },
      myGoodsTokens: me.tokens,
      oppGoodsTokenCount: opp.tokens.length,
      myBonusTokens: me.bonusTokens,
      oppBonusTokens: opp.bonusTokens.map((t) => ({ tier: t.tier })),
      deckCount: state.deck.length,
      myScore: ownScore(me),
      activePlayer: state.activePlayer,
    },
  }
}

/**
 * The waiting-room roster — the public projection of a `'waiting'` game (no
 * board, no deal yet).
 */
export type WaitingRoomView = {
  status: 'waiting'
  code: string | null
  matchLength: number
  seats: { seatIndex: number; ownerType: SeatRow['owner_type']; displayName: string | null }[]
}

export function buildWaitingRoomView(repo: GameRepository): WaitingRoomView {
  const meta = repo.getMeta()
  const seats = repo.getSeats()
  return {
    status: 'waiting',
    code: meta?.code ?? null,
    matchLength: meta?.match_length ?? 3,
    seats: seats.map((s) => ({
      seatIndex: s.seat_index,
      ownerType: s.owner_type,
      displayName: s.display_name,
    })),
  }
}

/**
 * Public projection of a persisted move row for `/sync` clients. Unlike
 * viota's `toClientMove` (which redacts a `pass` move's private trade cards
 * at READ time), `moves.payload` here is ALREADY the translated public
 * payload — computed once, at COMMIT time, by `do/publicPayload.ts`
 * (ADDENDUM H) — so this is a plain parse, not a second redaction pass.
 */
export type ClientMove = {
  moveIndex: number
  round: number
  seatIndex: number
  type: MoveRow['type']
  payload: unknown
  byAi: boolean
}

export function toClientMove(m: MoveRow): ClientMove {
  return {
    moveIndex: m.move_index,
    round: m.round,
    seatIndex: m.seat_index,
    type: m.type,
    payload: JSON.parse(m.payload),
    byAi: m.by_ai,
  }
}

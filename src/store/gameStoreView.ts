// Pure display/adapter helpers for gameStore.ts — human-readable move
// descriptions, error-code -> message lookups, and the redacted-ClientView
// -> renderable-GameState projection. Extracted verbatim (no logic changes)
// so gameStore.ts's own file stays focused on state/actions. `GameStore` is
// imported type-only, so this doesn't create a real runtime circular
// dependency with gameStore.ts (which imports back from here).
import type { GameState, Action, Card, PlayerState, Phase } from '../engine'
import { Errors } from '../engine'
import type { ClientView, ClientMove, MoveType } from '../net/types'
import type { GameStore } from './gameStore'

export function countItems(items: string[]): string {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1)
  return Array.from(counts.entries()).map(([type, count]) => {
    const label = count > 1 ? (type === 'spice' ? 'spice' : type + 's') : type
    return `${count} ${label}`
  }).join(' and ')
}

export function describeAction(name: string, action: Action, state?: GameState): string {
  const prefix = `${name.toUpperCase()}: `
  switch (action.type) {
    case 'TAKE_SINGLE': {
      const type = state?.market[action.marketIndex]?.type ?? 'card'
      return `${prefix}took a ${type}`
    }
    case 'TAKE_CAMELS': {
      const count = state ? state.market.filter(c => c.type === 'camel').length : 1
      return `${prefix}took ${count} camel${count === 1 ? '' : 's'}`
    }
    case 'TAKE_EXCHANGE': {
      if (!state) return `${prefix}made an exchange`
      const player = state.players[state.activePlayer]

      const takenTypes = action.marketIndices.map(i => state.market[i]?.type ?? '?')
      const taken = countItems(takenTypes)

      const givenGoods = action.handIndices
        .filter(i => i !== -1)
        .map(i => player.hand[i]?.type ?? '?')
      const camelsGiven = action.handIndices.filter(i => i === -1).length

      const givenParts = []
      if (givenGoods.length > 0) givenParts.push(countItems(givenGoods))
      if (camelsGiven > 0) givenParts.push(`${camelsGiven} camel${camelsGiven > 1 ? 's' : ''}`)

      return `${prefix}traded ${givenParts.join(' and ')} for ${taken}`
    }
    case 'SELL':
      return `${prefix}sold ${action.quantity} ${action.good}`
  }
}

/** Same human-readable style as describeAction, but sourced from the
 *  TRANSLATED PUBLIC move payload (worker/src/do/publicPayload.ts's shapes)
 *  instead of a raw action + private state — this is what a synced
 *  ClientMove (mine or the opponent's) carries, since the opponent's hand is
 *  never visible to us. */
export function describePublicMove(name: string, type: MoveType, payload: unknown): string {
  const prefix = `${name.toUpperCase()}: `
  const p = (payload ?? {}) as Record<string, unknown>
  switch (type) {
    case 'TAKE_SINGLE': {
      const card = p.takenCard as Card | undefined
      return `${prefix}took a ${card?.type ?? 'card'}`
    }
    case 'TAKE_CAMELS': {
      const count = typeof p.count === 'number' ? p.count : 1
      return `${prefix}took ${count} camel${count === 1 ? '' : 's'}`
    }
    case 'TAKE_EXCHANGE': {
      const takenCards = (p.takenCards as Card[] | undefined) ?? []
      const givenGoods = (p.givenGoods as Card[] | undefined) ?? []
      const camelsGiven = typeof p.camelsGiven === 'number' ? p.camelsGiven : 0
      const taken = countItems(takenCards.map(c => c.type))
      const givenParts: string[] = []
      if (givenGoods.length > 0) givenParts.push(countItems(givenGoods.map(c => c.type)))
      if (camelsGiven > 0) givenParts.push(`${camelsGiven} camel${camelsGiven > 1 ? 's' : ''}`)
      return `${prefix}traded ${givenParts.join(' and ')} for ${taken}`
    }
    case 'SELL': {
      const count = typeof p.count === 'number' ? p.count : 0
      const good = typeof p.good === 'string' ? p.good : 'goods'
      return `${prefix}sold ${count} ${good}`
    }
    case 'resign':
      return `${prefix}resigned`
    default:
      return `${prefix}made a move`
  }
}

const ENGINE_ERROR_MESSAGES: Record<string, string> = Object.fromEntries(
  Object.values(Errors).map((e) => [e.code, e.message]),
)

const WORKER_ERROR_MESSAGES: Record<string, string> = {
  not_your_turn: "It's not your turn.",
  not_your_seat: "That's not your seat.",
  game_over: 'This match has already ended.',
  conflict: 'Something went out of sync — refreshing.',
  reclaimed: 'Your seat changed hands — refreshing.',
  invalid_seat: 'Invalid move — refreshing.',
  invalid_client_move_id: 'Invalid move — please try again.',
  game_not_found: 'This game could not be found.',
  no_snapshot: 'This game could not be found.',
}

export function onlineErrorMessage(code: string): string {
  return ENGINE_ERROR_MESSAGES[code] ?? WORKER_ERROR_MESSAGES[code] ?? "That move wasn't accepted — try again."
}

/** A never-face-rendered filler card — used ONLY for the opponent's hand/deck
 *  placeholder arrays in viewToRenderState, whose real contents are never
 *  sent to the client (redaction). Negative ids keep them visibly distinct
 *  from real card ids (which are always >= 0) in case anything ever logs one. */
function placeholderCard(id: number): Card {
  return { id, type: 'leather' }
}

/**
 * Adapts a redacted ClientView into the same GameState shape every existing
 * render component (MarketRow, HandRow, OpponentStrip, StatusBar, TokenRail,
 * ActionBar, ScoreCard...) already knows how to draw — so none of them need
 * to change for online play. `players` is indexed by SEAT (players[0] =
 * seat 0's state), matching how the screens already pick "me" vs "opponent"
 * via `onlinePlayerIndex` in online mode. Placeholder cards/tokens carry only
 * a count's worth of filler entries — every component that touches the
 * opponent's hand/tokens must render counts only (OpponentStrip) or nothing
 * at all (MarketRow only renders the market, which is real/public).
 */
export function viewToRenderState(view: ClientView): GameState {
  const g = view.game
  const mySeat: 0 | 1 = view.mySeat === 1 ? 1 : 0
  const oppSeat: 0 | 1 = mySeat === 0 ? 1 : 0

  const me: PlayerState = {
    hand: g.myHand,
    herd: g.herds[mySeat],
    tokens: g.myGoodsTokens,
    bonusTokens: g.myBonusTokens,
  }
  // At round_end/match_over, view.lastRoundReveal carries the ended round's
  // REAL opponent goods tokens (worker/src/do/view.ts's ClientView docstring
  // — goods values are public-derivable from the token rail by round end, so
  // the server reveals them instead of the client synthesizing fake
  // placeholders). Use those when present; fall back to the mid-round
  // zero-value placeholder (also covers an older server during deploy skew,
  // which simply never populates lastRoundReveal). Bonus tokens stay
  // tier-only placeholders regardless — individual bonus VALUES are never
  // revealed (see the same docstring); only their SUM travels, via
  // ScoreCard's bonusPointsOverride (RoundEndScreen.tsx), not through this
  // GameState projection.
  const revealedOppGoods = view.lastRoundReveal?.goodsTokens[oppSeat]
  const opponent: PlayerState = {
    hand: Array.from({ length: g.oppHandCount }, (_, i) => placeholderCard(-(i + 1))),
    herd: g.herds[oppSeat],
    tokens: revealedOppGoods ?? Array.from({ length: g.oppGoodsTokenCount }, () => ({ good: 'leather' as const, value: 0 })),
    bonusTokens: g.oppBonusTokens.map((t) => ({ tier: t.tier, value: 0 })),
  }

  const players: [PlayerState, PlayerState] = mySeat === 0 ? [me, opponent] : [opponent, me]

  const phase: Phase = view.phase === 'playing' ? 'playing' : view.phase === 'round_end' ? 'round-end' : 'game-over'

  return {
    phase,
    round: view.round,
    activePlayer: g.activePlayer,
    market: g.market,
    // Deck contents/order are never sent (redaction) — only the count. A
    // deck-length placeholder is enough for every component that touches
    // `deck` (they all just read `.length`).
    deck: Array.from({ length: g.deckCount }, (_, i) => placeholderCard(-(1000 + i))),
    discard: [],
    revealedHands: [[], []],
    players,
    tokens: g.tokens,
    bonusTokens: {
      three: Array.from({ length: g.bonusTokenCounts.three }, () => ({ tier: 3 as const, value: 0 })),
      four: Array.from({ length: g.bonusTokenCounts.four }, () => ({ tier: 4 as const, value: 0 })),
      five: Array.from({ length: g.bonusTokenCounts.five }, () => ({ tier: 5 as const, value: 0 })),
    },
    seals: view.seals,
  }
}

export function computeMatchScoresFromMoves(moves: ClientMove[]): [number, number] {
  let totals: [number, number] = [0, 0]
  for (const m of moves) {
    if (m.type !== 'round_end') continue
    const payload = m.payload as { result?: { scores?: [number, number] } } | null
    const scores = payload?.result?.scores
    if (scores) totals = [totals[0] + scores[0], totals[1] + scores[1]]
  }
  return totals
}

export function applyMoveDescription(
  moves: ClientMove[],
  get: () => GameStore,
  set: (partial: Partial<GameStore>) => void,
): void {
  if (moves.length === 0) return
  const onlineView = get().onlineView
  if (!onlineView) return
  // Walk newest-first; round_start doesn't need narration (the phase/round
  // transition itself is visible in the UI), round_end/resign get a short
  // label, and any real action gets the full public-payload description.
  for (let i = moves.length - 1; i >= 0; i--) {
    const m = moves[i]
    // A round_start reached BEFORE any real action means the CURRENT round
    // genuinely has no moves yet — this must CLEAR the banner and stop, not
    // just `continue` past it. Bug (2026-07-27, confirmed from live play +
    // the D1 archive): a nudge right after /next-round typically delivers
    // ONLY the bare round_start move (the ended round's real actions were
    // already synced/described earlier, before the round ended) — `continue`
    // would fall through this loop having never called set(), leaving
    // lastMoveDescription stuck on the PREVIOUS round's last move (e.g. "YOU:
    // sold 3 silver") lingering as the banner into the new round.
    if (m.type === 'round_start') {
      set({ lastMoveDescription: null })
      return
    }
    // round_end doesn't need narration here — the phase/round transition and
    // the ScoreCard breakdown already show the round outcome; skipping it
    // lets the last REAL action's description read naturally as "Final Play"
    // on RoundEndScreen instead of being clobbered.
    if (m.type === 'round_end') continue
    const name = m.seatIndex === onlineView.mySeat ? 'YOU' : (get().opponentName || 'Opponent')
    set({ lastMoveDescription: describePublicMove(name, m.type, m.payload) })
    return
  }
}

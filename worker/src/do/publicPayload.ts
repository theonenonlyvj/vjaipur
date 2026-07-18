import type { Action, Card, GameState } from '../../../src/engine'

/**
 * ADDENDUM H — the redaction-critical translation. Computes the PUBLIC move
 * payload from the authoritative PRE-move `GameState`, never the raw
 * `{marketIndices, handIndices}` action (raw hand indices index the PRIVATE
 * hand array and are meaningless — and a leak — without it). This is what
 * gets stored in `moves.payload` and served via `/sync`/`toClientMove`
 * (do/view.ts) — every one of these fields is genuinely public information
 * in real Jaipur (a sale's cards, a single-take's card, an exchange's
 * given/taken cards are all visible on the table/market).
 *
 * `preState` is the snapshot BEFORE the move is applied — do/apply.ts must
 * call this before overwriting the snapshot with the engine's result.
 *
 * Bonus-tier derivation (SELL) mirrors `src/engine/scoring... /engine.ts`'s
 * `sell()` exactly (same tier thresholds, same "only if that tier's pile
 * still has a token" gate) — it's a pure function of `preState` + `quantity`
 * (the tier pile can only shrink, never regrow, so pre-move availability IS
 * whether one was drawn), so no post-move state is needed.
 */
export function toPublicPayload(
  preState: GameState,
  seatIndex: 0 | 1,
  action: Action,
): Record<string, unknown> {
  switch (action.type) {
    case 'TAKE_SINGLE': {
      return { type: action.type, takenCard: preState.market[action.marketIndex] }
    }
    case 'TAKE_CAMELS': {
      const count = preState.market.filter((c) => c.type === 'camel').length
      return { type: action.type, count }
    }
    case 'TAKE_EXCHANGE': {
      const hand = preState.players[seatIndex].hand
      const takenCards: Card[] = action.marketIndices.map((i) => preState.market[i]!)
      const givenGoods: Card[] = action.handIndices.filter((i) => i !== -1).map((i) => hand[i]!)
      const camelsGiven = action.handIndices.filter((i) => i === -1).length
      return { type: action.type, takenCards, givenGoods, camelsGiven }
    }
    case 'SELL': {
      const hand = preState.players[seatIndex].hand
      const inHand = hand.filter((c) => c.type === action.good)
      const cards = inHand.slice(0, action.quantity)
      const payload: Record<string, unknown> = {
        type: action.type,
        good: action.good,
        cards,
        count: action.quantity,
      }
      const q = action.quantity
      const bonusTokens = preState.bonusTokens
      if (q >= 5 && bonusTokens.five.length > 0) payload.bonusTier = 5
      else if (q === 4 && bonusTokens.four.length > 0) payload.bonusTier = 4
      else if (q === 3 && bonusTokens.three.length > 0) payload.bonusTier = 3
      return payload
    }
  }
}

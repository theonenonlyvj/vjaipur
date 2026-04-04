import type { GameState, Action, Good, Card, CardType } from '../engine'
import { getLegalActions, applyAction, scoreRound } from '../engine'
import { getProfitableExchanges, getAllProfitableExchanges } from './mediumAi'

const DECK_COMPOSITION: Record<CardType, number> = {
  diamond: 6, gold: 6, silver: 6, cloth: 8, spice: 8, leather: 10, camel: 11,
}

const ALL_TYPES: CardType[] = ['diamond', 'gold', 'silver', 'cloth', 'spice', 'leather', 'camel']

export class OpponentTracker {
  knownInHand: Card[] = []
  unknownInHand: number

  constructor(initialHandLength: number) {
    this.unknownInHand = initialHandLength
  }

  opponentTookFromMarket(card: Card): void {
    this.knownInHand.push(card)
  }

  opponentSoldOrGave(card: Card): void {
    const idx = this.knownInHand.findIndex(c => c.id === card.id)
    if (idx >= 0) {
      this.knownInHand.splice(idx, 1)
    } else {
      this.unknownInHand = Math.max(0, this.unknownInHand - 1)
    }
  }

  computeUnaccounted(
    myHand: Card[],
    myCamels: number,
    market: Card[],
    discard: Card[],
    oppHerd: number,
  ): Record<CardType, number> {
    const counts: Record<CardType, number> = { ...DECK_COMPOSITION }
    for (const card of myHand) counts[card.type]--
    counts.camel -= myCamels
    for (const card of market) counts[card.type]--
    for (const card of discard) counts[card.type]--
    for (const card of this.knownInHand) counts[card.type]--
    counts.camel -= oppHerd
    for (const type of ALL_TYPES) {
      if (counts[type] < 0) counts[type] = 0
    }
    return counts
  }

  expectedInOpponentHand(good: Good, unaccounted: Record<CardType, number>): number {
    if (this.unknownInHand === 0) return 0
    const total = Object.values(unaccounted).reduce((s, n) => s + n, 0)
    if (total === 0) return 0
    return unaccounted[good] * (this.unknownInHand / total)
  }

  opponentEffective(good: Good, unaccounted: Record<CardType, number>): number {
    const known = this.knownInHand.filter(c => c.type === good).length
    return known + this.expectedInOpponentHand(good, unaccounted)
  }
}

const GOOD_ORDER: Good[] = ['diamond', 'gold', 'silver', 'cloth', 'spice', 'leather']
const MIN_SELL: Record<Good, number> = {
  diamond: 2, gold: 2, silver: 2, cloth: 1, spice: 1, leather: 1,
}
const PRECIOUS: ReadonlySet<Good> = new Set(['diamond', 'gold', 'silver'])

function goodCount(hand: Card[], good: Good): number {
  return hand.filter(c => c.type === good).length
}

function sumTopN(pile: readonly number[], n: number): number {
  return pile.slice(0, n).reduce((s, v) => s + v, 0)
}

function isEndgame(state: GameState): boolean {
  const depletedPiles = GOOD_ORDER.filter(g => state.tokens[g].length === 0).length
  const nearDepletedPiles = GOOD_ORDER.filter(g => state.tokens[g].length > 0 && state.tokens[g].length <= 2).length
  return (depletedPiles >= 1 && nearDepletedPiles >= 1) || state.deck.length <= 10
}

function evalPosition(state: GameState, myIndex: 0 | 1, tracker: OpponentTracker, realMarketIds: ReadonlySet<number>): number {
  if (state.phase === 'round-end') {
    const result = scoreRound(state)
    if (result.sealAwardedTo === myIndex) return 10_000
    if (result.sealAwardedTo === null) return 0
    return -10_000
  }

  const me = state.players[myIndex]
  const opp = state.players[myIndex === 0 ? 1 : 0]
  const unaccounted = tracker.computeUnaccounted(
    me.hand, me.herd, state.market, state.discard, opp.herd,
  )
  let score = 0

  // 1. Realized rupee differential (x2.0)
  const myPts = me.tokens.reduce((s, t) => s + t.value, 0)
  const oppPts = opp.tokens.reduce((s, t) => s + t.value, 0)
  score += (myPts - oppPts) * 2.0

  // 2. Bonus token differential (x1.5) — own exact, opponent estimated by tier midpoint
  const myBonus = me.bonusTokens.reduce((s, t) => s + t.value, 0)
  const TIER_MIDPOINT: Record<number, number> = { 3: 2, 4: 5, 5: 9 }
  const oppBonus = opp.bonusTokens.reduce((s, t) => s + (TIER_MIDPOINT[t.tier] ?? t.value), 0)
  score += (myBonus - oppBonus) * 1.5

  // 3. Sellable goods with urgency — uses opponentEffective
  for (const good of GOOD_ORDER) {
    const pile = state.tokens[good] as readonly number[]
    const topValue = pile[0] ?? 0
    if (topValue === 0) continue

    const urgency = pile.length <= 2 ? 2.5 : pile.length <= 4 ? 1.7 : 1.0
    const precious = PRECIOUS.has(good)
    const minSell = MIN_SELL[good]

    const myCount = goodCount(me.hand, good)
    const oppEffective = tracker.opponentEffective(good, unaccounted)

    if (myCount >= minSell) {
      score += sumTopN(pile, myCount) * urgency * (precious ? 1.6 : 1.1)
    } else if (myCount > 0) {
      score += topValue * myCount * (precious ? 0.9 : 0.4)
    }

    if (oppEffective >= minSell) {
      score -= sumTopN(pile, Math.ceil(oppEffective)) * urgency * 0.9
    } else if (oppEffective > 0.5) {
      score -= topValue * oppEffective * (precious ? 0.6 : 0.2)
    }
  }

  // 4. Market tempo — precious completing a pair
  // Cards drawn during search (not in realMarketIds) are weighted by probability
  const totalUnaccounted = Object.values(unaccounted).reduce((s, n) => s + n, 0)
  const deckSize = state.deck.length
  for (const card of state.market) {
    if (card.type === 'camel') continue
    const good = card.type as Good
    const topValue = state.tokens[good][0] ?? 0
    if (!PRECIOUS.has(good) || topValue === 0) continue
    const myCount = goodCount(me.hand, good)
    const tempoValue = myCount >= 1 ? topValue * 1.8 : topValue * 0.8
    if (realMarketIds.has(card.id)) {
      score += tempoValue
    } else {
      // Card drawn during search — weight by probability it's actually this type
      const prob = totalUnaccounted > 0 ? unaccounted[good] / totalUnaccounted : 0
      score += tempoValue * prob
    }
  }

  // 5. Nonlinear camel value with oppMaxCamels
  // All unaccounted camels are in the deck — camels never enter hands
  const expectedCamelsInDeck = unaccounted.camel
  const camelsInMarket = state.market.filter(c => c.type === 'camel').length
  const oppMaxCamels = opp.herd + camelsInMarket + expectedCamelsInDeck
  if (me.herd > oppMaxCamels) score += 5
  else if (me.herd > opp.herd) score += 3
  else if (me.herd === opp.herd) { /* 0 */ }
  else if (me.herd + camelsInMarket + expectedCamelsInDeck >= opp.herd) score -= 3
  else score -= 5

  // 6. Hand pressure
  if (me.hand.length >= 6) score -= 4
  if (opp.hand.length >= 6) score += 3

  // 7. Token depletion cascade — round-ending sell detection
  for (const good of GOOD_ORDER) {
    const pile = state.tokens[good] as readonly number[]
    const myCount = goodCount(me.hand, good)
    if (myCount >= MIN_SELL[good] && myCount >= pile.length && pile.length > 0) {
      const depletedAfter = GOOD_ORDER.filter(g =>
        g === good ? true : state.tokens[g].length === 0
      ).length
      if (depletedAfter >= 3) {
        const myTotal = myPts + myBonus + sumTopN(pile, myCount)
        const oppTotal = oppPts + oppBonus
        score += myTotal > oppTotal ? 15 : -15
      }
    }
  }

  // 8. Market-context "almost sellable" — value cards one away from sellable
  // Cards drawn during search weighted by probability
  for (const card of state.market) {
    if (card.type === 'camel') continue
    const good = card.type as Good
    const topValue = state.tokens[good][0] ?? 0
    if (topValue === 0) continue
    const weight = realMarketIds.has(card.id)
      ? 1
      : (totalUnaccounted > 0 ? unaccounted[good] / totalUnaccounted : 0)
    const myCount = goodCount(me.hand, good)
    if (myCount === MIN_SELL[good] - 1) {
      score += topValue * (PRECIOUS.has(good) ? 2.2 : 1.2) * weight
    }
    const oppEff = tracker.opponentEffective(good, unaccounted)
    if (oppEff >= MIN_SELL[good] - 1 && oppEff < MIN_SELL[good]) {
      score -= topValue * (PRECIOUS.has(good) ? 1.4 : 0.6) * weight
    }
  }

  // 9. Sell timing pressure — opponent may sell first
  for (const good of GOOD_ORDER) {
    const pile = state.tokens[good] as readonly number[]
    const oppEffective = tracker.opponentEffective(good, unaccounted)
    if (oppEffective >= MIN_SELL[good] && pile.length <= 3 && pile.length > 0) {
      const myCount = goodCount(me.hand, good)
      if (myCount >= MIN_SELL[good]) {
        score += (pile[0] ?? 0) * 1.5
      }
    }
  }

  return score
}

function orderActions(actions: Action[], state: GameState, myIndex: 0 | 1): Action[] {
  const me = state.players[myIndex]
  const priority = (a: Action): number => {
    if (a.type === 'SELL') {
      const topValue = state.tokens[a.good][0] ?? 0
      return 2000 + topValue * a.quantity
    }
    if (a.type === 'TAKE_SINGLE') {
      const card = state.market[a.marketIndex]
      if (!card || card.type === 'camel') return 200
      const good = card.type as Good
      const topValue = state.tokens[good][0] ?? 0
      if (PRECIOUS.has(good)) {
        const myCount = goodCount(me.hand, good)
        return myCount >= 1 ? 1800 + topValue : 1000 + topValue
      }
      return 500 + topValue
    }
    if (a.type === 'TAKE_EXCHANGE') return 600
    if (a.type === 'TAKE_CAMELS') return 300
    return 0
  }
  return [...actions].sort((a, b) => priority(b) - priority(a))
}

// FAIRNESS CONSTRAINTS:
// 1. When unknownInHand > 0: search is depth-1 only (bot's own moves). We can't simulate
//    opponent moves because getLegalActions reads their full hand. The eval uses probability-
//    weighted opponent holdings instead. Future: hybrid approach — enumerate moves for known
//    cards, probability-weight moves involving unknown cards.
// 2. Market draws: applyAction draws deck[0] but eval discounts drawn cards via realMarketIds
//    probability weighting. The bot plans around the distribution, not the specific draw.
// 3. When unknownInHand === 0: full alpha-beta (both sides), opponent hand is fully known.
function alphabeta(
  state: GameState,
  depth: number,
  alpha: number,
  beta: number,
  myIndex: 0 | 1,
  tracker: OpponentTracker,
  realMarketIds: ReadonlySet<number>,
): number {
  if (state.phase !== 'playing' || depth === 0) {
    return evalPosition(state, myIndex, tracker, realMarketIds)
  }

  const rawActions = [...getLegalActions(state), ...getProfitableExchanges(state)]
  if (rawActions.length === 0) return evalPosition(state, myIndex, tracker, realMarketIds)
  const actions = orderActions(rawActions, state, myIndex)

  if (state.activePlayer === myIndex) {
    let best = -Infinity
    for (const action of actions) {
      const result = applyAction(state, action)
      if (!result.ok) continue
      const s = alphabeta(result.value, depth - 1, alpha, beta, myIndex, tracker, realMarketIds)
      if (s > best) best = s
      if (best > alpha) alpha = best
      if (alpha >= beta) break
    }
    return best === -Infinity ? evalPosition(state, myIndex, tracker, realMarketIds) : best
  } else {
    let best = Infinity
    for (const action of actions) {
      const result = applyAction(state, action)
      if (!result.ok) continue
      const s = alphabeta(result.value, depth - 1, alpha, beta, myIndex, tracker, realMarketIds)
      if (s < best) best = s
      if (best < beta) beta = best
      if (alpha >= beta) break
    }
    return best === Infinity ? evalPosition(state, myIndex, tracker, realMarketIds) : best
  }
}

export function pickFairBotAction(state: GameState, tracker: OpponentTracker): Action | null {
  if (state.phase !== 'playing') return null
  const myIndex = state.activePlayer

  const rootActions = orderActions(
    [...getLegalActions(state), ...getAllProfitableExchanges(state)],
    state,
    myIndex,
  )
  if (rootActions.length === 0) return null
  if (rootActions.length === 1) return rootActions[0]

  // Track which market cards are real (visible now) vs drawn during search
  const realMarketIds = new Set(state.market.map(c => c.id))

  // When opponent hand is partially unknown, we can't simulate their moves
  // (getLegalActions would read their actual hand). Use depth-1 eval only.
  if (tracker.unknownInHand > 0) {
    let bestAction = rootActions[0]
    let bestScore = -Infinity
    for (const action of rootActions) {
      const result = applyAction(state, action)
      if (!result.ok) continue
      const s = evalPosition(result.value, myIndex, tracker, realMarketIds)
      if (s > bestScore) {
        bestScore = s
        bestAction = action
      }
    }
    return bestAction
  }

  // Opponent hand fully known — full alpha-beta search
  const canSolveEndgame = isEndgame(state)
  const normalDeadline = Date.now() + 7000
  const endgameDeadline = Date.now() + 12000
  const deadline = canSolveEndgame ? endgameDeadline : normalDeadline
  const depthCap = canSolveEndgame ? 99 : 6

  let bestAction = rootActions[0]

  for (let depth = 2; depth <= depthCap; depth++) {
    if (Date.now() >= deadline) break

    let depthBest = rootActions[0]
    let depthBestScore = -Infinity
    let completedDepth = true

    for (const action of rootActions) {
      if (Date.now() >= deadline) { completedDepth = false; break }
      const result = applyAction(state, action)
      if (!result.ok) continue
      const s = alphabeta(result.value, depth - 1, -Infinity, Infinity, myIndex, tracker, realMarketIds)
      if (s > depthBestScore) {
        depthBestScore = s
        depthBest = action
      }
    }

    if (completedDepth) bestAction = depthBest
  }

  return bestAction
}

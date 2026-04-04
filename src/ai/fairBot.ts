import type { GameState, Action, Good, Card, CardType } from '../engine'
import { getLegalActions, applyAction, scoreRound, sortHand } from '../engine'
import { getProfitableExchanges, getAllProfitableExchanges } from './mediumAi'

const DECK_COMPOSITION: Record<CardType, number> = {
  diamond: 6, gold: 6, silver: 6, cloth: 8, spice: 8, leather: 10, camel: 11,
}

const ALL_TYPES: CardType[] = ['diamond', 'gold', 'silver', 'cloth', 'spice', 'leather', 'camel']
const ALL_GOODS: Good[] = ['diamond', 'gold', 'silver', 'cloth', 'spice', 'leather']

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

export function combinations(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  if (k === 0 || k === n) return 1
  let result = 1
  for (let i = 0; i < k; i++) {
    result = result * (n - i) / (i + 1)
  }
  return result
}

export function hypergeoProbAtLeast(available: number, total: number, draws: number, needed: number): number {
  if (needed <= 0) return 1
  if (available < needed || draws < needed) return 0
  let pFewer = 0
  for (let k = 0; k < needed; k++) {
    pFewer += combinations(available, k) * combinations(total - available, draws - k) / combinations(total, draws)
  }
  return 1 - pFewer
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

function evalPosition(state: GameState, myIndex: 0 | 1, tracker: OpponentTracker): number {
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
  for (const card of state.market) {
    if (card.type === 'camel') continue
    const good = card.type as Good
    const topValue = state.tokens[good][0] ?? 0
    if (!PRECIOUS.has(good) || topValue === 0) continue
    const myCount = goodCount(me.hand, good)
    score += myCount >= 1 ? topValue * 1.8 : topValue * 0.8
  }

  // 5. Nonlinear camel value with oppMaxCamels
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
  for (const card of state.market) {
    if (card.type === 'camel') continue
    const good = card.type as Good
    const topValue = state.tokens[good][0] ?? 0
    if (topValue === 0) continue
    const myCount = goodCount(me.hand, good)
    if (myCount === MIN_SELL[good] - 1) {
      score += topValue * (PRECIOUS.has(good) ? 2.2 : 1.2)
    }
    const oppEff = tracker.opponentEffective(good, unaccounted)
    if (oppEff >= MIN_SELL[good] - 1 && oppEff < MIN_SELL[good]) {
      score -= topValue * (PRECIOUS.has(good) ? 1.4 : 0.6)
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

// ---------------------------------------------------------------------------
// Fair state-construction helpers (no deck access)
// ---------------------------------------------------------------------------

let _nextFakeId = 9000

function resetFakeIdCounter(): void {
  _nextFakeId = 9000
}

function nextFakeId(): number {
  return _nextFakeId++
}

/**
 * Apply TAKE_SINGLE without touching the deck.
 * Removes the card from market, adds to active player's hand, switches turn.
 * Returns a state with only 4 market cards (empty slot not filled yet).
 */
function applyTakeSingleFair(state: GameState, marketIndex: number): GameState | null {
  const card = state.market[marketIndex]
  if (!card || card.type === 'camel') return null

  const player = state.players[state.activePlayer]
  if (player.hand.length + 1 > 7) return null

  const newMarket = state.market.filter((_, i) => i !== marketIndex)
  const newPlayer = { ...player, hand: sortHand([...player.hand, card]) }

  const newRevealed = [...state.revealedHands] as [number[], number[]]
  newRevealed[state.activePlayer] = [...newRevealed[state.activePlayer], card.id]

  const newPlayers: [typeof state.players[0], typeof state.players[1]] =
    state.activePlayer === 0
      ? [newPlayer, state.players[1]]
      : [state.players[0], newPlayer]

  const nextActive: 0 | 1 = state.activePlayer === 0 ? 1 : 0

  return {
    ...state,
    market: newMarket,
    players: newPlayers,
    revealedHands: newRevealed,
    activePlayer: nextActive,
  }
}

/**
 * Apply TAKE_CAMELS without touching the deck.
 * Removes all camels from market, adds count to active player's herd, switches turn.
 * Returns a state with fewer than 5 market cards (empty slots not filled yet).
 */
function applyTakeCamelsFair(state: GameState): GameState | null {
  const camelsInMarket = state.market.filter(c => c.type === 'camel')
  if (camelsInMarket.length === 0) return null

  const camelCount = camelsInMarket.length
  const nonCamels = state.market.filter(c => c.type !== 'camel')
  const player = state.players[state.activePlayer]
  const newPlayer = { ...player, herd: player.herd + camelCount }

  const newPlayers: [typeof state.players[0], typeof state.players[1]] =
    state.activePlayer === 0
      ? [newPlayer, state.players[1]]
      : [state.players[0], newPlayer]

  const nextActive: 0 | 1 = state.activePlayer === 0 ? 1 : 0

  return {
    ...state,
    market: nonCamels,
    players: newPlayers,
    activePlayer: nextActive,
  }
}

/**
 * Check round end conditions for fair states (where market may be < 5 with no deck info).
 * Round ends if:
 *   - 3+ token piles are depleted
 *   - market < 5 and totalInDeck === 0 (no more cards to draw)
 */
function checkRoundEndFair(state: GameState, totalInDeck: number): GameState {
  if (state.market.length < 5 && totalInDeck === 0) {
    return { ...state, phase: 'round-end' as const }
  }
  const depleted = (Object.values(state.tokens) as number[][]).filter(p => p.length === 0).length
  if (depleted >= 3) {
    return { ...state, phase: 'round-end' as const }
  }
  return state
}

/**
 * Compute a probability distribution over card types remaining in the deck.
 * Uses unaccounted cards minus known opponent hand, minus a proportional estimate
 * of opponent's unknown hand composition.
 *
 * Returns { typeCounts: Record<CardType, number>, total: number }
 */
function computeDeckComposition(
  state: GameState,
  myIndex: 0 | 1,
  tracker: OpponentTracker,
): { typeCounts: Record<CardType, number>; total: number } {
  const me = state.players[myIndex]
  const opp = state.players[myIndex === 0 ? 1 : 0]

  const unaccounted = tracker.computeUnaccounted(
    me.hand, me.herd, state.market, state.discard, opp.herd,
  )

  // Subtract known opponent hand from unaccounted to get "in deck + unknown opponent hand"
  // knownInHand is already subtracted by computeUnaccounted.
  // unaccounted = deck cards + opponent's unknown hand cards.
  // We need to estimate what fraction of each type is in the deck vs opponent's unknown hand.
  // For camels: they're always in the deck (never in hands), so deckCamels = unaccounted.camel.

  const typeCounts: Record<CardType, number> = { ...unaccounted }
  const totalUnaccounted = Object.values(unaccounted).reduce((s, n) => s + n, 0)

  if (tracker.unknownInHand > 0 && totalUnaccounted > 0) {
    // Proportionally reduce each type for estimated opponent unknown holdings.
    // Camels can't be in hands, so only reduce goods.
    const goodsUnaccounted = totalUnaccounted - unaccounted.camel
    if (goodsUnaccounted > 0) {
      const unknownHand = Math.min(tracker.unknownInHand, goodsUnaccounted)
      for (const good of ALL_GOODS) {
        const fraction = unaccounted[good] / goodsUnaccounted
        typeCounts[good] = Math.max(0, unaccounted[good] - fraction * unknownHand)
      }
    }
  }

  const total = Object.values(typeCounts).reduce((s, n) => s + n, 0)
  return { typeCounts, total }
}

// ---------------------------------------------------------------------------
// Opponent action generation
// ---------------------------------------------------------------------------

interface WeightedAction {
  action: Action
  weight: number
}

function generateOpponentActions(
  state: GameState,
  myIndex: 0 | 1,
  tracker: OpponentTracker,
): WeightedAction[] {
  const oppIndex: 0 | 1 = myIndex === 0 ? 1 : 0
  if (state.activePlayer !== oppIndex) return []

  const opp = state.players[oppIndex]
  const result: WeightedAction[] = []

  // Takes from market: always concrete
  if (opp.hand.length < 7) {
    for (let i = 0; i < state.market.length; i++) {
      const card = state.market[i]
      if (card.type !== 'camel') {
        result.push({ action: { type: 'TAKE_SINGLE', marketIndex: i }, weight: 1 })
      }
    }
  }

  // Take camels: always concrete if camels in market
  if (state.market.some(c => c.type === 'camel')) {
    result.push({ action: { type: 'TAKE_CAMELS' }, weight: 1 })
  }

  // Sells: combine known cards with probabilistic unknown cards
  const me = state.players[myIndex]
  const unaccounted = tracker.computeUnaccounted(
    me.hand, me.herd, state.market, state.discard, opp.herd,
  )
  const totalUnaccounted = Object.values(unaccounted).reduce((s, n) => s + n, 0)

  for (const good of ALL_GOODS) {
    const pile = state.tokens[good]
    if (pile.length === 0) continue

    const knownCount = tracker.knownInHand.filter(c => c.type === good).length
    const minSell = MIN_SELL[good]
    const maxPossible = knownCount + tracker.unknownInHand

    for (let qty = minSell; qty <= maxPossible; qty++) {
      if (qty > opp.hand.length) break
      if (qty > pile.length + knownCount) break // rough bound

      const needed = qty - knownCount
      if (needed <= 0) {
        // Entirely from known cards — concrete action
        result.push({ action: { type: 'SELL', good, quantity: qty }, weight: 1 })
      } else {
        // Need some from unknown portion
        const available = unaccounted[good] // available of this type in unaccounted pool
        const prob = hypergeoProbAtLeast(available, totalUnaccounted, tracker.unknownInHand, needed)
        if (prob > 0.1) {
          result.push({ action: { type: 'SELL', good, quantity: qty }, weight: prob })
        }
      }
    }
  }

  // Exchanges: only if opponent hand is fully known
  if (tracker.unknownInHand === 0) {
    const exchanges = getProfitableExchanges(state)
    for (const ex of exchanges) {
      result.push({ action: ex, weight: 1 })
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Expectimax search
// ---------------------------------------------------------------------------

interface SearchContext {
  myIndex: 0 | 1
  tracker: OpponentTracker
  deadline: number
  maxChanceNodes: number
  depthCap: number
}

/**
 * Fill empty market slots by branching on possible card types (chance node).
 * Each branch is weighted by the probability of drawing that card type.
 */
function fillMarketChanceNode(
  state: GameState,
  ctx: SearchContext,
  depth: number,
  chanceNodesUsed: number,
  deckComp: { typeCounts: Record<CardType, number>; total: number },
): number {
  const slotsToFill = 5 - state.market.length

  if (slotsToFill <= 0 || deckComp.total <= 0) {
    // No more slots or no more cards — check round end and evaluate
    const checked = checkRoundEndFair(state, deckComp.total)
    if (checked.phase !== 'playing' || depth <= 0 || chanceNodesUsed >= ctx.maxChanceNodes) {
      return evalPosition(checked, ctx.myIndex, ctx.tracker)
    }
    return expectimax(checked, ctx, depth, chanceNodesUsed)
  }

  if (chanceNodesUsed >= ctx.maxChanceNodes) {
    // Budget exhausted — evaluate immediately
    const checked = checkRoundEndFair(state, deckComp.total)
    return evalPosition(checked, ctx.myIndex, ctx.tracker)
  }

  let expectedScore = 0

  for (const type of ALL_TYPES) {
    const count = deckComp.typeCounts[type]
    if (count <= 0) continue

    const prob = count / deckComp.total
    const fakeCard: Card = { id: nextFakeId(), type }
    const newMarket = [...state.market, fakeCard]
    const newState = { ...state, market: newMarket }

    // Update deck composition for remaining slots
    const newTypeCounts = { ...deckComp.typeCounts }
    newTypeCounts[type] = Math.max(0, newTypeCounts[type] - 1)
    const newTotal = deckComp.total - 1
    const newDeckComp = { typeCounts: newTypeCounts, total: newTotal }

    let branchScore: number
    if (newMarket.length < 5 && newTotal > 0) {
      // Still need to fill more slots — recurse chance node
      branchScore = fillMarketChanceNode(newState, ctx, depth, chanceNodesUsed + 1, newDeckComp)
    } else {
      // Market is full or no more cards
      const checked = checkRoundEndFair(newState, newTotal)
      if (checked.phase !== 'playing' || depth <= 0 || chanceNodesUsed + 1 >= ctx.maxChanceNodes) {
        branchScore = evalPosition(checked, ctx.myIndex, ctx.tracker)
      } else {
        branchScore = expectimax(checked, ctx, depth, chanceNodesUsed + 1)
      }
    }

    expectedScore += prob * branchScore
  }

  return expectedScore
}

/**
 * Evaluate a single action and return its score.
 * Dispatches based on action type — some use applyAction (safe), others use fair constructors.
 */
function evalAction(
  state: GameState,
  action: Action,
  ctx: SearchContext,
  depth: number,
  chanceNodesUsed: number,
): number {
  if (action.type === 'SELL' || action.type === 'TAKE_EXCHANGE') {
    // Safe to use applyAction — no deck draws
    const result = applyAction(state, action)
    if (!result.ok) return -Infinity
    const next = result.value
    if (next.phase !== 'playing' || depth <= 1) {
      return evalPosition(next, ctx.myIndex, ctx.tracker)
    }
    return expectimax(next, ctx, depth - 1, chanceNodesUsed)
  }

  if (action.type === 'TAKE_SINGLE') {
    const next = applyTakeSingleFair(state, action.marketIndex)
    if (!next) return -Infinity

    // Market has 4 cards — need to fill one slot via chance node
    const deckComp = computeDeckComposition(next, ctx.myIndex, ctx.tracker)
    if (next.market.length < 5 && deckComp.total > 0) {
      return fillMarketChanceNode(next, ctx, depth - 1, chanceNodesUsed, deckComp)
    }
    // No cards to draw — check round end
    const checked = checkRoundEndFair(next, deckComp.total)
    if (checked.phase !== 'playing' || depth <= 1) {
      return evalPosition(checked, ctx.myIndex, ctx.tracker)
    }
    return expectimax(checked, ctx, depth - 1, chanceNodesUsed)
  }

  if (action.type === 'TAKE_CAMELS') {
    const next = applyTakeCamelsFair(state)
    if (!next) return -Infinity

    // Market may have fewer than 5 cards — fill via chance node
    const deckComp = computeDeckComposition(next, ctx.myIndex, ctx.tracker)
    if (next.market.length < 5 && deckComp.total > 0) {
      return fillMarketChanceNode(next, ctx, depth - 1, chanceNodesUsed, deckComp)
    }
    const checked = checkRoundEndFair(next, deckComp.total)
    if (checked.phase !== 'playing' || depth <= 1) {
      return evalPosition(checked, ctx.myIndex, ctx.tracker)
    }
    return expectimax(checked, ctx, depth - 1, chanceNodesUsed)
  }

  return -Infinity
}

/**
 * Expectimax search. Three node types:
 * - Max node (bot's turn): pick highest-scoring action
 * - Min node (opponent's turn): opponent picks worst for us among concrete actions;
 *   probabilistic actions contribute weighted scores
 * - Chance nodes are handled inline via fillMarketChanceNode
 */
function expectimax(
  state: GameState,
  ctx: SearchContext,
  depth: number,
  chanceNodesUsed: number,
): number {
  if (state.phase !== 'playing' || depth <= 0 || Date.now() >= ctx.deadline) {
    return evalPosition(state, ctx.myIndex, ctx.tracker)
  }

  const isMaxNode = state.activePlayer === ctx.myIndex

  if (isMaxNode) {
    // Bot's turn — generate all legal actions
    const rawActions = [...getLegalActions(state), ...getProfitableExchanges(state)]
    if (rawActions.length === 0) return evalPosition(state, ctx.myIndex, ctx.tracker)
    const actions = orderActions(rawActions, state, ctx.myIndex)

    let best = -Infinity
    for (const action of actions) {
      if (Date.now() >= ctx.deadline) break
      const s = evalAction(state, action, ctx, depth, chanceNodesUsed)
      if (s > best) best = s
    }
    return best === -Infinity ? evalPosition(state, ctx.myIndex, ctx.tracker) : best
  } else {
    // Opponent's turn — use generateOpponentActions
    const weightedActions = generateOpponentActions(state, ctx.myIndex, ctx.tracker)
    if (weightedActions.length === 0) return evalPosition(state, ctx.myIndex, ctx.tracker)

    // Separate concrete (weight === 1) and probabilistic (weight < 1) actions
    const concrete: WeightedAction[] = []
    const probabilistic: WeightedAction[] = []
    for (const wa of weightedActions) {
      if (wa.weight >= 1) {
        concrete.push(wa)
      } else {
        probabilistic.push(wa)
      }
    }

    // Evaluate concrete actions — opponent picks the one worst for us (minimizer)
    let minConcrete = Infinity
    for (const wa of concrete) {
      if (Date.now() >= ctx.deadline) break
      const s = evalAction(state, wa.action, ctx, depth, chanceNodesUsed)
      if (s < minConcrete) minConcrete = s
    }

    // Evaluate probabilistic actions — weighted contribution
    let probSum = 0
    let probWeightSum = 0
    for (const wa of probabilistic) {
      if (Date.now() >= ctx.deadline) break
      const s = evalAction(state, wa.action, ctx, depth, chanceNodesUsed)
      probSum += wa.weight * s
      probWeightSum += wa.weight
    }

    // Combine: opponent picks the minimum across both
    // The probabilistic weighted average represents the expected score from those uncertain actions
    if (concrete.length === 0 && probabilistic.length === 0) {
      return evalPosition(state, ctx.myIndex, ctx.tracker)
    }

    if (concrete.length === 0) {
      // Only probabilistic — return weighted average
      return probWeightSum > 0 ? probSum / probWeightSum : evalPosition(state, ctx.myIndex, ctx.tracker)
    }

    if (probabilistic.length === 0) {
      // Only concrete
      return minConcrete
    }

    // Both: opponent picks min of concrete minimum vs probabilistic weighted average
    const probAvg = probWeightSum > 0 ? probSum / probWeightSum : Infinity
    return Math.min(minConcrete, probAvg)
  }
}

// ---------------------------------------------------------------------------
// Top-level entry point
// ---------------------------------------------------------------------------

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

  const endgame = isEndgame(state)
  const normalDeadline = Date.now() + 7000
  const endgameDeadline = Date.now() + 12000
  const deadline = endgame ? endgameDeadline : normalDeadline
  const depthCap = endgame ? 20 : 8
  const maxChanceNodes = 3

  const ctx: SearchContext = {
    myIndex,
    tracker,
    deadline,
    maxChanceNodes,
    depthCap,
  }

  let bestAction = rootActions[0]

  // Iterative deepening
  for (let depth = 2; depth <= depthCap; depth++) {
    if (Date.now() >= deadline) break

    // Reset fake ID counter at start of each depth iteration
    resetFakeIdCounter()

    let depthBest = rootActions[0]
    let depthBestScore = -Infinity
    let completedDepth = true

    for (const action of rootActions) {
      if (Date.now() >= deadline) { completedDepth = false; break }
      resetFakeIdCounter()
      const s = evalAction(state, action, ctx, depth, 0)
      if (s > depthBestScore) {
        depthBestScore = s
        depthBest = action
      }
    }

    if (completedDepth) bestAction = depthBest
  }

  return bestAction
}

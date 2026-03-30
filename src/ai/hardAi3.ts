import type { GameState, Action, Good, Card } from '../engine'
import { getLegalActions, applyAction, scoreRound } from '../engine'
import { getProfitableExchanges, getAllProfitableExchanges } from './mediumAi'

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

function evalPosition(state: GameState, myIndex: 0 | 1): number {
  if (state.phase === 'round-end') {
    const result = scoreRound(state)
    if (result.sealAwardedTo === myIndex) return 10_000
    if (result.sealAwardedTo === null) return 0
    return -10_000
  }

  const me = state.players[myIndex]
  const opp = state.players[myIndex === 0 ? 1 : 0]
  let score = 0

  // 1. Realized rupee differential — guaranteed income, high weight
  const myPts = me.tokens.reduce((s, t) => s + t.value, 0)
  const oppPts = opp.tokens.reduce((s, t) => s + t.value, 0)
  score += (myPts - oppPts) * 2.0

  // 2. Bonus token differential — use actual values since engine tracks them
  const myBonus = me.bonusTokens.reduce((s, t) => s + t.value, 0)
  const oppBonus = opp.bonusTokens.reduce((s, t) => s + t.value, 0)
  score += (myBonus - oppBonus) * 1.5

  // 3. Sellable goods — urgency × precious premium
  for (const good of GOOD_ORDER) {
    const pile = state.tokens[good] as readonly number[]
    const topValue = pile[0] ?? 0
    if (topValue === 0) continue

    // Urgency: fewer remaining tokens = opponent is also racing for them
    const urgency = pile.length <= 2 ? 2.5 : pile.length <= 4 ? 1.7 : 1.0
    const precious = PRECIOUS.has(good)
    const minSell = MIN_SELL[good]

    const myCount = goodCount(me.hand, good)
    const oppCount = goodCount(opp.hand, good)

    if (myCount >= minSell) {
      // Can sell right now — credit the actual tokens we'd collect
      score += sumTopN(pile, myCount) * urgency * (precious ? 1.6 : 1.1)
    } else if (myCount > 0) {
      // Have some but can't sell yet
      score += topValue * myCount * (precious ? 0.9 : 0.4)
    }

    if (oppCount >= minSell) {
      score -= sumTopN(pile, oppCount) * urgency * 0.9
    } else if (oppCount > 0) {
      score -= topValue * oppCount * (precious ? 0.6 : 0.2)
    }
  }

  // 4. Market tempo — precious goods available to take RIGHT NOW
  // Key insight: if I already have 1 diamond and there's one in the market,
  // taking it makes me immediately sellable for top-tier tokens.
  for (const card of state.market) {
    if (card.type === 'camel') continue
    const good = card.type as Good
    const topValue = state.tokens[good][0] ?? 0
    if (!PRECIOUS.has(good) || topValue === 0) continue
    const myCount = goodCount(me.hand, good)
    // "One more makes me sellable" is a very strong pull
    score += myCount >= 1 ? topValue * 1.8 : topValue * 0.8
  }

  // 5. Camel herd advantage
  score += (me.herd - opp.herd) * 0.6

  // 6. Hand pressure (approaching 7-card limit)
  if (me.hand.length >= 6) score -= 4
  if (opp.hand.length >= 6) score += 3

  return score
}

// Move ordering: higher priority = explored first = better alpha-beta pruning.
// Sells (precious first) > precious takes that complete a pair > other takes > exchanges > camels
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
        // Completing a pair is the highest-priority take
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

function alphabeta(
  state: GameState,
  depth: number,
  alpha: number,
  beta: number,
  myIndex: 0 | 1,
): number {
  if (state.phase !== 'playing' || depth === 0) {
    return evalPosition(state, myIndex)
  }

  const rawActions = [...getLegalActions(state), ...getProfitableExchanges(state)]
  if (rawActions.length === 0) return evalPosition(state, myIndex)
  const actions = orderActions(rawActions, state, myIndex)

  if (state.activePlayer === myIndex) {
    let best = -Infinity
    for (const action of actions) {
      const result = applyAction(state, action)
      if (!result.ok) continue
      const score = alphabeta(result.value, depth - 1, alpha, beta, myIndex)
      if (score > best) best = score
      if (best > alpha) alpha = best
      if (alpha >= beta) break
    }
    return best === -Infinity ? evalPosition(state, myIndex) : best
  } else {
    let best = Infinity
    for (const action of actions) {
      const result = applyAction(state, action)
      if (!result.ok) continue
      const score = alphabeta(result.value, depth - 1, alpha, beta, myIndex)
      if (score < best) best = score
      if (best < beta) beta = best
      if (alpha >= beta) break
    }
    return best === Infinity ? evalPosition(state, myIndex) : best
  }
}

export function pickHard3Action(state: GameState): Action | null {
  if (state.phase !== 'playing') return null
  const myIndex = state.activePlayer

  // Root uses full action space (all profitable exchange sizes)
  const rootActions = orderActions(
    [...getLegalActions(state), ...getAllProfitableExchanges(state)],
    state,
    myIndex,
  )
  if (rootActions.length === 0) return null
  if (rootActions.length === 1) return rootActions[0]

  // Iterative deepening: always have a valid answer, use full time budget
  const deadline = Date.now() + 7000
  let bestAction = rootActions[0]

  for (let depth = 2; depth <= 6; depth++) {
    if (Date.now() >= deadline) break

    let depthBest = rootActions[0]
    let depthBestScore = -Infinity
    let completedDepth = true

    for (const action of rootActions) {
      if (Date.now() >= deadline) { completedDepth = false; break }
      const result = applyAction(state, action)
      if (!result.ok) continue
      const score = alphabeta(result.value, depth - 1, -Infinity, Infinity, myIndex)
      if (score > depthBestScore) {
        depthBestScore = score
        depthBest = action
      }
    }

    // Only commit if we finished the full depth
    if (completedDepth) bestAction = depthBest
  }

  return bestAction
}

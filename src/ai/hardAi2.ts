import type { GameState, Action, Good, Card, PlayerState } from '../engine'
import { getLegalActions, applyAction, scoreRound, sortHand } from '../engine'
import { getProfitableExchanges, getAllProfitableExchanges } from './mediumAi'
import { shuffle, createDeck } from '../engine/setup'

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

/**
 * FAIR evaluation function. 
 * Does NOT look at opponent's hand contents.
 * Only knows hand sizes and public state.
 */
function evalPositionFair(state: GameState, myIndex: 0 | 1): number {
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

  // 2. Bonus tokens — use average values since actuals are hidden
  const bonusVal = (t: { tier: number }) => t.tier === 3 ? 2 : t.tier === 4 ? 5 : 9
  const myBonus = me.bonusTokens.reduce((s, t) => s + bonusVal(t), 0)
  const oppBonus = opp.bonusTokens.reduce((s, t) => s + bonusVal(t), 0)
  score += (myBonus - oppBonus) * 1.5

  // 3. AI's sellable goods
  for (const good of GOOD_ORDER) {
    const pile = state.tokens[good] as readonly number[]
    const topValue = pile[0] ?? 0
    if (topValue === 0) continue

    const urgency = pile.length <= 2 ? 2.5 : pile.length <= 4 ? 1.7 : 1.0
    const precious = PRECIOUS.has(good)
    const minSell = MIN_SELL[good]

    const myCount = goodCount(me.hand, good)

    if (myCount >= minSell) {
      score += sumTopN(pile, myCount) * urgency * (precious ? 1.6 : 1.1)
    } else if (myCount > 0) {
      score += topValue * myCount * (precious ? 0.9 : 0.4)
    }
  }

  // 4. Market tempo
  for (const card of state.market) {
    if (card.type === 'camel') continue
    const good = card.type as Good
    const topValue = state.tokens[good][0] ?? 0
    if (!PRECIOUS.has(good) || topValue === 0) continue
    const myCount = goodCount(me.hand, good)
    score += myCount >= 1 ? topValue * 1.8 : topValue * 0.8
  }

  // 5. Camel herd advantage
  score += (me.herd - opp.herd) * 0.6

  // 6. Hand pressure (approaching 7-card limit)
  if (me.hand.length >= 6) score -= 4
  if (opp.hand.length >= 6) score += 3

  return score
}

function alphabeta(
  state: GameState,
  depth: number,
  alpha: number,
  beta: number,
  myIndex: 0 | 1,
): number {
  if (state.phase !== 'playing' || depth === 0) {
    return evalPositionFair(state, myIndex)
  }

  const rawActions = [...getLegalActions(state), ...getProfitableExchanges(state)]
  if (rawActions.length === 0) return evalPositionFair(state, myIndex)
  
  const actions = rawActions

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
    return best === -Infinity ? evalPositionFair(state, myIndex) : best
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
    return best === Infinity ? evalPositionFair(state, myIndex) : best
  }
}

/**
 * Creates a "Fair" version of the state where hidden information is randomized.
 */
function fairifyState(state: GameState, myIndex: 0 | 1): GameState {
  const oppIndex = myIndex === 0 ? 1 : 0
  const me = state.players[myIndex]
  const opp = state.players[oppIndex]
  
  // 1. Identify all known cards
  const knownIds = new Set<number>()
  me.hand.forEach(c => knownIds.add(c.id))
  state.market.forEach(c => knownIds.add(c.id))
  state.discard.forEach(c => knownIds.add(c.id))
  
  const allCards = createDeck()
  const unknownCards = allCards.filter(c => !knownIds.has(c.id))
  
  const pool = shuffle(unknownCards)
  
  const oppHandSize = opp.hand.length
  const goodsPool = pool.filter(c => c.type !== 'camel')
  const fairOppHand = sortHand(goodsPool.slice(0, oppHandSize))
  const fairDeck = pool.filter(c => !fairOppHand.find(hc => hc.id === c.id))

  return {
    ...state,
    deck: fairDeck,
    players: state.players.map((p, i) => i === oppIndex ? { ...p, hand: fairOppHand } : p) as [PlayerState, PlayerState]
  }
}

export function pickHard2Action(state: GameState): Action | null {
  if (state.phase !== 'playing') return null
  const myIndex = state.activePlayer

  const numDeterminizations = 3
  const actionScores = new Map<string, number>()
  const actionMap = new Map<string, Action>()

  const rootActions = [...getLegalActions(state), ...getAllProfitableExchanges(state)]
  if (rootActions.length === 0) return null
  if (rootActions.length === 1) return rootActions[0]

  for (let i = 0; i < numDeterminizations; i++) {
    const fairState = fairifyState(state, myIndex)
    
    for (const action of rootActions) {
      const result = applyAction(fairState, action)
      if (!result.ok) continue
      
      const key = JSON.stringify(action)
      actionMap.set(key, action)
      
      const score = alphabeta(result.value, 3, -Infinity, Infinity, myIndex)
      actionScores.set(key, (actionScores.get(key) ?? 0) + score)
    }
  }

  let bestKey = ''
  let bestScore = -Infinity
  for (const [key, score] of actionScores.entries()) {
    if (score > bestScore) {
      bestScore = score
      bestKey = key
    }
  }

  return actionMap.get(bestKey) ?? rootActions[0]
}

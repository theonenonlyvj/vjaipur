import type { GameState, Action, Good } from '../engine'
import { getLegalActions, applyAction } from '../engine'

function topValue(state: GameState, good: Good): number {
  return state.tokens[good][0] ?? 0
}

const PRECIOUS_GOODS: ReadonlySet<Good> = new Set(['diamond', 'gold', 'silver'])
const MIN_SELL: Record<Good, number> = {
  diamond: 2, gold: 2, silver: 2, cloth: 1, spice: 1, leather: 1,
}

function evalState(state: GameState, playerIndex: 0 | 1): number {
  const player = state.players[playerIndex]
  const opponent = state.players[playerIndex === 0 ? 1 : 0]

  let score = 0

  // Realized tokens are guaranteed income — weight them higher than potential hand value
  for (const t of player.tokens) score += t.value * 1.5
  score += player.bonusTokens.length * 4

  // Hand goods: only credit precious goods when you have enough to sell (≥ 2)
  // Non-precious goods are always creditable (min sell qty = 1)
  const goodCounts = new Map<Good, number>()
  for (const card of player.hand) {
    if (card.type !== 'camel') {
      goodCounts.set(card.type as Good, (goodCounts.get(card.type as Good) ?? 0) + 1)
    }
  }
  for (const [good, count] of goodCounts) {
    const minSell = MIN_SELL[good]
    if (count >= minSell) {
      score += topValue(state, good) * count
    }
  }

  score += (player.herd - opponent.herd) * 0.3

  return score
}

export function getProfitableExchanges(state: GameState): Action[] {
  const player = state.players[state.activePlayer]

  // Intentionally limited to 2-for-2 exchanges to bound combinatorial cost.
  // Larger exchanges (3-for-3+) would increase branching significantly for marginal benefit.
  const mktGoods = state.market
    .map((c, i) => ({ good: c.type as Good, i }))
    .filter(x => (x.good as string) !== 'camel')

  if (mktGoods.length < 2) return []

  const handGoods = player.hand.map((c, i) => ({ good: c.type as Good, i }))
  const result: Action[] = []

  for (let a = 0; a < mktGoods.length; a++) {
    for (let b = a + 1; b < mktGoods.length; b++) {
      const takeTypes: Good[] = [mktGoods[a].good, mktGoods[b].good]
      const takeValue = takeTypes.reduce((s, g) => s + topValue(state, g), 0)
      const mktIdx = [mktGoods[a].i, mktGoods[b].i]

      // Option A: give 2 hand goods (different types from taken)
      const giveable = handGoods.filter(hg => !takeTypes.includes(hg.good))
      for (let c = 0; c < giveable.length; c++) {
        for (let d = c + 1; d < giveable.length; d++) {
          const giveValue = topValue(state, giveable[c].good) + topValue(state, giveable[d].good)
          if (takeValue > giveValue) {
            result.push({
              type: 'TAKE_EXCHANGE',
              marketIndices: mktIdx,
              handIndices: [giveable[c].i, giveable[d].i],
            })
          }
        }
      }

      // Option B: give 1 hand good + 1 camel (net +1 hand card; need hand ≤ 6 now)
      if (player.herd >= 1 && player.hand.length <= 6) {
        const giveableWithCamel = handGoods.filter(hg => !takeTypes.includes(hg.good))
        for (const hg of giveableWithCamel) {
          const giveValue = topValue(state, hg.good)
          if (takeValue > giveValue) {
            result.push({
              type: 'TAKE_EXCHANGE',
              marketIndices: mktIdx,
              handIndices: [hg.i, -1],
            })
          }
        }
      }

      // Option C: give 2 camels (net +2 hand cards; need hand ≤ 5 now)
      if (player.herd >= 2 && player.hand.length <= 5) {
        if (takeValue > 0) {
          result.push({
            type: 'TAKE_EXCHANGE',
            marketIndices: mktIdx,
            handIndices: [-1, -1],
          })
        }
      }
    }
  }

  return result
}

export function pickMediumAction(state: GameState): Action | null {
  if (state.phase !== 'playing') return null

  const candidates = [...getLegalActions(state), ...getProfitableExchanges(state)]
  if (candidates.length === 0) return null

  const myIndex = state.activePlayer
  let bestAction: Action = candidates[0]
  let bestScore = -Infinity

  for (const action of candidates) {
    const result = applyAction(state, action)
    if (!result.ok) continue
    const score = evalState(result.value, myIndex)
    if (score > bestScore) {
      bestScore = score
      bestAction = action
    }
  }

  if (bestScore === -Infinity) return null

  return bestAction
}

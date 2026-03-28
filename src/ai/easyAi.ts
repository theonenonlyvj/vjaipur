import type { GameState, Action, Good } from '../engine'
import { getLegalActions } from '../engine'

const VALUE_ORDER: Good[] = ['diamond', 'gold', 'silver', 'cloth', 'spice', 'leather']

export function pickEasyAction(state: GameState): Action | null {
  const actions = getLegalActions(state)
  if (actions.length === 0) return null

  // 1. Sell precious goods first (highest token value)
  for (const good of VALUE_ORDER.slice(0, 3)) {
    const sell = actions.find(a => a.type === 'SELL' && a.good === good)
    if (sell) return sell
  }

  // 2. Sell any goods (prefer higher quantity)
  const sells = actions.filter(a => a.type === 'SELL')
  if (sells.length > 0) {
    return sells.reduce((best, a) =>
      a.type === 'SELL' && best.type === 'SELL' && a.quantity >= best.quantity ? a : best
    )
  }

  // 3. Take single: prefer highest-value good in market
  const singles = actions.filter(a => a.type === 'TAKE_SINGLE')
  if (singles.length > 0) {
    return singles.reduce((best, a) => {
      if (a.type !== 'TAKE_SINGLE' || best.type !== 'TAKE_SINGLE') return best
      const aIdx = VALUE_ORDER.indexOf(state.market[a.marketIndex].type as Good)
      const bIdx = VALUE_ORDER.indexOf(state.market[best.marketIndex].type as Good)
      if (aIdx === -1) return best  // aType not in list (shouldn't happen for TAKE_SINGLE)
      if (bIdx === -1) return a
      return aIdx <= bIdx ? a : best
    })
  }

  // 4. Take camels
  const camels = actions.find(a => a.type === 'TAKE_CAMELS')
  if (camels) return camels

  return actions[0]
}

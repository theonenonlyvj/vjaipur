import { describe, it, expect } from 'vitest'
import { getLegalActions } from '../../src/engine/engine'
import { setupRound } from '../../src/engine/setup'
import type { GameState, Card } from '../../src/engine/types'

function makeState(market: Card[], hand: Card[], herd = 0): GameState {
  const base = setupRound([0, 0], undefined, () => 0)
  return {
    ...base,
    market,
    players: [{ ...base.players[0], hand, herd }, base.players[1]],
  }
}

const GOODS_MARKET: Card[] = [
  { id: 1, type: 'cloth' }, { id: 2, type: 'spice' },
  { id: 3, type: 'leather' }, { id: 4, type: 'gold' }, { id: 5, type: 'silver' },
]

describe('getLegalActions', () => {
  it('returns empty array when phase is not playing', () => {
    const state = { ...setupRound([0, 0], undefined, () => 0), phase: 'round-end' as const }
    expect(getLegalActions(state)).toEqual([])
  })

  it('includes TAKE_SINGLE for each non-camel market card when hand < 7', () => {
    const marketMixed: Card[] = [
      { id: 1, type: 'cloth' }, { id: 2, type: 'camel' },
      { id: 3, type: 'leather' }, { id: 4, type: 'gold' }, { id: 5, type: 'silver' },
    ]
    const state = makeState(marketMixed, [])
    const singles = getLegalActions(state).filter(a => a.type === 'TAKE_SINGLE')
    expect(singles).toHaveLength(4) // 4 non-camel cards
  })

  it('excludes all TAKE_SINGLE when hand already has 7 goods', () => {
    const fullHand: Card[] = [10,11,12,13,14,15,16].map(id => ({ id, type: 'cloth' as const }))
    const state = makeState(GOODS_MARKET, fullHand)
    expect(getLegalActions(state).filter(a => a.type === 'TAKE_SINGLE')).toHaveLength(0)
  })

  it('includes TAKE_CAMELS when any camels are in market', () => {
    const marketWithCamel: Card[] = [
      { id: 1, type: 'camel' }, { id: 2, type: 'cloth' },
      { id: 3, type: 'leather' }, { id: 4, type: 'gold' }, { id: 5, type: 'silver' },
    ]
    const state = makeState(marketWithCamel, [])
    expect(getLegalActions(state).some(a => a.type === 'TAKE_CAMELS')).toBe(true)
  })

  it('excludes TAKE_CAMELS when no camels in market', () => {
    const state = makeState(GOODS_MARKET, [])
    expect(getLegalActions(state).some(a => a.type === 'TAKE_CAMELS')).toBe(false)
  })

  it('includes SELL for each valid (good, quantity) combination', () => {
    const hand: Card[] = [
      { id: 1, type: 'cloth' }, { id: 2, type: 'cloth' }, { id: 3, type: 'cloth' },
    ]
    const actions = getLegalActions(makeState(GOODS_MARKET, hand))
    const sells = actions.filter(a => a.type === 'SELL' && a.good === 'cloth')
    // Can sell 1, 2, or 3 cloth → 3 actions
    expect(sells).toHaveLength(3)
  })

  it('does not include SELL diamond with quantity 1', () => {
    const hand: Card[] = [{ id: 1, type: 'diamond' }, { id: 2, type: 'diamond' }]
    const actions = getLegalActions(makeState(GOODS_MARKET, hand))
    const badSell = actions.find(a => a.type === 'SELL' && a.good === 'diamond' && a.quantity === 1)
    expect(badSell).toBeUndefined()
  })

  it('includes SELL diamond with quantity 2 when player has 2 diamonds', () => {
    const hand: Card[] = [{ id: 1, type: 'diamond' }, { id: 2, type: 'diamond' }]
    const actions = getLegalActions(makeState(GOODS_MARKET, hand))
    expect(actions.find(a => a.type === 'SELL' && a.good === 'diamond' && a.quantity === 2)).toBeDefined()
  })

  it('does not include SELL when hand has 0 of that good', () => {
    const hand: Card[] = [{ id: 1, type: 'cloth' }]
    const actions = getLegalActions(makeState(GOODS_MARKET, hand))
    expect(actions.some(a => a.type === 'SELL' && a.good === 'diamond')).toBe(false)
  })
})

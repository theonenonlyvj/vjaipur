import { describe, it, expect } from 'vitest'
import { applyAction } from '../../src/engine/engine'
import { setupRound } from '../../src/engine/setup'
import type { GameState, Card } from '../../src/engine/types'

function makeState(market: Card[], hand: Card[], herd = 0): GameState {
  const base = setupRound([0, 0], undefined, () => 0)
  return {
    ...base,
    market,
    deck: [],
    players: [{ ...base.players[0], hand, herd }, base.players[1]],
  }
}

// A clean 5-card all-goods market (no camels)
const MARKET: Card[] = [
  { id: 10, type: 'diamond' },
  { id: 11, type: 'gold' },
  { id: 12, type: 'cloth' },
  { id: 13, type: 'spice' },
  { id: 14, type: 'leather' },
]

describe('TAKE_EXCHANGE', () => {
  it('moves taken market cards to hand', () => {
    const hand: Card[] = [{ id: 20, type: 'cloth' }, { id: 21, type: 'spice' }]
    const state = makeState(MARKET, hand)
    // Take diamond(0)+gold(1), give cloth(0)+spice(1)
    const result = applyAction(state, { type: 'TAKE_EXCHANGE', marketIndices: [0, 1], handIndices: [0, 1] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.players[0].hand).toContainEqual({ id: 10, type: 'diamond' })
    expect(result.value.players[0].hand).toContainEqual({ id: 11, type: 'gold' })
  })

  it('moves returned hand cards to market', () => {
    const hand: Card[] = [{ id: 20, type: 'cloth' }, { id: 21, type: 'spice' }]
    const state = makeState(MARKET, hand)
    const result = applyAction(state, { type: 'TAKE_EXCHANGE', marketIndices: [0, 1], handIndices: [0, 1] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.market).toContainEqual({ id: 20, type: 'cloth' })
    expect(result.value.market).toContainEqual({ id: 21, type: 'spice' })
  })

  it('market stays 5 cards', () => {
    const hand: Card[] = [{ id: 20, type: 'cloth' }, { id: 21, type: 'spice' }]
    const state = makeState(MARKET, hand)
    const result = applyAction(state, { type: 'TAKE_EXCHANGE', marketIndices: [0, 1], handIndices: [0, 1] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.market).toHaveLength(5)
  })

  it('allows giving a camel from herd (handIndex -1)', () => {
    const hand: Card[] = [{ id: 20, type: 'cloth' }]
    const state = makeState(MARKET, hand, 3)
    // Take diamond+gold, give cloth + 1 camel
    const result = applyAction(state, { type: 'TAKE_EXCHANGE', marketIndices: [0, 1], handIndices: [0, -1] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.players[0].herd).toBe(2) // 3 - 1 camel given
    expect(result.value.market.some(c => c.type === 'camel')).toBe(true)
  })

  it('returned camel appears in market', () => {
    const hand: Card[] = [{ id: 20, type: 'cloth' }]
    const state = makeState(MARKET, hand, 3)
    const result = applyAction(state, { type: 'TAKE_EXCHANGE', marketIndices: [0, 1], handIndices: [0, -1] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // A camel card from the herd should appear in market
    expect(result.value.market.some(c => c.type === 'camel')).toBe(true)
  })

  it('advances turn after successful exchange', () => {
    const hand: Card[] = [{ id: 20, type: 'cloth' }, { id: 21, type: 'spice' }]
    const state = makeState(MARKET, hand)
    const result = applyAction(state, { type: 'TAKE_EXCHANGE', marketIndices: [0, 1], handIndices: [0, 1] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.activePlayer).toBe(1)
  })

  it('fails if fewer than 2 cards exchanged', () => {
    const hand: Card[] = [{ id: 20, type: 'cloth' }]
    const state = makeState(MARKET, hand)
    const result = applyAction(state, { type: 'TAKE_EXCHANGE', marketIndices: [0], handIndices: [0] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('EXCHANGE_TOO_FEW')
  })

  it('fails if take and give counts differ', () => {
    const hand: Card[] = [{ id: 20, type: 'cloth' }, { id: 21, type: 'spice' }]
    const state = makeState(MARKET, hand)
    const result = applyAction(state, { type: 'TAKE_EXCHANGE', marketIndices: [0, 1], handIndices: [0] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('EXCHANGE_COUNT_MISMATCH')
  })

  it('fails if same type is both taken and returned', () => {
    // MARKET[2] is cloth; HAND[0] is also cloth
    const hand: Card[] = [{ id: 20, type: 'cloth' }, { id: 21, type: 'spice' }]
    const state = makeState(MARKET, hand)
    // Take cloth(2)+gold(1), give cloth(0)+spice(1) — cloth is both taken and returned
    const result = applyAction(state, { type: 'TAKE_EXCHANGE', marketIndices: [2, 1], handIndices: [0, 1] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('EXCHANGE_SAME_TYPE')
  })

  it('fails if trying to take a camel from market via exchange', () => {
    const marketWithCamel: Card[] = [
      { id: 1, type: 'camel' }, { id: 11, type: 'gold' }, { id: 12, type: 'cloth' }, { id: 13, type: 'spice' }, { id: 14, type: 'leather' },
    ]
    const hand: Card[] = [{ id: 20, type: 'diamond' }, { id: 21, type: 'silver' }]
    const state = makeState(marketWithCamel, hand)
    const result = applyAction(state, { type: 'TAKE_EXCHANGE', marketIndices: [0, 1], handIndices: [0, 1] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('EXCHANGE_CANNOT_TAKE_CAMEL')
  })

  it('fails if not enough camels in herd to cover -1 indices', () => {
    const hand: Card[] = [{ id: 20, type: 'cloth' }]
    const state = makeState(MARKET, hand, 0) // herd = 0
    const result = applyAction(state, { type: 'TAKE_EXCHANGE', marketIndices: [0, 1], handIndices: [0, -1] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('NOT_ENOUGH_CAMELS')
  })

  it('fails if resulting hand exceeds 7 goods', () => {
    // Hand has 7 goods; taking 2 and giving 1 good + 1 camel = net +1 good = 8 goods → over limit
    const fullHand: Card[] = [20,21,22,23,24,25,26].map(id => ({ id, type: 'cloth' as const }))
    const state = makeState(MARKET, fullHand, 2)
    // Take 2 goods, give 1 good + 1 camel — net change: +1 good = 8 goods → over limit
    const result = applyAction(state, { type: 'TAKE_EXCHANGE', marketIndices: [0, 1], handIndices: [0, -1] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('HAND_LIMIT')
  })
})

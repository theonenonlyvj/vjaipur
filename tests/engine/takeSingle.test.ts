import { describe, it, expect } from 'vitest'
import { applyAction } from '../../src/engine/engine'
import { setupRound } from '../../src/engine/setup'
import type { GameState, Card } from '../../src/engine/types'

function makeState(market: Card[], hand: Card[] = [], deck: Card[] = []): GameState {
  const base = setupRound([0, 0], undefined, () => 0)
  return {
    ...base,
    market,
    deck,
    players: [{ ...base.players[0], hand }, base.players[1]],
  }
}

const FULL_MARKET: Card[] = [
  { id: 10, type: 'cloth' },
  { id: 11, type: 'spice' },
  { id: 12, type: 'leather' },
  { id: 13, type: 'gold' },
  { id: 14, type: 'silver' },
]

describe('TAKE_SINGLE', () => {
  it('moves the card from market to active player hand', () => {
    const refill: Card = { id: 99, type: 'diamond' }
    const state = makeState(FULL_MARKET, [], [refill])
    const result = applyAction(state, { type: 'TAKE_SINGLE', marketIndex: 0 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.players[0].hand).toContainEqual({ id: 10, type: 'cloth' })
    expect(result.value.market).not.toContainEqual({ id: 10, type: 'cloth' })
  })

  it('refills the taken slot from deck', () => {
    const refill: Card = { id: 99, type: 'diamond' }
    const state = makeState(FULL_MARKET, [], [refill])
    const result = applyAction(state, { type: 'TAKE_SINGLE', marketIndex: 0 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.market).toContainEqual(refill)
    expect(result.value.deck).not.toContainEqual(refill)
  })

  it('market stays 5 cards when deck has cards', () => {
    const state = makeState(FULL_MARKET, [], [{ id: 99, type: 'diamond' }])
    const result = applyAction(state, { type: 'TAKE_SINGLE', marketIndex: 0 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.market).toHaveLength(5)
  })

  it('market shrinks to 4 when deck is empty, triggering round-end', () => {
    const state = makeState(FULL_MARKET, [], [])
    const result = applyAction(state, { type: 'TAKE_SINGLE', marketIndex: 0 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.market).toHaveLength(4)
    expect(result.value.phase).toBe('round-end')
  })

  it('advances turn to other player', () => {
    const state = makeState(FULL_MARKET, [], [{ id: 99, type: 'diamond' }])
    const result = applyAction(state, { type: 'TAKE_SINGLE', marketIndex: 0 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.activePlayer).toBe(1)
  })

  it('fails if marketIndex is out of bounds', () => {
    const state = makeState(FULL_MARKET)
    const result = applyAction(state, { type: 'TAKE_SINGLE', marketIndex: 10 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('MARKET_INDEX_OOB')
  })

  it('fails if the card at marketIndex is a camel', () => {
    const marketWithCamel: Card[] = [
      { id: 1, type: 'camel' }, ...FULL_MARKET.slice(1),
    ]
    const state = makeState(marketWithCamel)
    const result = applyAction(state, { type: 'TAKE_SINGLE', marketIndex: 0 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('CANNOT_TAKE_CAMEL')
  })

  it('fails if hand would exceed 7 goods after take', () => {
    const fullHand: Card[] = [1,2,3,4,5,6,7].map(id => ({ id, type: 'cloth' as const }))
    const state = makeState(FULL_MARKET, fullHand, [{ id: 99, type: 'diamond' }])
    const result = applyAction(state, { type: 'TAKE_SINGLE', marketIndex: 0 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('HAND_LIMIT')
  })

  it('fails when phase is not playing', () => {
    const state = { ...makeState(FULL_MARKET), phase: 'round-end' as const }
    const result = applyAction(state, { type: 'TAKE_SINGLE', marketIndex: 0 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('WRONG_PHASE')
  })
})

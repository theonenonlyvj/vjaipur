import { describe, it, expect } from 'vitest'
import { applyAction } from '../../src/engine/engine'
import { setupRound } from '../../src/engine/setup'
import type { GameState, Card } from '../../src/engine/types'

function makeState(market: Card[], deck: Card[] = [], herd = 0): GameState {
  const base = setupRound([0, 0], undefined, () => 0)
  return {
    ...base,
    market,
    deck,
    players: [{ ...base.players[0], hand: [], herd }, base.players[1]],
  }
}

describe('TAKE_CAMELS', () => {
  it('adds all market camels to active player herd', () => {
    const state = makeState(
      [{ id: 1, type: 'camel' }, { id: 2, type: 'camel' }, { id: 3, type: 'cloth' }, { id: 4, type: 'spice' }, { id: 5, type: 'leather' }],
      [{ id: 10, type: 'gold' }, { id: 11, type: 'silver' }],
      3,
    )
    const result = applyAction(state, { type: 'TAKE_CAMELS' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.players[0].herd).toBe(5) // 3 existing + 2 taken
  })

  it('does not add camels to hand', () => {
    const state = makeState(
      [{ id: 1, type: 'camel' }, { id: 2, type: 'cloth' }, { id: 3, type: 'spice' }, { id: 4, type: 'leather' }, { id: 5, type: 'gold' }],
      [{ id: 10, type: 'silver' }],
    )
    const result = applyAction(state, { type: 'TAKE_CAMELS' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.players[0].hand.filter(c => c.type === 'camel')).toHaveLength(0)
  })

  it('refills all taken camel slots from deck', () => {
    const state = makeState(
      [{ id: 1, type: 'camel' }, { id: 2, type: 'camel' }, { id: 3, type: 'cloth' }, { id: 4, type: 'spice' }, { id: 5, type: 'leather' }],
      [{ id: 10, type: 'gold' }, { id: 11, type: 'silver' }],
    )
    const result = applyAction(state, { type: 'TAKE_CAMELS' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.market).toHaveLength(5)
    expect(result.value.market.filter(c => c.type === 'camel')).toHaveLength(0)
  })

  it('market is smaller than 5 when deck cannot fully refill', () => {
    const state = makeState(
      [{ id: 1, type: 'camel' }, { id: 2, type: 'camel' }, { id: 3, type: 'cloth' }, { id: 4, type: 'spice' }, { id: 5, type: 'leather' }],
      [{ id: 10, type: 'gold' }], // only 1 refill for 2 camel slots
    )
    const result = applyAction(state, { type: 'TAKE_CAMELS' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.market).toHaveLength(4)
    expect(result.value.phase).toBe('round-end')
  })

  it('advances turn to other player', () => {
    const state = makeState(
      [{ id: 1, type: 'camel' }, { id: 2, type: 'cloth' }, { id: 3, type: 'spice' }, { id: 4, type: 'leather' }, { id: 5, type: 'gold' }],
      [{ id: 10, type: 'silver' }],
    )
    const result = applyAction(state, { type: 'TAKE_CAMELS' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.activePlayer).toBe(1)
  })

  it('fails if no camels in market', () => {
    const state = makeState([
      { id: 1, type: 'cloth' }, { id: 2, type: 'spice' },
      { id: 3, type: 'leather' }, { id: 4, type: 'gold' }, { id: 5, type: 'silver' },
    ])
    const result = applyAction(state, { type: 'TAKE_CAMELS' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('NO_CAMELS_IN_MARKET')
  })
})

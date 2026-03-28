import { describe, it, expect } from 'vitest'
import { applyAction } from '../../src/engine/engine'
import { setupRound, initialTokenPiles } from '../../src/engine/setup'
import type { GameState, Card } from '../../src/engine/types'

function makeState(hand: Card[], tokenOverrides: Partial<ReturnType<typeof initialTokenPiles>> = {}): GameState {
  const base = setupRound([0, 0], undefined, () => 0)
  return {
    ...base,
    players: [{ ...base.players[0], hand }, base.players[1]],
    tokens: { ...initialTokenPiles(), ...tokenOverrides },
  }
}

describe('SELL', () => {
  it('removes sold cards from hand', () => {
    const hand: Card[] = [
      { id: 1, type: 'cloth' }, { id: 2, type: 'cloth' }, { id: 3, type: 'cloth' },
      { id: 4, type: 'spice' },
    ]
    const result = applyAction(makeState(hand), { type: 'SELL', good: 'cloth', quantity: 3 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.players[0].hand.filter(c => c.type === 'cloth')).toHaveLength(0)
    expect(result.value.players[0].hand.filter(c => c.type === 'spice')).toHaveLength(1)
  })

  it('adds sold cards to discard pile', () => {
    const hand: Card[] = [{ id: 1, type: 'cloth' }, { id: 2, type: 'cloth' }]
    const result = applyAction(makeState(hand), { type: 'SELL', good: 'cloth', quantity: 2 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.discard).toHaveLength(2)
  })

  it('awards tokens in descending value order (cloth: 5 then 3)', () => {
    const hand: Card[] = [{ id: 1, type: 'cloth' }, { id: 2, type: 'cloth' }]
    const result = applyAction(makeState(hand), { type: 'SELL', good: 'cloth', quantity: 2 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const values = result.value.players[0].tokens.map(t => t.value).sort((a, b) => b - a)
    expect(values).toEqual([5, 3])
  })

  it('removes awarded tokens from the board pile', () => {
    const hand: Card[] = [{ id: 1, type: 'diamond' }, { id: 2, type: 'diamond' }]
    const result = applyAction(makeState(hand), { type: 'SELL', good: 'diamond', quantity: 2 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // diamond started as [7,7,5,5,5] — took 2 → 3 remain
    expect(result.value.tokens.diamond).toHaveLength(3)
    expect(result.value.tokens.diamond).toEqual([5, 5, 5])
  })

  it('awards no goods tokens when pile is depleted but still completes sale', () => {
    const hand: Card[] = [{ id: 1, type: 'cloth' }, { id: 2, type: 'cloth' }]
    const result = applyAction(makeState(hand, { cloth: [] }), { type: 'SELL', good: 'cloth', quantity: 2 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.players[0].tokens.filter(t => t.good === 'cloth')).toHaveLength(0)
  })

  it('awards 3-tier bonus token for selling exactly 3 cards', () => {
    const hand: Card[] = [{ id: 1, type: 'cloth' }, { id: 2, type: 'cloth' }, { id: 3, type: 'cloth' }]
    const result = applyAction(makeState(hand), { type: 'SELL', good: 'cloth', quantity: 3 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.players[0].bonusTokens).toHaveLength(1)
    expect(result.value.players[0].bonusTokens[0].tier).toBe(3)
  })

  it('awards 4-tier bonus token for selling exactly 4 cards', () => {
    const hand: Card[] = [1,2,3,4].map(id => ({ id, type: 'cloth' as const }))
    const result = applyAction(makeState(hand), { type: 'SELL', good: 'cloth', quantity: 4 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.players[0].bonusTokens[0].tier).toBe(4)
  })

  it('awards 5-tier bonus token for selling 5 or more cards', () => {
    const hand: Card[] = [1,2,3,4,5].map(id => ({ id, type: 'cloth' as const }))
    const result = applyAction(makeState(hand), { type: 'SELL', good: 'cloth', quantity: 5 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.players[0].bonusTokens[0].tier).toBe(5)
  })

  it('still awards bonus token even when goods token pile is empty', () => {
    const hand: Card[] = [1,2,3].map(id => ({ id, type: 'cloth' as const }))
    const result = applyAction(makeState(hand, { cloth: [] }), { type: 'SELL', good: 'cloth', quantity: 3 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.players[0].bonusTokens).toHaveLength(1)
  })

  it('advances turn after sale', () => {
    const hand: Card[] = [{ id: 1, type: 'cloth' }, { id: 2, type: 'cloth' }]
    const result = applyAction(makeState(hand), { type: 'SELL', good: 'cloth', quantity: 2 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.activePlayer).toBe(1)
  })

  it('triggers round-end when 3 goods piles are depleted', () => {
    const hand: Card[] = [{ id: 1, type: 'leather' }]
    const result = applyAction(
      makeState(hand, { diamond: [], gold: [], leather: [4] }),
      { type: 'SELL', good: 'leather', quantity: 1 },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.phase).toBe('round-end')
  })

  it('fails if quantity is 0', () => {
    const result = applyAction(makeState([{ id: 1, type: 'cloth' }]), { type: 'SELL', good: 'cloth', quantity: 0 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('SELL_NONE')
  })

  it('fails if selling 1 diamond (precious minimum is 2)', () => {
    const hand: Card[] = [{ id: 1, type: 'diamond' }]
    const result = applyAction(makeState(hand), { type: 'SELL', good: 'diamond', quantity: 1 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('SELL_TOO_FEW')
  })

  it('fails if selling 1 gold', () => {
    const result = applyAction(makeState([{ id: 1, type: 'gold' }]), { type: 'SELL', good: 'gold', quantity: 1 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('SELL_TOO_FEW')
  })

  it('fails if selling 1 silver', () => {
    const result = applyAction(makeState([{ id: 1, type: 'silver' }]), { type: 'SELL', good: 'silver', quantity: 1 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('SELL_TOO_FEW')
  })

  it('fails if hand does not have enough of that good', () => {
    const result = applyAction(makeState([{ id: 1, type: 'cloth' }]), { type: 'SELL', good: 'cloth', quantity: 3 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('SELL_NOT_IN_HAND')
  })
})

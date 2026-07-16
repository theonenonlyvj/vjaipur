import { describe, it, expect } from 'vitest'
import { applyAction } from '../../src/engine/engine'
import { setupRound } from '../../src/engine/setup'
import type { GameState, Card } from '../../src/engine/types'

// Defensive-guard regression tests: applyAction must NEVER throw on illegal
// (non-integer / NaN) indices — it must return a Result error instead, per
// the engine's no-throw contract.

function makeState(market: Card[], hand: Card[] = [], herd = 0, deck: Card[] = []): GameState {
  const base = setupRound([0, 0], undefined, () => 0)
  return {
    ...base,
    market,
    deck,
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

describe('applyAction defensive guards — non-integer / NaN indices never throw', () => {
  describe('TAKE_SINGLE', () => {
    it('returns MARKET_INDEX_OOB (not a throw) for a fractional marketIndex', () => {
      const state = makeState(MARKET)
      expect(() => applyAction(state, { type: 'TAKE_SINGLE', marketIndex: 1.5 })).not.toThrow()
      const result = applyAction(state, { type: 'TAKE_SINGLE', marketIndex: 1.5 })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('MARKET_INDEX_OOB')
    })

    it('returns MARKET_INDEX_OOB (not a throw) for a NaN marketIndex', () => {
      const state = makeState(MARKET)
      expect(() => applyAction(state, { type: 'TAKE_SINGLE', marketIndex: NaN })).not.toThrow()
      const result = applyAction(state, { type: 'TAKE_SINGLE', marketIndex: NaN })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('MARKET_INDEX_OOB')
    })
  })

  describe('TAKE_EXCHANGE', () => {
    const hand: Card[] = [{ id: 20, type: 'cloth' }, { id: 21, type: 'spice' }]

    it('returns MARKET_INDEX_OOB (not a throw) for a fractional market index', () => {
      const state = makeState(MARKET, hand)
      expect(() =>
        applyAction(state, { type: 'TAKE_EXCHANGE', marketIndices: [1.5, 2], handIndices: [0, 1] }),
      ).not.toThrow()
      const result = applyAction(state, { type: 'TAKE_EXCHANGE', marketIndices: [1.5, 2], handIndices: [0, 1] })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('MARKET_INDEX_OOB')
    })

    it('returns MARKET_INDEX_OOB (not a throw) for a NaN market index', () => {
      const state = makeState(MARKET, hand)
      expect(() =>
        applyAction(state, { type: 'TAKE_EXCHANGE', marketIndices: [NaN, 2], handIndices: [0, 1] }),
      ).not.toThrow()
      const result = applyAction(state, { type: 'TAKE_EXCHANGE', marketIndices: [NaN, 2], handIndices: [0, 1] })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('MARKET_INDEX_OOB')
    })

    it('returns HAND_INDEX_OOB (not a throw) for a fractional hand index', () => {
      const state = makeState(MARKET, hand)
      expect(() =>
        applyAction(state, { type: 'TAKE_EXCHANGE', marketIndices: [0, 1], handIndices: [0.5, 1] }),
      ).not.toThrow()
      const result = applyAction(state, { type: 'TAKE_EXCHANGE', marketIndices: [0, 1], handIndices: [0.5, 1] })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('HAND_INDEX_OOB')
    })

    it('returns HAND_INDEX_OOB (not a throw) for a NaN hand index', () => {
      const state = makeState(MARKET, hand)
      expect(() =>
        applyAction(state, { type: 'TAKE_EXCHANGE', marketIndices: [0, 1], handIndices: [NaN, 1] }),
      ).not.toThrow()
      const result = applyAction(state, { type: 'TAKE_EXCHANGE', marketIndices: [0, 1], handIndices: [NaN, 1] })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('HAND_INDEX_OOB')
    })

    it('still allows the -1 sentinel (give camel from herd) alongside a valid integer index', () => {
      // Non-regression: -1 must remain a legal "give a camel" marker, not be
      // caught by the new Number.isInteger guard.
      const state = makeState(MARKET, [{ id: 20, type: 'cloth' }], 3)
      const result = applyAction(state, { type: 'TAKE_EXCHANGE', marketIndices: [0, 1], handIndices: [0, -1] })
      expect(result.ok).toBe(true)
    })
  })
})

import { describe, expect, it } from 'vitest'
import { initialBonusPiles, initialTokenPiles, type GameState } from '../../src/engine'
import { toPublicPayload } from '../src/do/publicPayload'

/**
 * A hand-built fixture (not a real `setupRound` deal) so every field is
 * precisely controlled — `toPublicPayload` only READS `market`/`players[
 * seat].hand`/`bonusTokens`, it never validates legality, so a synthetic
 * fixture exercises every branch far more precisely than a random deal.
 */
function fixtureState(overrides: Partial<GameState> = {}): GameState {
  return {
    phase: 'playing',
    round: 1,
    activePlayer: 0,
    market: [
      { id: 100, type: 'diamond' },
      { id: 101, type: 'camel' },
      { id: 102, type: 'gold' },
      { id: 103, type: 'camel' },
      { id: 104, type: 'silver' },
    ],
    deck: [],
    discard: [],
    revealedHands: [[], []],
    players: [
      {
        hand: [
          { id: 1, type: 'cloth' },
          { id: 2, type: 'cloth' },
          { id: 3, type: 'cloth' },
          { id: 4, type: 'spice' },
          { id: 5, type: 'leather' },
        ],
        herd: 2,
        tokens: [],
        bonusTokens: [],
      },
      { hand: [], herd: 0, tokens: [], bonusTokens: [] },
    ],
    tokens: initialTokenPiles(),
    bonusTokens: initialBonusPiles(() => 0.5), // deterministic (no real Math.random)
    seals: [0, 0],
    ...overrides,
  }
}

describe('toPublicPayload', () => {
  it('TAKE_SINGLE reveals only the exact card taken from the market', () => {
    const state = fixtureState()
    const payload = toPublicPayload(state, 0, { type: 'TAKE_SINGLE', marketIndex: 0 })
    expect(payload).toEqual({ type: 'TAKE_SINGLE', takenCard: { id: 100, type: 'diamond' } })
  })

  it('TAKE_CAMELS reveals only the count of camels taken, never which market slots', () => {
    const state = fixtureState()
    const payload = toPublicPayload(state, 0, { type: 'TAKE_CAMELS' })
    expect(payload).toEqual({ type: 'TAKE_CAMELS', count: 2 })
  })

  it('TAKE_EXCHANGE reveals taken/given cards + a camel count, never raw hand indices', () => {
    const state = fixtureState()
    const payload = toPublicPayload(state, 0, {
      type: 'TAKE_EXCHANGE',
      marketIndices: [0, 2], // diamond, gold
      handIndices: [-1, 0], // one herd camel + hand[0] (cloth id 1)
    })
    expect(payload).toEqual({
      type: 'TAKE_EXCHANGE',
      takenCards: [
        { id: 100, type: 'diamond' },
        { id: 102, type: 'gold' },
      ],
      givenGoods: [{ id: 1, type: 'cloth' }],
      camelsGiven: 1,
    })
    // The raw action's private hand-index shape never leaks into the payload.
    expect(payload).not.toHaveProperty('handIndices')
    expect(payload).not.toHaveProperty('marketIndices')
  })

  it('SELL reveals the exact sold cards + a bonusTier when the tier pile still has one', () => {
    const state = fixtureState()
    const payload = toPublicPayload(state, 0, { type: 'SELL', good: 'cloth', quantity: 3 })
    expect(payload).toEqual({
      type: 'SELL',
      good: 'cloth',
      cards: [
        { id: 1, type: 'cloth' },
        { id: 2, type: 'cloth' },
        { id: 3, type: 'cloth' },
      ],
      count: 3,
      bonusTier: 3,
    })
  })

  it('SELL omits bonusTier when the sale size does not qualify (quantity 1 or 2)', () => {
    const state = fixtureState()
    const payload = toPublicPayload(state, 0, { type: 'SELL', good: 'spice', quantity: 1 })
    expect(payload).toEqual({ type: 'SELL', good: 'spice', cards: [{ id: 4, type: 'spice' }], count: 1 })
    expect(payload).not.toHaveProperty('bonusTier')
  })

  it('SELL omits bonusTier when the matching tier pile is already exhausted', () => {
    const state = fixtureState({ bonusTokens: { ...initialBonusPiles(() => 0.5), three: [] } })
    const payload = toPublicPayload(state, 0, { type: 'SELL', good: 'cloth', quantity: 3 })
    expect(payload).not.toHaveProperty('bonusTier')
  })

  it('reads the CORRECT seat (never a hardcoded seat 0) for TAKE_EXCHANGE/SELL', () => {
    const state = fixtureState({
      activePlayer: 1,
      players: [
        { hand: [], herd: 0, tokens: [], bonusTokens: [] },
        { hand: [{ id: 9, type: 'gold' }, { id: 10, type: 'gold' }], herd: 0, tokens: [], bonusTokens: [] },
      ],
    })
    const payload = toPublicPayload(state, 1, { type: 'SELL', good: 'gold', quantity: 2 })
    expect(payload).toMatchObject({
      cards: [
        { id: 9, type: 'gold' },
        { id: 10, type: 'gold' },
      ],
    })
  })
})

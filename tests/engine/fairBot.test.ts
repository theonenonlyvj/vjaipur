import { describe, it, expect } from 'vitest'
import { OpponentTracker } from '../../src/ai/fairBot'
import type { Card, Good } from '../../src/engine/types'

describe('OpponentTracker', () => {
  it('initializes unknownInHand from opponent hand length', () => {
    const tracker = new OpponentTracker(3)
    expect(tracker.unknownInHand).toBe(3)
    expect(tracker.knownInHand).toEqual([])
  })

  it('tracks a card taken from market', () => {
    const tracker = new OpponentTracker(3)
    const card: Card = { id: 10, type: 'diamond' }
    tracker.opponentTookFromMarket(card)
    expect(tracker.knownInHand).toEqual([card])
    expect(tracker.unknownInHand).toBe(3)
  })

  it('decrements unknownInHand when unknown card is sold', () => {
    const tracker = new OpponentTracker(3)
    const soldCard: Card = { id: 50, type: 'diamond' }
    tracker.opponentSoldOrGave(soldCard)
    expect(tracker.unknownInHand).toBe(2)
  })

  it('removes from knownInHand when a tracked card is sold', () => {
    const tracker = new OpponentTracker(2)
    const card: Card = { id: 10, type: 'gold' }
    tracker.opponentTookFromMarket(card)
    tracker.opponentSoldOrGave(card)
    expect(tracker.knownInHand).toEqual([])
    expect(tracker.unknownInHand).toBe(2)
  })

  it('handles exchange: cards leaving and entering', () => {
    const tracker = new OpponentTracker(3)
    const taken: Card = { id: 10, type: 'diamond' }
    tracker.opponentTookFromMarket(taken)
    tracker.opponentSoldOrGave(taken)
    const newCard: Card = { id: 20, type: 'gold' }
    tracker.opponentTookFromMarket(newCard)
    expect(tracker.knownInHand).toEqual([newCard])
    expect(tracker.unknownInHand).toBe(3)
  })

  it('computes unaccounted cards correctly', () => {
    const tracker = new OpponentTracker(4)
    const myHand: Card[] = [
      { id: 1, type: 'diamond' }, { id: 2, type: 'gold' },
    ]
    const myCamels = 2
    const market: Card[] = [
      { id: 3, type: 'cloth' }, { id: 4, type: 'spice' },
      { id: 5, type: 'camel' }, { id: 6, type: 'leather' },
      { id: 7, type: 'silver' },
    ]
    const discard: Card[] = [{ id: 8, type: 'cloth' }]
    const oppHerd = 3
    const unaccounted = tracker.computeUnaccounted(myHand, myCamels, market, discard, oppHerd)
    const total = Object.values(unaccounted).reduce((s, n) => s + n, 0)
    expect(total).toBe(42)
  })

  it('computes expected opponent hand by good type', () => {
    const tracker = new OpponentTracker(2)
    const unaccounted: Record<string, number> = {
      diamond: 4, gold: 2, silver: 1, cloth: 1, spice: 1, leather: 1, camel: 0,
    }
    const expected = tracker.expectedInOpponentHand('diamond' as Good, unaccounted)
    expect(expected).toBeCloseTo(0.8)
  })

  it('returns 0 expected when unknownInHand is 0', () => {
    const tracker = new OpponentTracker(0)
    const unaccounted: Record<string, number> = {
      diamond: 4, gold: 2, silver: 1, cloth: 1, spice: 1, leather: 1, camel: 0,
    }
    const expected = tracker.expectedInOpponentHand('diamond' as Good, unaccounted)
    expect(expected).toBe(0)
  })
})

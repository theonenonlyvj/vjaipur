import { describe, it, expect } from 'vitest'
import { OpponentTracker, pickFairBotAction, combinations, hypergeoProbAtLeast } from '../../src/ai/fairBot'
import type { Card, Good, GameState, TokenPiles } from '../../src/engine/types'
import { setupRound, initialBonusPiles } from '../../src/engine/setup'

const PAD_DECK: Card[] = [
  { id: 100, type: 'leather' }, { id: 101, type: 'leather' },
  { id: 102, type: 'cloth' },   { id: 103, type: 'cloth' },
  { id: 104, type: 'spice' },   { id: 105, type: 'spice' },
  { id: 106, type: 'leather' }, { id: 107, type: 'leather' },
  { id: 108, type: 'cloth' },   { id: 109, type: 'cloth' },
  { id: 110, type: 'spice' },   { id: 111, type: 'spice' },
]

const FULL_TOKENS: TokenPiles = {
  diamond: [7, 7, 5, 5, 5],
  gold:    [6, 6, 5, 5, 5],
  silver:  [5, 5, 5, 5, 5],
  cloth:   [5, 3, 3, 2, 2, 1, 1],
  spice:   [5, 3, 3, 2, 2, 1, 1],
  leather: [4, 3, 2, 1, 1, 1, 1, 1, 1],
}

function makeState(
  market: Card[],
  aiHand: Card[],
  tokens: TokenPiles,
  oppHand: Card[] = [],
  aiHerd = 0,
  oppHerd = 0,
): GameState {
  const base = setupRound([0, 0], undefined, () => 0)
  return {
    ...base,
    activePlayer: 1,
    market,
    deck: PAD_DECK,
    players: [
      { ...base.players[0], hand: oppHand, herd: oppHerd },
      { ...base.players[1], hand: aiHand, herd: aiHerd },
    ],
    tokens,
    bonusTokens: initialBonusPiles(() => 0),
  }
}

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

describe('Fair Bot — decisions with known opponent hand', () => {
  it('takes diamond to complete a pair when opponent hand is known', () => {
    // Market has one diamond among low-value goods; AI already holds one diamond.
    // Taking diamond completes a precious pair — the best move with expectimax.
    const state = makeState(
      [
        { id: 1, type: 'leather' }, { id: 2, type: 'leather' },
        { id: 3, type: 'leather' }, { id: 4, type: 'leather' },
        { id: 5, type: 'diamond' },
      ],
      [{ id: 6, type: 'diamond' }, { id: 7, type: 'cloth' }],
      FULL_TOKENS,
    )
    const tracker = new OpponentTracker(0)
    const action = pickFairBotAction(state, tracker)
    expect(action).toMatchObject({ type: 'TAKE_SINGLE', marketIndex: 4 })
  })

  it('sells diamonds urgently when pile is nearly depleted', () => {
    const urgentTokens: TokenPiles = { ...FULL_TOKENS, diamond: [7, 7] }
    const state = makeState(
      [
        { id: 1, type: 'cloth' }, { id: 2, type: 'leather' },
        { id: 3, type: 'spice' }, { id: 4, type: 'gold' },
        { id: 5, type: 'leather' },
      ],
      [{ id: 6, type: 'diamond' }, { id: 7, type: 'diamond' }, { id: 8, type: 'leather' }],
      urgentTokens,
      [{ id: 9, type: 'diamond' }, { id: 10, type: 'diamond' }],
    )
    const tracker = new OpponentTracker(0)
    tracker.opponentTookFromMarket({ id: 9, type: 'diamond' })
    tracker.opponentTookFromMarket({ id: 10, type: 'diamond' })
    const action = pickFairBotAction(state, tracker)
    expect(action).toMatchObject({ type: 'SELL', good: 'diamond' })
  })

  it('makes a reasonable move even with fully unknown opponent hand', () => {
    const state = makeState(
      [
        { id: 1, type: 'cloth' }, { id: 2, type: 'spice' },
        { id: 3, type: 'leather' }, { id: 4, type: 'gold' },
        { id: 5, type: 'diamond' },
      ],
      [{ id: 6, type: 'diamond' }, { id: 7, type: 'leather' }],
      FULL_TOKENS,
      [{ id: 8, type: 'cloth' }, { id: 9, type: 'spice' }, { id: 10, type: 'gold' }],
    )
    const tracker = new OpponentTracker(3)
    const action = pickFairBotAction(state, tracker)
    expect(action).not.toBeNull()
    expect(action!.type).toBeDefined()
  })
})

describe('Math helpers', () => {
  it('combinations(5, 2) = 10', () => {
    expect(combinations(5, 2)).toBe(10)
  })

  it('combinations(10, 0) = 1', () => {
    expect(combinations(10, 0)).toBe(1)
  })

  it('combinations(10, 10) = 1', () => {
    expect(combinations(10, 10)).toBe(1)
  })

  it('combinations(3, 5) = 0 (k > n)', () => {
    expect(combinations(3, 5)).toBe(0)
  })

  it('hypergeoProbAtLeast: 4 diamonds in pool of 20, draw 3, need 1', () => {
    const prob = hypergeoProbAtLeast(4, 20, 3, 1)
    expect(prob).toBeCloseTo(0.509, 2)
  })

  it('hypergeoProbAtLeast: need 0 → always 1', () => {
    expect(hypergeoProbAtLeast(0, 20, 3, 0)).toBe(1)
  })

  it('hypergeoProbAtLeast: need more than available → 0', () => {
    expect(hypergeoProbAtLeast(1, 20, 3, 2)).toBe(0)
  })

  it('hypergeoProbAtLeast: need more than draws → 0', () => {
    expect(hypergeoProbAtLeast(10, 20, 1, 2)).toBe(0)
  })
})

describe('Fair Bot — endgame solver', () => {
  it('sells gold urgently when opponent also holds gold and pile is small', () => {
    const endgameTokens: TokenPiles = {
      diamond: [],
      gold: [6, 5],
      silver: [5, 5, 5, 5, 5],
      cloth: [5, 3, 3, 2, 2, 1, 1],
      spice: [5, 3, 3, 2, 2, 1, 1],
      leather: [4, 3, 2, 1, 1, 1, 1, 1, 1],
    }
    const state = makeState(
      [
        { id: 1, type: 'leather' }, { id: 2, type: 'cloth' },
        { id: 3, type: 'spice' }, { id: 4, type: 'leather' },
        { id: 5, type: 'camel' },
      ],
      [{ id: 6, type: 'gold' }, { id: 7, type: 'gold' }],
      endgameTokens,
      [{ id: 8, type: 'gold' }, { id: 9, type: 'gold' }],
    )
    const tracker = new OpponentTracker(0)
    tracker.opponentTookFromMarket({ id: 8, type: 'gold' })
    tracker.opponentTookFromMarket({ id: 9, type: 'gold' })
    const action = pickFairBotAction(state, tracker)
    expect(action).toMatchObject({ type: 'SELL', good: 'gold' })
  })
})

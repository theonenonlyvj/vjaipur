import { describe, it, expect } from 'vitest'
import { createDeck, shuffle, initialTokenPiles, initialBonusPiles, setupRound } from '../../src/engine/setup'

describe('createDeck', () => {
  it('creates 55 cards total', () => {
    expect(createDeck()).toHaveLength(55)
  })

  it('has correct count per type', () => {
    const deck = createDeck()
    const counts = deck.reduce((acc, c) => {
      acc[c.type] = (acc[c.type] ?? 0) + 1
      return acc
    }, {} as Record<string, number>)
    expect(counts).toEqual({
      diamond: 6, gold: 6, silver: 6,
      cloth: 8, spice: 8, leather: 10, camel: 11,
    })
  })

  it('assigns unique ids to all cards', () => {
    const ids = createDeck().map(c => c.id)
    expect(new Set(ids).size).toBe(55)
  })
})

describe('shuffle', () => {
  it('preserves all elements', () => {
    const result = shuffle([1, 2, 3, 4, 5])
    expect([...result].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
  })

  it('uses the provided rng', () => {
    const calls: number[] = []
    const trackingRng = () => { calls.push(1); return 0 }
    shuffle([1, 2, 3, 4], trackingRng)
    expect(calls.length).toBeGreaterThan(0)
  })
})

describe('initialTokenPiles', () => {
  it('has correct diamond values [7,7,5,5,5]', () => {
    expect(initialTokenPiles().diamond).toEqual([7, 7, 5, 5, 5])
  })

  it('has correct gold values [6,6,5,5,5]', () => {
    expect(initialTokenPiles().gold).toEqual([6, 6, 5, 5, 5])
  })

  it('has correct silver values [5,5,5,5,5]', () => {
    expect(initialTokenPiles().silver).toEqual([5, 5, 5, 5, 5])
  })

  it('has correct cloth values [5,3,3,2,2,1,1]', () => {
    expect(initialTokenPiles().cloth).toEqual([5, 3, 3, 2, 2, 1, 1])
  })

  it('has correct spice values [5,3,3,2,2,1,1]', () => {
    expect(initialTokenPiles().spice).toEqual([5, 3, 3, 2, 2, 1, 1])
  })

  it('has correct leather values [4,3,2,1,1,1,1,1,1]', () => {
    expect(initialTokenPiles().leather).toEqual([4, 3, 2, 1, 1, 1, 1, 1, 1])
  })
})

describe('initialBonusPiles', () => {
  it('three pile has 7 tokens with correct values', () => {
    const pile = initialBonusPiles().three
    expect(pile).toHaveLength(7)
    expect(pile.map(t => t.value).sort((a, b) => a - b)).toEqual([1, 1, 2, 2, 2, 3, 3])
  })

  it('four pile has 6 tokens with correct values', () => {
    const pile = initialBonusPiles().four
    expect(pile).toHaveLength(6)
    expect(pile.map(t => t.value).sort((a, b) => a - b)).toEqual([4, 4, 5, 5, 6, 6])
  })

  it('five pile has 5 tokens with correct values', () => {
    const pile = initialBonusPiles().five
    expect(pile).toHaveLength(5)
    expect(pile.map(t => t.value).sort((a, b) => a - b)).toEqual([8, 8, 9, 10, 10])
  })

  it('all tokens have the correct tier', () => {
    const piles = initialBonusPiles()
    expect(piles.three.every(t => t.tier === 3)).toBe(true)
    expect(piles.four.every(t => t.tier === 4)).toBe(true)
    expect(piles.five.every(t => t.tier === 5)).toBe(true)
  })
})

describe('setupRound', () => {
  it('phase is playing', () => {
    expect(setupRound([0, 0]).phase).toBe('playing')
  })

  it('market has exactly 5 cards', () => {
    expect(setupRound([0, 0]).market).toHaveLength(5)
  })

  it('market starts with at least 3 camels', () => {
    const state = setupRound([0, 0], undefined, () => 0)
    const camelCount = state.market.filter(c => c.type === 'camel').length
    expect(camelCount).toBeGreaterThanOrEqual(3)
  })

  it('all 55 cards are accounted for', () => {
    const state = setupRound([0, 0])
    const total =
      state.market.length +
      state.deck.length +
      state.players[0].hand.length +
      state.players[0].herd +
      state.players[1].hand.length +
      state.players[1].herd
    expect(total).toBe(55)
  })

  it('neither player has more than 7 goods in hand', () => {
    const state = setupRound([0, 0])
    expect(state.players[0].hand.length).toBeLessThanOrEqual(7)
    expect(state.players[1].hand.length).toBeLessThanOrEqual(7)
  })

  it('no camels in either player hand (moved to herd)', () => {
    const state = setupRound([0, 0])
    expect(state.players[0].hand.every(c => c.type !== 'camel')).toBe(true)
    expect(state.players[1].hand.every(c => c.type !== 'camel')).toBe(true)
  })

  it('round number = sum of seals + 1', () => {
    expect(setupRound([0, 0]).round).toBe(1)
    expect(setupRound([1, 0]).round).toBe(2)
    expect(setupRound([1, 1]).round).toBe(3)
  })

  it('sets activePlayer to prevLoser when provided', () => {
    expect(setupRound([1, 0], 1).activePlayer).toBe(1)
  })

  it('defaults activePlayer to 0 when prevLoser is not provided', () => {
    expect(setupRound([0, 0]).activePlayer).toBe(0)
  })

  it('discard starts empty', () => {
    expect(setupRound([0, 0]).discard).toEqual([])
  })

  it('seals are carried over from argument', () => {
    const state = setupRound([1, 0])
    expect(state.seals).toEqual([1, 0])
  })

  it('all cards in game have unique ids', () => {
    const state = setupRound([0, 0])
    const allCards = [
      ...state.market,
      ...state.deck,
      ...state.players[0].hand,
      ...state.players[1].hand,
    ]
    const ids = allCards.map(c => c.id)
    expect(new Set(ids).size).toBe(allCards.length)
  })
})

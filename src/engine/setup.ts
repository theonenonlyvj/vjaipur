import type { Card, CardType, GameState, PlayerState, TokenPiles, BonusPiles, BonusToken } from './types'
import { sortHand } from './engine'

export function createDeck(): Card[] {
  const counts: [CardType, number][] = [
    ['diamond', 6], ['gold', 6], ['silver', 6],
    ['cloth', 8], ['spice', 8], ['leather', 10], ['camel', 11],
  ]
  let id = 0
  const cards: Card[] = []
  for (const [type, count] of counts) {
    for (let i = 0; i < count; i++) cards.push({ id: id++, type })
  }
  return cards
}

export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function initialTokenPiles(): TokenPiles {
  return {
    diamond: [7, 7, 5, 5, 5],
    gold:    [6, 6, 5, 5, 5],
    silver:  [5, 5, 5, 5, 5],
    cloth:   [5, 3, 3, 2, 2, 1, 1],
    spice:   [5, 3, 3, 2, 2, 1, 1],
    leather: [4, 3, 2, 1, 1, 1, 1, 1, 1],
  }
}

export function initialBonusPiles(rng: () => number = Math.random): BonusPiles {
  const make = (values: number[], tier: 3 | 4 | 5): BonusToken[] =>
    shuffle(values.map(value => ({ tier, value })), rng)
  return {
    three: make([3, 3, 2, 2, 2, 1, 1], 3),
    four:  make([6, 6, 5, 5, 4, 4],    4),
    five:  make([10, 10, 9, 8, 8],      5),
  }
}

function emptyPlayer(): PlayerState {
  return { hand: [], herd: 0, tokens: [], bonusTokens: [] }
}

export function setupRound(
  seals: [number, number],
  prevLoser?: 0 | 1,
  rng: () => number = Math.random,
): GameState {
  const all = createDeck()

  // Separate exactly 3 camels for the initial market face-up
  const camelIndices: number[] = []
  for (let i = 0; i < all.length && camelIndices.length < 3; i++) {
    if (all[i].type === 'camel') camelIndices.push(i)
  }
  const initialCamels = camelIndices.map(i => all[i])
  const remaining = shuffle(all.filter((_, i) => !camelIndices.includes(i)), rng)

  // Deal 5 to each player, move camels to herd
  const deal = (cards: Card[]): PlayerState => ({
    ...emptyPlayer(),
    hand: sortHand(cards.filter(c => c.type !== 'camel')),
    herd: cards.filter(c => c.type === 'camel').length,
  })

  const p0 = deal(remaining.slice(0, 5))
  const p1 = deal(remaining.slice(5, 10))
  let deck = remaining.slice(10)

  // Fill market to 5: 3 camels + 2 from deck
  const market = [...initialCamels, ...deck.slice(0, 2)]
  deck = deck.slice(2)

  return {
    phase: 'playing',
    round: seals[0] + seals[1] + 1,
    activePlayer: prevLoser ?? 0,
    market,
    deck,
    discard: [],
    revealedHands: [[], []],
    players: [p0, p1],
    tokens: initialTokenPiles(),
    bonusTokens: initialBonusPiles(rng),
    seals,
  }
}

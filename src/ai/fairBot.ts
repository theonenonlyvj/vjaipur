import type { GameState, Action, Good, Card, CardType } from '../engine'

const DECK_COMPOSITION: Record<CardType, number> = {
  diamond: 6, gold: 6, silver: 6, cloth: 8, spice: 8, leather: 10, camel: 11,
}

const ALL_TYPES: CardType[] = ['diamond', 'gold', 'silver', 'cloth', 'spice', 'leather', 'camel']

export class OpponentTracker {
  knownInHand: Card[] = []
  unknownInHand: number

  constructor(initialHandLength: number) {
    this.unknownInHand = initialHandLength
  }

  opponentTookFromMarket(card: Card): void {
    this.knownInHand.push(card)
  }

  opponentSoldOrGave(card: Card): void {
    const idx = this.knownInHand.findIndex(c => c.id === card.id)
    if (idx >= 0) {
      this.knownInHand.splice(idx, 1)
    } else {
      this.unknownInHand = Math.max(0, this.unknownInHand - 1)
    }
  }

  computeUnaccounted(
    myHand: Card[],
    myCamels: number,
    market: Card[],
    discard: Card[],
    oppHerd: number,
  ): Record<CardType, number> {
    const counts: Record<CardType, number> = { ...DECK_COMPOSITION }
    for (const card of myHand) counts[card.type]--
    counts.camel -= myCamels
    for (const card of market) counts[card.type]--
    for (const card of discard) counts[card.type]--
    for (const card of this.knownInHand) counts[card.type]--
    counts.camel -= oppHerd
    for (const type of ALL_TYPES) {
      if (counts[type] < 0) counts[type] = 0
    }
    return counts
  }

  expectedInOpponentHand(good: Good, unaccounted: Record<CardType, number>): number {
    if (this.unknownInHand === 0) return 0
    const total = Object.values(unaccounted).reduce((s, n) => s + n, 0)
    if (total === 0) return 0
    return unaccounted[good] * (this.unknownInHand / total)
  }

  opponentEffective(good: Good, unaccounted: Record<CardType, number>): number {
    const known = this.knownInHand.filter(c => c.type === good).length
    return known + this.expectedInOpponentHand(good, unaccounted)
  }
}

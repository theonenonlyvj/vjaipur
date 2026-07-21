import { describe, it, expect, afterEach } from 'vitest'
import { setupRound } from '../../src/engine/setup'
import { mulberry32 } from '../../src/shared/rng'
import { pickHard2Action } from '../../src/ai/hardAi2'
import type { GameState, Card } from '../../src/engine/types'

/**
 * PROOF that the "Hard" bot (hardAi2) does NOT cheat.
 *
 * The acid test for cheating: does the bot's chosen move depend on information
 * it should not be able to see — the opponent's hidden (unrevealed) hand cards,
 * or the exact order of the face-down deck?
 *
 * A FAIR bot cannot tell two states apart when they differ ONLY in that hidden
 * information (everything public — my hand, the market, the discard, the
 * revealed cards, the herd/token counts, and the opponent's hand SIZE — is
 * identical). A CHEATER would react differently.
 *
 * hardAi2 reconstructs the opponent's hand and reshuffles the deck from public
 * info only (see fairifyState). So with the randomness seeded identically, it
 * must return the BYTE-IDENTICAL move on two states that differ only in hidden
 * cards / deck order. This test locks that in — if anyone ever makes the bot
 * peek, it fails.
 */

// Deterministically drive Math.random for a single pickHard2Action call so two
// calls share the exact same random sequence (fairifyState uses shuffle, which
// defaults to Math.random). Save/restore around each call.
const realRandom = Math.random
afterEach(() => { Math.random = realRandom })
function withSeededRandom<T>(seed: number, fn: () => T): T {
  const rng = mulberry32(seed)
  Math.random = rng
  try {
    return fn()
  } finally {
    Math.random = realRandom
  }
}

/** Move down to a stable, order-independent comparable shape. */
function moveKey(a: ReturnType<typeof pickHard2Action>): string {
  if (!a) return 'null'
  if (a.type === 'TAKE_SINGLE') return `TAKE_SINGLE:${a.marketIndex}`
  if (a.type === 'TAKE_CAMELS') return 'TAKE_CAMELS'
  if (a.type === 'SELL') return `SELL:${a.good}:${a.quantity}`
  // TAKE_EXCHANGE — market indices identify PUBLIC market cards (fine to
  // compare); hand indices index the bot's OWN hand, identical across A/B.
  return `TAKE_EXCHANGE:m[${[...a.marketIndices].sort().join(',')}]:h[${[...a.handIndices].sort().join(',')}]`
}

/** Swap `count` cards between the opponent's hidden hand and the deck, so the
 *  55-card multiset is conserved and everything PUBLIC (opp hand length,
 *  revealedHands, market, discard, my hand, herds, tokens, deck length) is
 *  unchanged — only the opponent's SECRET cards and the deck contents differ. */
function swapHiddenOppCards(state: GameState, oppIndex: 0 | 1, count: number): GameState {
  const opp = state.players[oppIndex]
  const n = Math.min(count, opp.hand.length, state.deck.length)
  const newOppHand: Card[] = [...state.deck.slice(0, n), ...opp.hand.slice(n)]
  const newDeck: Card[] = [...opp.hand.slice(0, n), ...state.deck.slice(n)]
  return {
    ...state,
    deck: newDeck,
    players: state.players.map((p, i) => (i === oppIndex ? { ...p, hand: newOppHand } : p)) as GameState['players'],
  }
}

describe('hardAi2 ("Hard") is provably FAIR — it never sees the opponent hand or deck order', () => {
  // Several fresh deals; the opponent's whole hand is unrevealed after a deal
  // (revealedHands = [[],[]]), so this is the maximal hidden-information case.
  const seeds = [1, 7, 42, 101, 777, 2024, 31337]

  it("returns the SAME move when the opponent's SECRET hand is swapped (public state identical)", () => {
    for (const seed of seeds) {
      const base = setupRound([0, 0], undefined, mulberry32(seed))
      // Bot plays the active seat; the opponent is the other seat.
      const oppIndex: 0 | 1 = base.activePlayer === 0 ? 1 : 0
      // Sanity: nothing about the opponent's hand is public yet.
      expect(base.revealedHands[oppIndex]).toEqual([])

      const variantA = base
      const variantB = swapHiddenOppCards(base, oppIndex, base.players[oppIndex].hand.length)

      // The two states differ ONLY in the opponent's hidden hand + deck.
      expect(variantB.players[oppIndex].hand).not.toEqual(variantA.players[oppIndex].hand)
      // ...while every PUBLIC field is identical:
      expect(variantB.market).toEqual(variantA.market)
      expect(variantB.discard).toEqual(variantA.discard)
      expect(variantB.revealedHands).toEqual(variantA.revealedHands)
      expect(variantB.players[oppIndex].hand.length).toBe(variantA.players[oppIndex].hand.length)
      expect(variantB.players[oppIndex].herd).toBe(variantA.players[oppIndex].herd)
      expect(variantB.deck.length).toBe(variantA.deck.length)

      const moveA = withSeededRandom(seed * 31 + 1, () => pickHard2Action(variantA))
      const moveB = withSeededRandom(seed * 31 + 1, () => pickHard2Action(variantB))

      // A fair bot literally cannot distinguish A from B -> identical decision.
      expect(moveKey(moveB)).toBe(moveKey(moveA))
    }
  })

  it('returns the SAME move when only the DECK ORDER changes (no seeing the future)', () => {
    for (const seed of seeds) {
      const base = setupRound([0, 0], undefined, mulberry32(seed))
      const reversedDeck: GameState = { ...base, deck: [...base.deck].reverse() }
      expect(reversedDeck.deck).not.toEqual(base.deck)

      const moveA = withSeededRandom(seed * 17 + 5, () => pickHard2Action(base))
      const moveB = withSeededRandom(seed * 17 + 5, () => pickHard2Action(reversedDeck))
      expect(moveKey(moveB)).toBe(moveKey(moveA))
    }
  })
})

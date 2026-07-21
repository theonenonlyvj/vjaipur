import { describe, it, expect, afterEach } from 'vitest'
import { setupRound } from '../../src/engine/setup'
import { mulberry32 } from '../../src/shared/rng'
import { pickIsmctsAction } from '../../src/ai/ismctsBot'
import type { GameState, Card } from '../../src/engine/types'

/**
 * PROOF that the ISMCTS bot does NOT cheat — mirrors
 * tests/engine/hardAi2.fairness.test.ts exactly, adapted for pickIsmctsAction.
 *
 * The acid test: does the bot's chosen move depend on information it should
 * not be able to see — the opponent's hidden (unrevealed) hand cards, or the
 * exact order of the face-down deck? A FAIR bot cannot tell two states apart
 * when they differ ONLY in that hidden information. ismctsBot reconstructs
 * the opponent's hand and reshuffles the deck from public info only (see
 * fairifyState — copied/adapted from hardAi2.ts, not imported, per the
 * design brief). So with the randomness seeded identically, it must return
 * the BYTE-IDENTICAL move on two states that differ only in hidden cards /
 * deck order.
 *
 * `maxIterations` (not `budgetMs`) is used here deliberately: a wall-clock
 * deadline makes iteration COUNT itself timing-dependent (ordinary
 * scheduling jitter can make two back-to-back calls complete a different
 * number of iterations even with identical Math.random seeding), which would
 * make this proof flaky for reasons that have nothing to do with fairness.
 * Fixing the iteration count removes that source of nondeterminism so the
 * test isolates exactly what it's meant to prove.
 */

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

const TEST_ITERATIONS = 60

function moveKey(a: ReturnType<typeof pickIsmctsAction>): string {
  if (!a) return 'null'
  if (a.type === 'TAKE_SINGLE') return `TAKE_SINGLE:${a.marketIndex}`
  if (a.type === 'TAKE_CAMELS') return 'TAKE_CAMELS'
  if (a.type === 'SELL') return `SELL:${a.good}:${a.quantity}`
  return `TAKE_EXCHANGE:m[${[...a.marketIndices].sort().join(',')}]:h[${[...a.handIndices].sort().join(',')}]`
}

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

describe('ismctsBot ("Hard (ISMCTS)") is provably FAIR — it never sees the opponent hand or deck order', () => {
  const seeds = [1, 7, 42, 101, 777, 2024, 31337]

  it("returns the SAME move when the opponent's SECRET hand is swapped (public state identical)", () => {
    for (const seed of seeds) {
      const base = setupRound([0, 0], undefined, mulberry32(seed))
      const oppIndex: 0 | 1 = base.activePlayer === 0 ? 1 : 0
      expect(base.revealedHands[oppIndex]).toEqual([])

      const variantA = base
      const variantB = swapHiddenOppCards(base, oppIndex, base.players[oppIndex].hand.length)

      expect(variantB.players[oppIndex].hand).not.toEqual(variantA.players[oppIndex].hand)
      expect(variantB.market).toEqual(variantA.market)
      expect(variantB.discard).toEqual(variantA.discard)
      expect(variantB.revealedHands).toEqual(variantA.revealedHands)
      expect(variantB.players[oppIndex].hand.length).toBe(variantA.players[oppIndex].hand.length)
      expect(variantB.players[oppIndex].herd).toBe(variantA.players[oppIndex].herd)
      expect(variantB.deck.length).toBe(variantA.deck.length)

      const opts = { maxIterations: TEST_ITERATIONS }
      const moveA = withSeededRandom(seed * 31 + 1, () => pickIsmctsAction(variantA, opts))
      const moveB = withSeededRandom(seed * 31 + 1, () => pickIsmctsAction(variantB, opts))

      expect(moveKey(moveB)).toBe(moveKey(moveA))
    }
  })

  it('returns the SAME move when only the DECK ORDER changes (no seeing the future)', () => {
    for (const seed of seeds) {
      const base = setupRound([0, 0], undefined, mulberry32(seed))
      const reversedDeck: GameState = { ...base, deck: [...base.deck].reverse() }
      expect(reversedDeck.deck).not.toEqual(base.deck)

      const opts = { maxIterations: TEST_ITERATIONS }
      const moveA = withSeededRandom(seed * 17 + 5, () => pickIsmctsAction(base, opts))
      const moveB = withSeededRandom(seed * 17 + 5, () => pickIsmctsAction(reversedDeck, opts))
      expect(moveKey(moveB)).toBe(moveKey(moveA))
    }
  })
})

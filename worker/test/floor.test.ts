import { describe, expect, it } from 'vitest'
import { applyAction, getLegalActions, setupRound, type Action, type GameState } from '../../src/engine'
import { mulberry32 } from '../../src/shared/rng'
import { floorMove } from '../src/do/floor'

/**
 * ADDENDUM N — the CPU-kill floor move MUST always be a legal move. This is
 * the never-stall backstop of last resort: if it were ever illegal, the
 * engine would reject it and a covered seat would stall forever with no
 * further fallback.
 */

function actionEquals(a: Action, b: Action): boolean {
  if (a.type !== b.type) return false
  switch (a.type) {
    case 'TAKE_SINGLE':
      return b.type === 'TAKE_SINGLE' && a.marketIndex === b.marketIndex
    case 'TAKE_CAMELS':
      return b.type === 'TAKE_CAMELS'
    case 'SELL':
      return b.type === 'SELL' && a.good === b.good && a.quantity === b.quantity
    case 'TAKE_EXCHANGE':
      return (
        b.type === 'TAKE_EXCHANGE' &&
        JSON.stringify(a.marketIndices) === JSON.stringify(b.marketIndices) &&
        JSON.stringify(a.handIndices) === JSON.stringify(b.handIndices)
      )
  }
}

/** Walk a fresh round-1 deal through a bounded, seeded-random number of
 *  engine-legal plies, using ITS OWN rng draw for both the deal and the walk
 *  so the whole trajectory is reproducible from `seed` alone. Returns the
 *  resulting state, which may or may not still be `'playing'` (the caller
 *  filters). */
function walkToMidGame(seed: number): GameState {
  const dealRng = mulberry32(seed)
  const walkRng = mulberry32(seed * 2654435761 + 1)
  let state: GameState = setupRound([0, 0], undefined, dealRng)
  const steps = 1 + Math.floor(walkRng() * 15) // 1..15 random plies
  for (let i = 0; i < steps && state.phase === 'playing'; i++) {
    const legal = getLegalActions(state)
    if (legal.length === 0) break
    const action = legal[Math.floor(walkRng() * legal.length)]!
    const result = applyAction(state, action)
    // A move getLegalActions itself reported legal must always apply cleanly.
    expect(result.ok).toBe(true)
    if (result.ok) state = result.value
  }
  return state
}

describe('floorMove (ADDENDUM N — the CPU-kill floor)', () => {
  it('is always a legal move across 1000 seeded reachable mid-game states', () => {
    let tested = 0
    let seed = 0
    let attempts = 0
    const MAX_ATTEMPTS = 20_000

    while (tested < 1000 && attempts < MAX_ATTEMPTS) {
      seed++
      attempts++
      const state = walkToMidGame(seed)
      if (state.phase !== 'playing') continue // this walk ended the round; try the next seed

      const legal = getLegalActions(state)
      // Jaipur always has a legal move for a 'playing' state — if this ever
      // fails, it is an ENGINE bug (ADDENDUM N), not a floorMove bug.
      expect(legal.length).toBeGreaterThan(0)

      const fm = floorMove(state)
      expect(legal.some((a) => actionEquals(a, fm))).toBe(true)
      tested++
    }

    expect(tested).toBe(1000)
  })

  it('picks TAKE_CAMELS whenever the market has a camel', () => {
    let state = setupRound([0, 0], undefined, mulberry32(1))
    // Find a reachable state (from the same walk logic) with a camel still in
    // market — the initial deal always has exactly 3, so round 1 qualifies.
    expect(state.market.some((c) => c.type === 'camel')).toBe(true)
    expect(floorMove(state)).toEqual({ type: 'TAKE_CAMELS' })
  })
})

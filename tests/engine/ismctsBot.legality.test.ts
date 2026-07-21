import { describe, it, expect } from 'vitest'
import { setupRound } from '../../src/engine/setup'
import { getLegalActions, applyAction } from '../../src/engine'
import { mulberry32 } from '../../src/shared/rng'
import { pickIsmctsAction } from '../../src/ai/ismctsBot'
import type { GameState } from '../../src/engine/types'

/**
 * Basic legality proof: across many seeded states (fresh deals AND states a
 * few random plies in, so both hand/market shapes and mid-round situations
 * are covered), pickIsmctsAction must always return either null (only legal
 * when there are no actions at all — shouldn't happen mid-round) or an
 * action that the real engine accepts via applyAction. This also transitively
 * covers TAKE_SINGLE/TAKE_CAMELS/SELL membership in getLegalActions (the
 * engine's own enumerator) for the non-exchange cases, and — since
 * getLegalActions deliberately excludes TAKE_EXCHANGE (see engine.ts) —
 * falls back to the ground truth (applyAction succeeding) for exchanges,
 * which is the only exhaustive legality oracle exchanges have.
 */

// Small deterministic random walk to reach varied mid-round states, using
// only the engine's own legal-action enumerator (+ never TAKE_EXCHANGE, kept
// simple/robust for state generation) so this stays independent of the bot
// under test.
function randomWalk(state: GameState, plies: number, rng: () => number): GameState {
  let cur = state
  for (let i = 0; i < plies; i++) {
    if (cur.phase !== 'playing') break
    const actions = getLegalActions(cur)
    if (actions.length === 0) break
    const action = actions[Math.floor(rng() * actions.length)]
    const result = applyAction(cur, action)
    if (!result.ok) break
    cur = result.value
  }
  return cur
}

describe('pickIsmctsAction always returns a legal action (or null with no options)', () => {
  const seeds = Array.from({ length: 30 }, (_, i) => i * 101 + 3)

  it('returns an engine-legal action (applyAction succeeds) across ~30 seeded states, fresh and mid-round', () => {
    for (const seed of seeds) {
      const rng = mulberry32(seed)
      const fresh = setupRound([0, 0], undefined, rng)
      // Walk a handful of plies (varies per seed) to get mid-round variety —
      // different hand sizes, market compositions, herds, revealed hands.
      const walkPlies = seed % 7
      const state = randomWalk(fresh, walkPlies, rng)

      if (state.phase !== 'playing') continue // round ended during the walk — nothing to assert here

      const action = pickIsmctsAction(state, { maxIterations: 25 })

      if (action === null) {
        // Only legal if there truly are no candidate actions at all.
        expect(getLegalActions(state).length).toBe(0)
        continue
      }

      const result = applyAction(state, action)
      expect(result.ok, `seed ${seed}: action ${JSON.stringify(action)} was rejected: ${!result.ok ? result.error.code : ''}`).toBe(true)
    }
  })
})

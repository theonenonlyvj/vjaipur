import { describe, it, expect } from 'vitest'
import { setupRound } from '../../src/engine/setup'
import { pickIsmctsAction, getLastIsmctsDebugInfo } from '../../src/ai/ismctsBot'
import { mulberry32 } from '../../src/shared/rng'

// 2026-08-02 iteration floor: "Hard (ISMCTS)" must be the same opponent on a
// throttled phone as on a desktop. The search runs until BOTH the wall-clock
// budget is spent AND minIterations is reached (bounded by the hard cap);
// pinned-iteration mode is untouched.
describe('ismcts iteration floor (consistent strength on throttled devices)', () => {
  function freshState(seed = 42) {
    return setupRound([0, 0], undefined, mulberry32(seed))
  }

  it('keeps searching past an exhausted time budget until the floor is reached', () => {
    const orig = Math.random
    Math.random = mulberry32(7)
    try {
      // budgetMs=1 is instantly exhausted — WITHOUT the floor this would stop
      // after a handful of iterations; the floor must carry it to 3000.
      const a = pickIsmctsAction(freshState(), { budgetMs: 1, minIterations: 3000 })
      expect(a).not.toBeNull()
      expect(getLastIsmctsDebugInfo()!.iterations).toBeGreaterThanOrEqual(3000)
    } finally {
      Math.random = orig
    }
  })

  it('minIterations: 0 restores pure time-budget semantics (benchmark mode)', () => {
    const orig = Math.random
    Math.random = mulberry32(7)
    try {
      const a = pickIsmctsAction(freshState(), { budgetMs: 60, minIterations: 0 })
      expect(a).not.toBeNull()
      // Time-bounded: nowhere near the default 25k floor in 60ms of search.
      expect(getLastIsmctsDebugInfo()!.iterations).toBeLessThan(25_000)
    } finally {
      Math.random = orig
    }
  })

  it('pinned maxIterations ignores the floor entirely (fairness-proof mode)', () => {
    const orig = Math.random
    Math.random = mulberry32(7)
    try {
      pickIsmctsAction(freshState(), { maxIterations: 500, minIterations: 25_000 })
      expect(getLastIsmctsDebugInfo()!.iterations).toBe(500)
    } finally {
      Math.random = orig
    }
  })
})

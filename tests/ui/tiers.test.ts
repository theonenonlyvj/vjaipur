import { describe, it, expect } from 'vitest'
import {
  TIERS,
  ACTIVE_TIERS,
  getTier,
  getTierLabel,
  resolveDefaultTierId,
  DEFAULT_TIER_ID,
  type Tier,
} from '../../src/ai/tiers'

// Every id that has ever been recorded as opponent_type for a vs-AI match
// (see gameStore.ts Difficulty union / runAi). These must ALWAYS resolve to
// a label, even after being retired from the picker, so historical stats
// rows never go nameless.
const HISTORICAL_IDS = ['easy', 'medium', 'hard', 'hard2', 'ismcts', 'hard3', 'fair']

describe('tiers: historical id coverage', () => {
  it('every historical opponent_type id has a TIERS entry', () => {
    for (const id of HISTORICAL_IDS) {
      expect(getTier(id), `missing tier entry for historical id "${id}"`).toBeDefined()
    }
  })

  it('every historical id resolves to a non-empty label', () => {
    for (const id of HISTORICAL_IDS) {
      const label = getTierLabel(id)
      expect(label).toBeTruthy()
      expect(label).not.toBe(id) // real label, not a bare-id fallback
    }
  })

  it('falls back to the raw id for something that is not an AI tier at all', () => {
    expect(getTierLabel('online')).toBe('online')
    expect(getTierLabel('totally-unknown')).toBe('totally-unknown')
  })

  it('TIERS has no duplicate ids', () => {
    const ids = TIERS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('tiers: active picker lineup', () => {
  // 2026-07-20 lineup rework: hardAi2 ('hard2') replaces fairBot ('fair') as
  // the active "Hard" — it already beat fairBot 82% head-to-head and, with
  // the endgame-tactics + ~1500ms-budget fixes from this rework, plays the
  // closing moves correctly too. fairBot is retired (still resolvable, still
  // fully functional under its old id — just off the picker).
  //
  // 2026-07-21 lineup addition: ismctsBot ('ismcts') ships ALONGSIDE hardAi2
  // as its own "Hard (ISMCTS)" tier for an A/B, slotted between "Hard" and
  // "Omniscient Bot". hardAi2 is untouched.
  it('is exactly the 5 active tiers, in picker order', () => {
    expect(ACTIVE_TIERS.map((t) => t.id)).toEqual(['easy', 'medium', 'hard2', 'ismcts', 'hard3'])
  })

  it('none of the active tiers are marked retired', () => {
    for (const t of ACTIVE_TIERS) expect(t.retired).toBe(false)
  })

  it('active tiers have increasing pickerOrder starting at 1', () => {
    expect(ACTIVE_TIERS.map((t) => t.pickerOrder)).toEqual([1, 2, 3, 4, 5])
  })

  it('labels: Easy, Medium, Hard (hardAi2), Hard (ISMCTS), Omniscient Bot (hardAi3)', () => {
    const byId = Object.fromEntries(ACTIVE_TIERS.map((t) => [t.id, t.label]))
    expect(byId.easy).toBe('Easy')
    expect(byId.medium).toBe('Medium')
    expect(byId.hard2).toBe('Hard')
    expect(byId.ismcts).toBe('Hard (ISMCTS)')
    expect(byId.hard3).toBe('Omniscient Bot')
  })

  it('active tiers all carry non-empty picker taglines', () => {
    for (const t of ACTIVE_TIERS) expect(t.tagline.length).toBeGreaterThan(0)
  })
})

describe('tiers: retired tiers stay resolvable but out of the picker', () => {
  it('hard and fair are marked retired with null pickerOrder', () => {
    const hard = getTier('hard')!
    const fair = getTier('fair')!
    expect(hard.retired).toBe(true)
    expect(hard.pickerOrder).toBeNull()
    expect(fair.retired).toBe(true)
    expect(fair.pickerOrder).toBeNull()
  })

  it('retired tiers are excluded from ACTIVE_TIERS', () => {
    const activeIds = ACTIVE_TIERS.map((t) => t.id)
    expect(activeIds).not.toContain('hard')
    expect(activeIds).not.toContain('fair')
  })

  it('retired ids still resolve to a "Classic" label', () => {
    expect(getTierLabel('hard')).toBe('Hard (Classic)')
    expect(getTierLabel('fair')).toBe('Hard (FairBot, Classic)')
  })
})

describe('resolveDefaultTierId', () => {
  it('keeps the preferred tier when it is active', () => {
    expect(resolveDefaultTierId('easy')).toBe('easy')
  })

  it('falls back to medium when the preferred default has been retired', () => {
    const simulatedTiers: Tier[] = TIERS.map((t) =>
      t.id === 'easy' ? { ...t, retired: true, pickerOrder: null } : t
    )
    expect(resolveDefaultTierId('easy', simulatedTiers)).toBe('medium')
  })

  it('falls back to the preferred id itself if even medium is missing/retired (defensive)', () => {
    const simulatedTiers: Tier[] = TIERS
      .filter((t) => t.id !== 'medium')
      .map((t) => (t.id === 'easy' ? { ...t, retired: true } : t))
    expect(resolveDefaultTierId('easy', simulatedTiers)).toBe('easy')
  })

  it('DEFAULT_TIER_ID is easy (not retired) in the real lineup', () => {
    expect(DEFAULT_TIER_ID).toBe('easy')
  })
})

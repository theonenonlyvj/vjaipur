import { describe, it, expect } from 'vitest'
import {
  TIERS,
  ACTIVE_TIERS,
  FAMILIES,
  getTier,
  getTierLabel,
  getTierFamily,
  getFamilyMembers,
  getFamilyPrimary,
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
    expect(byId.hard2).toBe('Hard (αβ)')
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

describe('tier families (leaderboard "Hard"/"Medium" drill-down grouping)', () => {
  // 2026-07-21 REASSIGNMENT (Vijay's data-backed call, do not revert): the
  // two retired Classic tiers ('hard', 'fair') moved from `family: 'hard'`
  // to `family: 'medium'` — each benchmarked only ~70%/73% vs Medium, not
  // the ~100% the real hard family (hard2/ismcts) runs. 'medium' itself now
  // carries `family: 'medium'` as that family's own canonical member.

  it("FAMILIES contains exactly 'medium' and 'hard', in first-seen TIERS order", () => {
    expect(FAMILIES).toEqual(['medium', 'hard'])
  })

  it('hard2 and ismcts are tagged family: "hard" — hard/fair are NOT', () => {
    expect(getTierFamily('hard2')).toBe('hard')
    expect(getTierFamily('ismcts')).toBe('hard')
    expect(getTierFamily('hard')).not.toBe('hard')
    expect(getTierFamily('fair')).not.toBe('hard')
  })

  it('medium, hard, and fair are all tagged family: "medium"', () => {
    expect(getTierFamily('medium')).toBe('medium')
    expect(getTierFamily('hard')).toBe('medium')
    expect(getTierFamily('fair')).toBe('medium')
  })

  it('easy and hard3 (Omniscient Bot) have no family — they stay flat, standalone chips', () => {
    expect(getTierFamily('easy')).toBeUndefined()
    expect(getTierFamily('hard3')).toBeUndefined()
  })

  it('an unknown id has no family (getTier returns undefined, so does getTierFamily)', () => {
    expect(getTierFamily('totally-unknown')).toBeUndefined()
  })

  it('getFamilyMembers("hard") returns only hard2 and ismcts, in TIERS declaration order', () => {
    expect(getFamilyMembers('hard').map((t) => t.id)).toEqual(['hard2', 'ismcts'])
  })

  it('getFamilyMembers("medium") returns medium, hard, and fair, in TIERS declaration order', () => {
    expect(getFamilyMembers('medium').map((t) => t.id)).toEqual(['medium', 'hard', 'fair'])
  })

  it('getFamilyPrimary("hard") is hard2 — the active member with the lowest pickerOrder', () => {
    const primary = getFamilyPrimary('hard')
    expect(primary.id).toBe('hard2')
    expect(primary.label).toBe('Hard (αβ)')
    expect(primary.retired).toBe(false)
  })

  it('getFamilyPrimary breaks ties by pickerOrder, not TIERS order: ismcts (order 4) never outranks hard2 (order 3)', () => {
    expect(getFamilyPrimary('hard').pickerOrder).toBe(3)
  })

  it('getFamilyPrimary("medium") is medium itself — the only non-retired member (hard/fair are both retired)', () => {
    const primary = getFamilyPrimary('medium')
    expect(primary.id).toBe('medium')
    expect(primary.label).toBe('Medium')
    expect(primary.retired).toBe(false)
    expect(primary.pickerOrder).toBe(2)
  })

  it('hard and fair keep their own "Classic" labels even though they now file under the medium family', () => {
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

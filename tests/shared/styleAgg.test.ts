import { describe, it, expect } from 'vitest'
import {
  emptyStyleAgg,
  aggregateGame,
  mergeStyleAgg,
  finalizeStyle,
  type StyleLogEntry,
  type StyleAgg,
  type PerActorAgg,
} from '../../src/shared/styleAgg'

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const GOODS = ['diamond', 'gold', 'silver', 'cloth', 'spice', 'leather']

function tok(overrides: Record<string, number[]>): number[][] {
  return GOODS.map((g) => overrides[g] ?? [1, 1, 1])
}

function emptyPerActor(): PerActorAgg {
  return {
    actionCounts: {},
    sellSizeHist: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    bonusSalesByTier: { 3: 0, 4: 0, 5: 0 },
    cheapBonusSalesByTier: { 3: 0, 4: 0, 5: 0 },
    preciousAt2: 0,
    preciousTotal: 0,
    tokensEarned: 0,
    cardsSold: 0,
    takeCamelsCount: 0,
    totalMoves: 0,
  }
}

function perActor(overrides: Partial<PerActorAgg>): PerActorAgg {
  return { ...emptyPerActor(), ...overrides }
}

/** Build a full StyleAgg directly (bypassing aggregateGame) for
 *  finalizeStyle-level tests, where we want PRECISE control over counts
 *  rather than simulating realistic games. */
function makeAgg(overrides: {
  games?: number
  wins?: number
  losses?: number
  human?: Partial<PerActorAgg>
  ai?: Partial<PerActorAgg>
  camelMajority?: Partial<StyleAgg['camelMajority']>
  trajectory?: Partial<StyleAgg['trajectory']>
}): StyleAgg {
  const base = emptyStyleAgg()
  return {
    games: overrides.games ?? base.games,
    wins: overrides.wins ?? base.wins,
    losses: overrides.losses ?? base.losses,
    human: perActor(overrides.human ?? {}),
    ai: perActor(overrides.ai ?? {}),
    camelMajority: { ...base.camelMajority, ...(overrides.camelMajority ?? {}) },
    trajectory: overrides.trajectory ? { ...base.trajectory, ...overrides.trajectory } : base.trajectory,
  }
}

// ---------------------------------------------------------------------------
// Two hand-built games for aggregateGame-level (folding) tests.
// ---------------------------------------------------------------------------

// Game A: human wins, round 1. Human sells spice qty2 (pile [6,4] -> got 10,
// 2 cards), takes camels once; ai sells diamond qty2 (precious, at exactly
// 2) with pile [5,3] -> got 8, 2 cards, then sells cloth (CHEAP) qty4 (a
// 4-bonus) with pile [4,3,2,1] -> got 10, 4 cards. Round ends on ai's
// TAKE_CAMELS (ply 5), herd [1,3] -> ai majority.
const gameA: StyleLogEntry[] = [
  {
    actor: 'human',
    ply: 1,
    round: 1,
    action: { type: 'SELL', good: 'spice', quantity: 2 },
    preState: { tok: tok({ spice: [6, 4, 3] }), score: [0, 0], herd: [0, 3] },
  },
  {
    actor: 'human',
    ply: 2,
    round: 1,
    action: { type: 'TAKE_CAMELS' },
    preState: { tok: tok({}), score: [10, 0], herd: [0, 3] },
  },
  {
    actor: 'ai',
    ply: 3,
    round: 1,
    action: { type: 'SELL', good: 'diamond', quantity: 2 },
    preState: { tok: tok({ diamond: [5, 3, 2] }), score: [10, 0], herd: [1, 3] },
  },
  {
    actor: 'ai',
    ply: 4,
    round: 1,
    action: { type: 'SELL', good: 'cloth', quantity: 4 },
    preState: { tok: tok({ cloth: [4, 3, 2, 1] }), score: [10, 8], herd: [1, 3] },
  },
  // Round's LAST entry: ai TAKE_CAMELS, herd [1,3] pre-move (still ai ahead) -> ai majority.
  {
    actor: 'ai',
    ply: 5,
    round: 1,
    action: { type: 'TAKE_CAMELS' },
    preState: { tok: tok({}), score: [10, 18], herd: [1, 3] },
  },
  // Capped entry (no preState) — must still count toward action mix /
  // sell-size histogram / bonus tier / precious counts (all action-only),
  // but must NOT contribute to tokensEarned/cardsSold, the trajectory, or
  // camel-majority (it isn't the round's last entry here either).
  {
    actor: 'human',
    ply: 6,
    round: 1,
    action: { type: 'SELL', good: 'silver', quantity: 1 },
  },
]

// Game B: human loses, round 1. Human sells cloth (CHEAP) qty1 (pile [5] ->
// got 5, 1 card); ai takes camels twice, sells leather (CHEAP) qty3 (a
// 3-bonus) with pile [3,2,2] -> got 7, 3 cards. Round ends on ai's second
// TAKE_CAMELS, herd [1,2] pre-move -> ai majority again.
const gameB: StyleLogEntry[] = [
  {
    actor: 'human',
    ply: 1,
    round: 1,
    action: { type: 'SELL', good: 'cloth', quantity: 1 },
    preState: { tok: tok({ cloth: [5, 4] }), score: [0, 0], herd: [0, 0] },
  },
  {
    actor: 'ai',
    ply: 2,
    round: 1,
    action: { type: 'TAKE_CAMELS' },
    preState: { tok: tok({}), score: [5, 0], herd: [0, 0] },
  },
  {
    actor: 'ai',
    ply: 3,
    round: 1,
    action: { type: 'SELL', good: 'leather', quantity: 3 },
    preState: { tok: tok({ leather: [3, 2, 2, 1] }), score: [5, 0], herd: [1, 1] },
  },
  {
    actor: 'ai',
    ply: 4,
    round: 1,
    action: { type: 'TAKE_CAMELS' },
    preState: { tok: tok({}), score: [5, 7], herd: [1, 2] },
  },
]

describe('aggregateGame — exact hand-computed values', () => {
  it('folds game A correctly', () => {
    const agg = aggregateGame(emptyStyleAgg(), gameA, { won: true })

    expect(agg.games).toBe(1)
    expect(agg.wins).toBe(1)
    expect(agg.losses).toBe(0)

    // human: 2 SELLs (spice qty2 preState-bearing, silver qty1 capped) + 1 TAKE_CAMELS = 3 moves
    expect(agg.human.totalMoves).toBe(3)
    expect(agg.human.actionCounts).toEqual({ SELL: 2, TAKE_CAMELS: 1 })
    expect(agg.human.sellSizeHist).toEqual({ 1: 1, 2: 1, 3: 0, 4: 0, 5: 0 }) // qty2 (spice) + qty1 (silver, capped)
    expect(agg.human.bonusSalesByTier).toEqual({ 3: 0, 4: 0, 5: 0 }) // neither qty>=3
    expect(agg.human.preciousTotal).toBe(1) // silver qty1 (capped entry still counts — action-only metric)
    expect(agg.human.preciousAt2).toBe(0)
    expect(agg.human.tokensEarned).toBe(10) // spice: 6+4 (silver sale skipped — no preState)
    expect(agg.human.cardsSold).toBe(2)
    expect(agg.human.takeCamelsCount).toBe(1)

    // ai: SELL diamond qty2 (precious, at 2) + SELL cloth qty4 (4-bonus, CHEAP) + TAKE_CAMELS = 3 moves
    expect(agg.ai.totalMoves).toBe(3)
    expect(agg.ai.actionCounts).toEqual({ SELL: 2, TAKE_CAMELS: 1 })
    expect(agg.ai.sellSizeHist).toEqual({ 1: 0, 2: 1, 3: 0, 4: 1, 5: 0 })
    expect(agg.ai.bonusSalesByTier).toEqual({ 3: 0, 4: 1, 5: 0 })
    expect(agg.ai.cheapBonusSalesByTier).toEqual({ 3: 0, 4: 1, 5: 0 }) // cloth is cheap
    expect(agg.ai.preciousTotal).toBe(1)
    expect(agg.ai.preciousAt2).toBe(1)
    expect(agg.ai.tokensEarned).toBe(18) // diamond 5+3=8, cloth 4+3+2+1=10
    expect(agg.ai.cardsSold).toBe(6) // 2 + 4

    // camel majority: round 1's last preState-bearing entry is ply 5 (ai TAKE_CAMELS), herd [1,3] -> ai majority
    expect(agg.camelMajority).toEqual({ roundsAnalyzed: 1, humanMajority: 0, aiMajority: 1 })

    // trajectory: full ply range is 1..6 (6 entries total, incl. the capped
    // one), so range=6; only ply 1-5 carry preState. ph = floor(4*(ply-1)/6):
    // ply1 -> floor(0/6)=0, ply2 -> floor(4/6)=0, ply3 -> floor(8/6)=1,
    // ply4 -> floor(12/6)=2, ply5 -> floor(16/6)=2
    // diffs (score[0]-score[1]): ply1:0-0=0, ply2:10-0=10, ply3:10-0=10, ply4:10-8=2, ply5:10-18=-8
    expect(agg.trajectory.wins[0]).toEqual({ sum: 10, count: 2 }) // ply1(0) + ply2(10)
    expect(agg.trajectory.wins[1]).toEqual({ sum: 10, count: 1 }) // ply3
    expect(agg.trajectory.wins[2]).toEqual({ sum: -6, count: 2 }) // ply4(2) + ply5(-8)
    expect(agg.trajectory.wins[3]).toEqual({ sum: 0, count: 0 })
    expect(agg.trajectory.losses).toEqual([
      { sum: 0, count: 0 },
      { sum: 0, count: 0 },
      { sum: 0, count: 0 },
      { sum: 0, count: 0 },
    ])
  })

  it('folds game B correctly', () => {
    const agg = aggregateGame(emptyStyleAgg(), gameB, { won: false })

    expect(agg.games).toBe(1)
    expect(agg.wins).toBe(0)
    expect(agg.losses).toBe(1)

    expect(agg.human.totalMoves).toBe(1)
    expect(agg.human.sellSizeHist).toEqual({ 1: 1, 2: 0, 3: 0, 4: 0, 5: 0 })
    expect(agg.human.tokensEarned).toBe(5)
    expect(agg.human.cardsSold).toBe(1)

    expect(agg.ai.totalMoves).toBe(3)
    expect(agg.ai.takeCamelsCount).toBe(2)
    expect(agg.ai.bonusSalesByTier).toEqual({ 3: 1, 4: 0, 5: 0 })
    expect(agg.ai.cheapBonusSalesByTier).toEqual({ 3: 1, 4: 0, 5: 0 }) // leather is cheap
    expect(agg.ai.tokensEarned).toBe(7) // leather 3+2+2
    expect(agg.ai.cardsSold).toBe(3)

    // camel majority: round 1's last entry (ply4, ai TAKE_CAMELS), herd [1,2] -> ai majority
    expect(agg.camelMajority).toEqual({ roundsAnalyzed: 1, humanMajority: 0, aiMajority: 1 })

    // trajectory: all 4 entries carry preState, ply range 1..4 (range=4) ->
    // ph = floor(4*(ply-1)/4) = ply-1, one entry per phase exactly.
    // diffs: 0-0=0, 5-0=5, 5-0=5, 5-7=-2
    expect(agg.trajectory.losses[0]).toEqual({ sum: 0, count: 1 })
    expect(agg.trajectory.losses[1]).toEqual({ sum: 5, count: 1 })
    expect(agg.trajectory.losses[2]).toEqual({ sum: 5, count: 1 })
    expect(agg.trajectory.losses[3]).toEqual({ sum: -2, count: 1 })
  })
})

describe('mergeStyleAgg — associativity (the property the incremental cache relies on)', () => {
  it('aggregating both games in one pass equals folding them one at a time, in either order', () => {
    const sequential = aggregateGame(aggregateGame(emptyStyleAgg(), gameA, { won: true }), gameB, { won: false })
    const reversed = aggregateGame(aggregateGame(emptyStyleAgg(), gameB, { won: false }), gameA, { won: true })

    const aggA = aggregateGame(emptyStyleAgg(), gameA, { won: true })
    const aggB = aggregateGame(emptyStyleAgg(), gameB, { won: false })
    const merged = mergeStyleAgg(aggA, aggB)
    const mergedReversed = mergeStyleAgg(aggB, aggA)

    expect(merged).toEqual(sequential)
    expect(merged).toEqual(reversed)
    expect(merged).toEqual(mergedReversed) // commutative too

    expect(merged.games).toBe(2)
    expect(merged.wins).toBe(1)
    expect(merged.losses).toBe(1)
    expect(merged.human.tokensEarned).toBe(15) // 10+5
    expect(merged.human.cardsSold).toBe(3) // 2+1
    expect(merged.ai.tokensEarned).toBe(25) // 18+7
    expect(merged.ai.cardsSold).toBe(9) // 6+3
    expect(merged.human.actionCounts).toEqual({ SELL: 3, TAKE_CAMELS: 1 })
    expect(merged.ai.actionCounts).toEqual({ SELL: 3, TAKE_CAMELS: 3 })
    expect(merged.camelMajority).toEqual({ roundsAnalyzed: 2, humanMajority: 0, aiMajority: 2 })
  })

  it('an incremental 3-way fold (simulating the worker cache: cached-so-far merged with one new row at a time) matches the from-scratch aggregate', () => {
    const gameC: StyleLogEntry[] = [
      {
        actor: 'human',
        ply: 1,
        round: 1,
        action: { type: 'SELL', good: 'gold', quantity: 5 },
        preState: { tok: tok({ gold: [9, 8, 7, 6, 5] }), score: [0, 0], herd: [0, 0] },
      },
    ]

    const fromScratch = [gameA, gameB, gameC].reduce((acc, g, i) => aggregateGame(acc, g, { won: i !== 1 }), emptyStyleAgg())

    let cached = aggregateGame(emptyStyleAgg(), gameA, { won: true })
    cached = mergeStyleAgg(cached, aggregateGame(emptyStyleAgg(), gameB, { won: false }))
    cached = mergeStyleAgg(cached, aggregateGame(emptyStyleAgg(), gameC, { won: true }))

    expect(cached).toEqual(fromScratch)
    expect(cached.games).toBe(3)
    expect(cached.human.sellSizeHist[5]).toBe(1) // gold qty5 from game C
  })
})

// ---------------------------------------------------------------------------
// Camel majority — dedicated correctness tests (design council item 8).
// ---------------------------------------------------------------------------

describe('aggregateGame — camel majority at round end', () => {
  it('a tie at the round-end proxy counts toward roundsAnalyzed but wins neither side', () => {
    const log: StyleLogEntry[] = [
      {
        actor: 'human',
        ply: 1,
        round: 1,
        action: { type: 'TAKE_CAMELS' },
        preState: { tok: tok({}), score: [0, 0], herd: [2, 2] },
      },
    ]
    const agg = aggregateGame(emptyStyleAgg(), log, { won: true })
    expect(agg.camelMajority).toEqual({ roundsAnalyzed: 1, humanMajority: 0, aiMajority: 0 })
  })

  it("falls back to an EARLIER preState-bearing entry in the round when the round's trailing entries lack preState", () => {
    const log: StyleLogEntry[] = [
      {
        actor: 'human',
        ply: 1,
        round: 1,
        action: { type: 'TAKE_CAMELS' },
        preState: { tok: tok({}), score: [0, 0], herd: [5, 1] }, // human majority
      },
      // Trailing capped entries of the SAME round, no preState.
      { actor: 'ai', ply: 2, round: 1, action: { type: 'TAKE_SINGLE' } },
      { actor: 'human', ply: 3, round: 1, action: { type: 'TAKE_SINGLE' } },
    ]
    const agg = aggregateGame(emptyStyleAgg(), log, { won: true })
    expect(agg.camelMajority).toEqual({ roundsAnalyzed: 1, humanMajority: 1, aiMajority: 0 })
  })

  it('a round with NO preState-bearing entry at all is excluded from roundsAnalyzed entirely', () => {
    const log: StyleLogEntry[] = [
      { actor: 'human', ply: 1, round: 1, action: { type: 'TAKE_SINGLE' } },
      { actor: 'ai', ply: 2, round: 1, action: { type: 'TAKE_SINGLE' } },
      // Round 2 DOES have preState — proves round 1's exclusion doesn't
      // swallow round 2's count.
      {
        actor: 'human',
        ply: 3,
        round: 2,
        action: { type: 'TAKE_CAMELS' },
        preState: { tok: tok({}), score: [0, 0], herd: [1, 4] }, // ai majority
      },
    ]
    const agg = aggregateGame(emptyStyleAgg(), log, { won: true })
    expect(agg.camelMajority).toEqual({ roundsAnalyzed: 1, humanMajority: 0, aiMajority: 1 })
  })

  it('multiple rounds accumulate independently', () => {
    const log: StyleLogEntry[] = [
      { actor: 'human', ply: 1, round: 1, action: { type: 'TAKE_CAMELS' }, preState: { tok: tok({}), score: [0, 0], herd: [5, 1] } },
      { actor: 'ai', ply: 2, round: 2, action: { type: 'TAKE_CAMELS' }, preState: { tok: tok({}), score: [0, 0], herd: [1, 5] } },
      { actor: 'human', ply: 3, round: 3, action: { type: 'TAKE_CAMELS' }, preState: { tok: tok({}), score: [0, 0], herd: [5, 1] } },
    ]
    const agg = aggregateGame(emptyStyleAgg(), log, { won: true })
    expect(agg.camelMajority).toEqual({ roundsAnalyzed: 3, humanMajority: 2, aiMajority: 1 })
  })
})

// ---------------------------------------------------------------------------
// Trajectory bucketing MUST use ply position within the game's ply range,
// not array index among preState-bearing entries (design council item 12).
// ---------------------------------------------------------------------------

describe('aggregateGame — trajectory buckets by ply position, not filtered-array index', () => {
  it('non-contiguous surviving preState entries land in the buckets their PLY position implies, not evenly spread across phases', () => {
    // 10 total plies (full range 1..10, so range=10). Only ply 1, 2, 9, 10
    // survive capping with preState — a naive "index among the 4 surviving
    // entries" bucketing (the OLD bug) would spread them one-per-phase
    // (ph 0,1,2,3). The correct ply-based bucketing must instead cluster
    // them at the extremes: ph = floor(4*(ply-1)/10).
    //   ply1 -> floor(0/10)=0        ply2 -> floor(4/10)=0
    //   ply9 -> floor(32/10)=3       ply10 -> floor(36/10)=3
    const log: StyleLogEntry[] = []
    for (let ply = 1; ply <= 10; ply++) {
      const hasPreState = ply === 1 || ply === 2 || ply === 9 || ply === 10
      const diff = ply === 1 ? 1 : ply === 2 ? 2 : ply === 9 ? 3 : ply === 10 ? 4 : 0
      log.push({
        actor: 'human',
        ply,
        round: 1,
        action: { type: 'TAKE_SINGLE' },
        ...(hasPreState ? { preState: { tok: tok({}), score: [diff, 0] as [number, number], herd: [0, 0] as [number, number] } } : {}),
      })
    }

    const agg = aggregateGame(emptyStyleAgg(), log, { won: true })
    expect(agg.trajectory.wins[0]).toEqual({ sum: 3, count: 2 }) // ply1(1) + ply2(2)
    expect(agg.trajectory.wins[1]).toEqual({ sum: 0, count: 0 })
    expect(agg.trajectory.wins[2]).toEqual({ sum: 0, count: 0 })
    expect(agg.trajectory.wins[3]).toEqual({ sum: 7, count: 2 }) // ply9(3) + ply10(4)
  })
})

// ---------------------------------------------------------------------------
// finalizeStyle — sample-size gating, rate rows, point-impact ranking,
// coaching, tags, and the 3-/5-bonus drop-to-note rule.
// ---------------------------------------------------------------------------

describe('finalizeStyle — per-row sample-size gating', () => {
  it('tokensPerCard is INELIGIBLE (dimmed) below the 30-cards-sold floor, with a sampleNote', () => {
    const agg = makeAgg({
      games: 5,
      human: { cardsSold: 10, tokensEarned: 40 },
      ai: { cardsSold: 40, tokensEarned: 120 },
    })
    const row = finalizeStyle(agg).rows.find((r) => r.id === 'tokensPerCard')!
    expect(row.eligible).toBe(false)
    expect(row.sampleNote).toBe('needs more data (n=10, need 30)')
    // Values are still REAL and present (dimmed, not hidden).
    expect(row.human).toBeCloseTo(4, 6)
    expect(row.ai).toBeCloseTo(3, 6)
  })

  it('tokensPerCard is ELIGIBLE at/above the floor (limited by whichever side has fewer)', () => {
    const agg = makeAgg({
      games: 5,
      human: { cardsSold: 30, tokensEarned: 150 },
      ai: { cardsSold: 35, tokensEarned: 105 },
    })
    const row = finalizeStyle(agg).rows.find((r) => r.id === 'tokensPerCard')!
    expect(row.eligible).toBe(true)
    expect(row.sampleNote).toBe('')
    expect(row.human).toBeCloseTo(5, 6)
    expect(row.ai).toBeCloseTo(3, 6)
  })

  it('bonus rate rows are ineligible below the 10-bonus-eligible-sales-per-side floor', () => {
    const agg = makeAgg({
      games: 5,
      human: { bonusSalesByTier: { 3: 2, 4: 1, 5: 0 } }, // sum=3
      ai: { bonusSalesByTier: { 3: 5, 4: 5, 5: 5 } }, // sum=15
    })
    const finalized = finalizeStyle(agg)
    for (const id of ['bonus3Rate', 'bonus4Rate', 'bonus5Rate'] as const) {
      const row = finalized.rows.find((r) => r.id === id)!
      expect(row.eligible).toBe(false)
      expect(row.sampleNote).toBe('needs more data (n=3, need 10)')
    }
  })

  it('bonus4Rate is a RATE of bonus-eligible sales (not a raw count), with raw counts in the subCaption', () => {
    const agg = makeAgg({
      games: 5,
      human: { bonusSalesByTier: { 3: 5, 4: 2, 5: 3 } }, // sum=10, rate4=20%
      ai: { bonusSalesByTier: { 3: 2, 4: 6, 5: 2 } }, // sum=10, rate4=60%
    })
    const row = finalizeStyle(agg).rows.find((r) => r.id === 'bonus4Rate')!
    expect(row.eligible).toBe(true)
    expect(row.format).toBe('percent')
    expect(row.human).toBeCloseTo(20, 6)
    expect(row.ai).toBeCloseTo(60, 6)
    expect(row.subCaption).toBe('2 of 10 bonus sales · bot 6 of 10')
    expect(row.gapKind).toBe('points')
    expect(row.gapPct).toBeCloseTo(40, 6) // percentage-POINT gap, not relative
    expect(row.side).toBe('ai')
  })

  it('camel majority row computes real percentages and an eligible sub-caption folding in the frequency-only stat', () => {
    const agg = makeAgg({
      games: 20,
      human: { totalMoves: 60, takeCamelsCount: 10 },
      ai: { totalMoves: 55, takeCamelsCount: 20 },
      camelMajority: { roundsAnalyzed: 12, humanMajority: 3, aiMajority: 9 },
    })
    const row = finalizeStyle(agg).rows.find((r) => r.id === 'camelMajority')!
    expect(row.eligible).toBe(true) // 12 >= 10
    expect(row.human).toBeCloseTo(25, 6) // 3/12
    expect(row.ai).toBeCloseTo(75, 6) // 9/12
    expect(row.subCaption).toContain('3 of 12 analyzed rounds')
    expect(row.subCaption).toContain('bot 9')
    // Frequency-only clause included (min moves 55 >= 50 floor) and tagged style-not-verdict.
    expect(row.subCaption).toContain('you take camels on 17% of your moves vs bot 36%')
    expect(row.subCaption).toContain('style, not verdict')
  })

  it("camel majority sub-caption shows its OWN needs-more-data note for the folded frequency stat when moves are under-sampled, even though the row itself is eligible", () => {
    const agg = makeAgg({
      games: 20,
      human: { totalMoves: 10, takeCamelsCount: 2 },
      ai: { totalMoves: 8, takeCamelsCount: 3 },
      camelMajority: { roundsAnalyzed: 12, humanMajority: 3, aiMajority: 9 },
    })
    const row = finalizeStyle(agg).rows.find((r) => r.id === 'camelMajority')!
    expect(row.eligible).toBe(true) // the ROW's own floor (rounds) is cleared
    expect(row.subCaption).toContain('camel-taking frequency needs more data (n=8, need 50)')
  })
})

describe('finalizeStyle — 3-/5-bonus drop-to-note rule', () => {
  it('drops BOTH bonus3Rate and bonus5Rate to a note when they are eligible AND confidently dead-even', () => {
    const agg = makeAgg({
      games: 10,
      human: { bonusSalesByTier: { 3: 10, 4: 5, 5: 10 } }, // sum=25, rate3=40%, rate5=40%
      ai: { bonusSalesByTier: { 3: 10, 4: 5, 5: 10 } }, // identical -> dead even on both
    })
    const finalized = finalizeStyle(agg)
    expect(finalized.rows.find((r) => r.id === 'bonus3Rate')).toBeUndefined()
    expect(finalized.rows.find((r) => r.id === 'bonus5Rate')).toBeUndefined()
    expect(finalized.notes).toContain('3- and 5-card bonus rates are dead even too.')
    // bonus4Rate is also even here but is NEVER dropped (only the 3/5 pair is).
    expect(finalized.rows.find((r) => r.id === 'bonus4Rate')).toBeDefined()
  })

  it('does NOT drop an under-sampled (ineligible) pair even if their raw numbers happen to be equal — shown dimmed instead', () => {
    const agg = makeAgg({
      games: 10,
      human: { bonusSalesByTier: { 3: 1, 4: 0, 5: 1 } }, // sum=2, well under floor
      ai: { bonusSalesByTier: { 3: 1, 4: 0, 5: 1 } },
    })
    const finalized = finalizeStyle(agg)
    const row3 = finalized.rows.find((r) => r.id === 'bonus3Rate')
    const row5 = finalized.rows.find((r) => r.id === 'bonus5Rate')
    expect(row3).toBeDefined()
    expect(row5).toBeDefined()
    expect(row3!.eligible).toBe(false)
    expect(row5!.eligible).toBe(false)
    expect(finalized.notes).toEqual([])
  })

  it('does NOT drop the pair when only ONE of the two is dead-even', () => {
    const agg = makeAgg({
      games: 10,
      human: { bonusSalesByTier: { 3: 10, 4: 0, 5: 20 } }, // rate3=33%, rate5=67%
      ai: { bonusSalesByTier: { 3: 10, 4: 0, 5: 10 } }, // rate3=50%, rate5=50% -> 3 is close-ish, 5 is far
    })
    const finalized = finalizeStyle(agg)
    // Whatever the exact gaps land on, at least one of the pair must be live
    // (non-dead) here, so neither gets silently dropped.
    expect(finalized.rows.find((r) => r.id === 'bonus3Rate')).toBeDefined()
    expect(finalized.rows.find((r) => r.id === 'bonus5Rate')).toBeDefined()
  })
})

describe('finalizeStyle — row order, tagging, and coaching are ranked by ESTIMATED POINT IMPACT, not raw gap size', () => {
  // A deliberately constructed agg where bonus4Rate has an ENORMOUS
  // percentage-point gap (100) but a tiny sample-weighted impact, while
  // camelMajority has a much SMALLER gap (6 points) but a huge
  // rounds-per-game weight — proving the ranking is impact-based, not
  // gap-magnitude-based. tokensPerCard is human-favored, for the tag test.
  //
  // pointImpact arithmetic (using this module's real, engine-sourced
  // constants: BONUS_TIER_MEAN_VALUE[4]=5, CAMEL_TOKEN_VALUE=5 — see
  // src/engine/setup.ts / src/engine/scoring.ts):
  //   tokensPerCard: |5-3| * (100/1000)              = 2 * 0.1   = 0.2
  //   bonus4Rate:    (100/100) * (10/1000) * 5        = 1 * 0.01 * 5 = 0.05
  //   camelMajority: (6/100) * (500/1000) * 5         = 0.06 * 0.5 * 5 = 0.15
  //   bonus3Rate:    (100/100) * (10/1000) * 2        = 1 * 0.01 * 2 = 0.02
  //   bonus5Rate:    0 (dead even, human=ai=0%)
  const RICH_AGG = makeAgg({
    games: 1000,
    wins: 1000,
    losses: 0,
    human: {
      cardsSold: 100,
      tokensEarned: 500, // tokensPerCard human = 5
      bonusSalesByTier: { 3: 10, 4: 0, 5: 0 }, // rate4=0%, rate3=100%, rate5=0%
    },
    ai: {
      cardsSold: 60,
      tokensEarned: 180, // tokensPerCard ai = 3
      bonusSalesByTier: { 3: 0, 4: 10, 5: 0 }, // rate4=100%, rate3=0%, rate5=0%
    },
    camelMajority: { roundsAnalyzed: 500, humanMajority: 200, aiMajority: 230 }, // 40% vs 46%
  })
  const finalized = finalizeStyle(RICH_AGG)

  it('sorts rows by pointImpact descending: tokensPerCard, camelMajority, bonus4Rate, bonus3Rate, bonus5Rate', () => {
    expect(finalized.rows.map((r) => r.id)).toEqual(['tokensPerCard', 'camelMajority', 'bonus4Rate', 'bonus3Rate', 'bonus5Rate'])
  })

  it('tags exactly one row per side — the biggest LIVE gap by pointImpact, NOT by raw gap size', () => {
    const tagged = finalized.rows.filter((r) => r.tag === 'gap')
    expect(tagged).toHaveLength(2)
    // camelMajority (impact 0.15) beats bonus4Rate (impact 0.05) for the
    // ai-side tag despite bonus4Rate's much larger 100-point gap.
    expect(finalized.rows.find((r) => r.id === 'camelMajority')!.tag).toBe('gap')
    expect(finalized.rows.find((r) => r.id === 'bonus4Rate')!.tag).toBeNull()
    // tokensPerCard (impact 0.2) beats bonus3Rate (impact 0.02) for the human-side tag.
    expect(finalized.rows.find((r) => r.id === 'tokensPerCard')!.tag).toBe('gap')
    expect(finalized.rows.find((r) => r.id === 'bonus3Rate')!.tag).toBeNull()
  })

  it('coaching picks the HIGHEST-pointImpact eligible ai-favored row (camelMajority), not the largest-gap one (bonus4Rate)', () => {
    expect(finalized.coaching).toContain('camel majority')
    expect(finalized.coaching).toContain('230 of 500 analyzed rounds')
    expect(finalized.coaching).toContain('your 200')
    expect(finalized.coaching).not.toMatch(/4-card|4th card/i)
  })

  it('every pointImpact is finite and never appears as a literal figure in the coaching text', () => {
    for (const row of finalized.rows) expect(Number.isFinite(row.pointImpact)).toBe(true)
    // The coaching text must never assert a specific "+N points"-style claim.
    expect(finalized.coaching).not.toMatch(/\+\s*\d+(\.\d+)?\s*(pts?|points?)/i)
  })
})

describe('finalizeStyle — coaching fallback when nothing eligible/live favors the bot', () => {
  it('an all-zero agg falls back to the exact "play more games" text (no eligible ai-favored row exists)', () => {
    const finalized = finalizeStyle(emptyStyleAgg())
    expect(finalized.coaching).toBe('Play more games — your style read sharpens as you go.')
    expect(finalized.rows.every((r) => r.tag === null)).toBe(true)
  })

  it('a fixed metric-order tie-break governs row order when every pointImpact ties (e.g. all zero)', () => {
    const finalized = finalizeStyle(emptyStyleAgg())
    expect(finalized.rows.map((r) => r.id)).toEqual(['tokensPerCard', 'bonus4Rate', 'camelMajority', 'bonus3Rate', 'bonus5Rate'])
  })

  it('falls back even when the bot leads a row that never clears its floor', () => {
    const agg = makeAgg({
      games: 3,
      human: { bonusSalesByTier: { 3: 0, 4: 0, 5: 0 } },
      ai: { bonusSalesByTier: { 3: 0, 4: 3, 5: 0 } }, // ai "leads" but sample is tiny (well under floor 10)
    })
    const finalized = finalizeStyle(agg)
    expect(finalized.rows.find((r) => r.id === 'bonus4Rate')!.eligible).toBe(false)
    expect(finalized.coaching).toBe('Play more games — your style read sharpens as you go.')
  })

  it('falls back when the bot never leads anything (human ahead or even everywhere)', () => {
    const agg = makeAgg({
      games: 50,
      human: { cardsSold: 100, tokensEarned: 500, bonusSalesByTier: { 3: 20, 4: 20, 5: 20 } },
      ai: { cardsSold: 100, tokensEarned: 300, bonusSalesByTier: { 3: 5, 4: 5, 5: 5 } },
      camelMajority: { roundsAnalyzed: 20, humanMajority: 15, aiMajority: 2 },
    })
    const finalized = finalizeStyle(agg)
    expect(finalized.rows.some((r) => r.side === 'ai' && r.eligible && !r.dead)).toBe(false)
    expect(finalized.coaching).toBe('Play more games — your style read sharpens as you go.')
  })
})

describe('finalizeStyle — bonus4Rate coaching text is conditioned and never advises holding precious', () => {
  it('cites CHEAP-goods-specific counts when they exist, and explicitly warns against precious 3-stacks', () => {
    const agg = makeAgg({
      games: 30,
      human: {
        bonusSalesByTier: { 3: 5, 4: 2, 5: 3 },
        cheapBonusSalesByTier: { 3: 3, 4: 1, 5: 1 },
      },
      ai: {
        bonusSalesByTier: { 3: 2, 4: 8, 5: 0 },
        cheapBonusSalesByTier: { 3: 1, 4: 6, 5: 0 },
      },
    })
    const finalized = finalizeStyle(agg)
    const bonus4 = finalized.rows.find((r) => r.id === 'bonus4Rate')!
    expect(bonus4.side).toBe('ai')
    if (finalized.rows.find((r) => r.tag === 'gap' && r.side === 'ai')?.id === 'bonus4Rate') {
      expect(finalized.coaching).toContain('cheap goods (cloth/spice/leather)')
      expect(finalized.coaching).toContain('the bot does this 6 times to your 1') // cheap-goods-specific counts
      expect(finalized.coaching).toMatch(/never hold a precious/i)
    }
  })

  it('falls back to a goods-agnostic phrasing (still with the precious caveat) when cheap-specific counts are both zero', () => {
    const agg = makeAgg({
      games: 30,
      human: { bonusSalesByTier: { 3: 5, 4: 0, 5: 0 }, cheapBonusSalesByTier: { 3: 0, 4: 0, 5: 0 } },
      ai: { bonusSalesByTier: { 3: 0, 4: 10, 5: 0 }, cheapBonusSalesByTier: { 3: 0, 4: 0, 5: 0 } },
    })
    const finalized = finalizeStyle(agg)
    const decider = finalized.rows.find((r) => r.tag === 'gap' && r.side === 'ai')
    if (decider?.id === 'bonus4Rate') {
      expect(finalized.coaching).toMatch(/never/i)
      expect(finalized.coaching).toMatch(/precious/i)
      expect(finalized.coaching).not.toContain('the bot does this 0 times to your 0')
    }
  })
})

describe('finalizeStyle — signatures are gated by their own eligibility floor', () => {
  it('cherryPicker requires >=20 total human sells; below that it never fires even if the raw share exceeds 30%', () => {
    const agg = makeAgg({
      games: 5,
      human: { sellSizeHist: { 1: 4, 2: 1, 3: 0, 4: 0, 5: 0 } }, // 4/5 = 80% share, but only 5 sells
    })
    const finalized = finalizeStyle(agg)
    expect(finalized.signatures.cherryPickerEligible).toBe(false)
    expect(finalized.signatures.cherryPicker).toBe(false)
    expect(finalized.signatures.cherryPickerPct).toBeCloseTo(80, 6) // value still computed, just not flagged
  })

  it('cherryPicker fires once >=20 sells clears the floor and share exceeds 30%', () => {
    const agg = makeAgg({
      games: 10,
      human: { sellSizeHist: { 1: 10, 2: 5, 3: 5, 4: 0, 5: 0 } }, // 20 sells, 50% share
    })
    const finalized = finalizeStyle(agg)
    expect(finalized.signatures.cherryPickerEligible).toBe(true)
    expect(finalized.signatures.cherryPicker).toBe(true)
  })

  it('preciousTempo is ineligible below its floor even with a striking human rate', () => {
    const agg = makeAgg({
      games: 10,
      human: { preciousAt2: 4, preciousTotal: 6 },
      ai: { preciousAt2: 1, preciousTotal: 6 },
    })
    const finalized = finalizeStyle(agg)
    expect(finalized.signatures.preciousTempoEligible).toBe(false) // min(6,6)=6 < 10
    expect(finalized.signatures.preciousTempo).toBe(false)
  })

  it("preciousTempo fires at/above its floor and reports both sides' real rates neutrally", () => {
    const agg = makeAgg({
      games: 20,
      human: { preciousAt2: 10, preciousTotal: 15 }, // 66.7%
      ai: { preciousAt2: 8, preciousTotal: 12 }, // 66.7%
    })
    const finalized = finalizeStyle(agg)
    expect(finalized.signatures.preciousTempoEligible).toBe(true)
    expect(finalized.signatures.preciousTempo).toBe(true)
    expect(finalized.signatures.preciousTempoHumanPct).toBeCloseTo((10 / 15) * 100, 6)
    expect(finalized.signatures.preciousTempoAiPct).toBeCloseTo((8 / 12) * 100, 6)
  })

  it('boomPlayer requires >=10 wins and a final-phase mean win-trajectory diff over 8', () => {
    const belowFloor = makeAgg({
      games: 5,
      wins: 5,
      trajectory: { wins: [{ sum: 0, count: 1 }, { sum: 0, count: 1 }, { sum: 0, count: 1 }, { sum: 50, count: 1 }] },
    })
    expect(finalizeStyle(belowFloor).signatures.boomPlayerEligible).toBe(false)
    expect(finalizeStyle(belowFloor).signatures.boomPlayer).toBe(false)

    const atFloor = makeAgg({
      games: 10,
      wins: 10,
      trajectory: { wins: [{ sum: 0, count: 1 }, { sum: 0, count: 1 }, { sum: 0, count: 1 }, { sum: 50, count: 1 }] },
    })
    expect(finalizeStyle(atFloor).signatures.boomPlayerEligible).toBe(true)
    expect(finalizeStyle(atFloor).signatures.boomPlayer).toBe(true)
  })
})

describe('finalizeStyle — JSON safety', () => {
  it('a rich finalize round-trips through JSON with no NaN/Infinity/undefined corruption', () => {
    const agg = makeAgg({
      games: 40,
      wins: 20,
      losses: 20,
      human: { cardsSold: 40, tokensEarned: 160, bonusSalesByTier: { 3: 10, 4: 5, 5: 2 } },
      ai: { cardsSold: 50, tokensEarned: 100, bonusSalesByTier: { 3: 3, 4: 12, 5: 1 } },
      camelMajority: { roundsAnalyzed: 15, humanMajority: 5, aiMajority: 8 },
    })
    const finalized = finalizeStyle(agg)
    const roundTripped = JSON.parse(JSON.stringify(finalized))
    expect(roundTripped).toEqual(finalized)
    for (const row of finalized.rows) {
      expect(Number.isFinite(row.human)).toBe(true)
      expect(Number.isFinite(row.ai)).toBe(true)
      expect(Number.isFinite(row.gapPct)).toBe(true)
      expect(Number.isFinite(row.pointImpact)).toBe(true)
    }
  })

  it('an empty agg finalizes to all-zero, no NaN/Infinity, every row dimmed and dead-even', () => {
    const finalized = finalizeStyle(emptyStyleAgg())
    expect(finalized.games).toBe(0)
    expect(finalized.winPct).toBe(0)
    for (const row of finalized.rows) {
      expect(Number.isFinite(row.human)).toBe(true)
      expect(Number.isFinite(row.ai)).toBe(true)
      expect(row.side).toBe('even')
      expect(row.dead).toBe(true)
      expect(row.eligible).toBe(false)
      expect(row.sampleNote).toContain('needs more data')
    }
    expect(JSON.parse(JSON.stringify(finalized))).toEqual(finalized)
  })
})

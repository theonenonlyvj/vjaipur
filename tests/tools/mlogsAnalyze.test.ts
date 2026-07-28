import { describe, it, expect } from 'vitest'
import {
  parseLogEntries,
  buildGames,
  joinOutcomes,
  attachOutcomes,
  computeCorpusStats,
  computeRecord,
  computeRoundEndTrigger,
  computeScoreTrajectoryPhases,
  decisivenessPct,
  resolveAccountId,
  mean,
  median,
  quantilesExclusive,
  GOOD_ORDER,
} from '../../tools/mlogs/analyze.mjs'

// ---------------------------------------------------------------------------
// Tiny inline fixture: 2 fake games for a single account ('acct1') against
// the 'ismcts' tier — one Vijay-style win, one loss — hand-computed expected
// values below each block. Mirrors the real match_logs/matches shapes (see
// src/store/aiGameLog.ts) closely enough to exercise the exact same code
// paths the real dump goes through (JSON-string `log`, wrangler --json
// envelope for `matches`).
// ---------------------------------------------------------------------------

function tok(overrides: Record<number, number[]>): number[][] {
  return GOOD_ORDER.map((_g, i) => overrides[i] ?? [1, 1, 1])
}

const gameALog = [
  {
    ply: 1,
    round: 1,
    actor: 'human',
    tier: 'ismcts',
    action: { type: 'SELL', good: 'spice', quantity: 2 },
    preState: { mkt: [], h0: [], h1: [], herd: [0, 3], deck: 10, tok: tok({ 4: [6, 4, 3] }), bonus: [1, 1, 1], score: [0, 0], seals: [0, 0] },
  },
  {
    ply: 2,
    round: 1,
    actor: 'ai',
    tier: 'ismcts',
    action: { type: 'SELL', good: 'spice', quantity: 1 },
    preState: { mkt: [], h0: [], h1: [], herd: [0, 3], deck: 10, tok: tok({ 4: [4, 3, 2] }), bonus: [1, 1, 1], score: [4, 0], seals: [0, 0] },
    candidates: [
      { action: 'SL:spice:1', visits: 100, q: 0.5 },
      { action: 'TC', visits: 40, q: 0.1 },
    ],
  },
  {
    ply: 3,
    round: 1,
    actor: 'human',
    tier: 'ismcts',
    action: { type: 'TAKE_CAMELS' },
    preState: { mkt: [], h0: [], h1: [], herd: [0, 3], deck: 9, tok: tok({}), bonus: [1, 1, 1], score: [4, 4], seals: [0, 0] },
  },
  {
    ply: 4,
    round: 1,
    actor: 'ai',
    tier: 'ismcts',
    action: { type: 'SELL', good: 'diamond', quantity: 2 },
    preState: { mkt: [], h0: [], h1: [], herd: [3, 3], deck: 9, tok: tok({ 0: [6, 4, 3] }), bonus: [1, 1, 1], score: [4, 4], seals: [0, 0] },
    candidates: [
      { action: 'SL:diamond:2', visits: 50, q: 0.2 },
      { action: 'TC', visits: 50, q: -0.1 },
    ],
  },
]

const gameBLog = [
  {
    ply: 1,
    round: 1,
    actor: 'human',
    tier: 'ismcts',
    action: { type: 'SELL', good: 'cloth', quantity: 1 },
    preState: { mkt: [], h0: [], h1: [], herd: [0, 0], deck: 20, tok: tok({ 3: [5, 4, 3] }), bonus: [1, 1, 1], score: [0, 0], seals: [0, 0] },
  },
  {
    ply: 2,
    round: 1,
    actor: 'ai',
    tier: 'ismcts',
    action: { type: 'SELL', good: 'cloth', quantity: 3 },
    preState: { mkt: [], h0: [], h1: [], herd: [0, 0], deck: 20, tok: tok({ 3: [4, 3, 2, 1] }), bonus: [1, 1, 1], score: [5, 0], seals: [0, 0] },
    candidates: [
      { action: 'SL:cloth:3', visits: 200, q: 0.3 },
      { action: 'TC', visits: 10, q: -0.2 },
    ],
  },
  {
    ply: 3,
    round: 1,
    actor: 'human',
    tier: 'ismcts',
    action: { type: 'TAKE_SINGLE', marketIndex: 0 },
    preState: { mkt: [], h0: [], h1: [], herd: [1, 2], deck: 19, tok: tok({}), bonus: [1, 1, 1], score: [5, 9], seals: [0, 0] },
  },
  {
    ply: 4,
    round: 1,
    actor: 'ai',
    tier: 'ismcts',
    action: { type: 'TAKE_CAMELS' },
    preState: { mkt: [], h0: [], h1: [], herd: [1, 2], deck: 18, tok: tok({}), bonus: [1, 1, 1], score: [5, 9], seals: [0, 0] },
    candidates: [
      { action: 'TC', visits: 80, q: 0.05 },
      { action: 'TS:0', visits: 79, q: 0.02 },
    ],
  },
]

const rawMatchLogRows = [
  { id: 1, account_id: 'acct1', timestamp: 1000, log: JSON.stringify(gameALog) },
  { id: 2, account_id: 'acct1', timestamp: 2000, log: JSON.stringify(gameBLog) },
]

// `matches` rows deliberately omit account_id/opponent_type on one row (like
// the real 2026-07-27 dump did) to exercise the timestamp-join backfill.
const rawMatchRows = [
  { timestamp: 1000, won: 1, player_score: 50, opponent_score: 30, account_id: 'acct1', opponent_type: 'ismcts' },
  { timestamp: 2000, won: 0, player_score: 20, opponent_score: 40 },
]

function buildFixtureGames() {
  const games = buildGames(rawMatchLogRows)
  const { matches } = joinOutcomes(games, rawMatchRows)
  return { games: attachOutcomes(games, matches), matches }
}

describe('parseLogEntries', () => {
  it('parses a JSON-string log', () => {
    expect(parseLogEntries(JSON.stringify(gameALog))).toEqual(gameALog)
  })
  it('passes through an already-parsed array', () => {
    expect(parseLogEntries(gameALog)).toBe(gameALog)
  })
  it('returns null (not throws) on malformed JSON', () => {
    expect(parseLogEntries('{not json')).toBeNull()
  })
  it('returns null for non-string non-array input', () => {
    expect(parseLogEntries(null)).toBeNull()
    expect(parseLogEntries(undefined)).toBeNull()
  })
})

describe('buildGames + joinOutcomes + attachOutcomes', () => {
  it('drops rows with unparseable logs instead of throwing', () => {
    const games = buildGames([...rawMatchLogRows, { id: 3, account_id: 'acct1', timestamp: 3000, log: 'not json' }])
    expect(games).toHaveLength(2)
  })

  it('derives tier from the log entries when opponent_type is absent from the row', () => {
    const games = buildGames(rawMatchLogRows)
    expect(games.every((g) => g.tier === 'ismcts')).toBe(true)
  })

  it('backfills matches.account_id/opponent_type via the timestamp join when the dump omits them', () => {
    const games = buildGames(rawMatchLogRows)
    const { matches, note } = joinOutcomes(games, rawMatchRows)
    const gameBMatch = matches.find((m) => m.timestamp === 2000)
    expect(gameBMatch?.accountId).toBe('acct1')
    expect(gameBMatch?.opponentType).toBe('ismcts')
    expect(note.backfilledFromLogJoin).toBe(1)
  })

  it('joins each game to its outcome by timestamp', () => {
    const { games } = buildFixtureGames()
    expect(games.find((g) => g.timestamp === 1000)?.outcome?.won).toBe(true)
    expect(games.find((g) => g.timestamp === 2000)?.outcome?.won).toBe(false)
  })
})

describe('computeRecord', () => {
  it('counts wins/losses from the matches table, scoped by account', () => {
    const { matches } = buildFixtureGames()
    expect(computeRecord(matches, { account: 'acct1' })).toEqual({ wins: 1, losses: 1, total: 2 })
  })

  it('returns zeros for an account with no matches', () => {
    const { matches } = buildFixtureGames()
    expect(computeRecord(matches, { account: 'nobody' })).toEqual({ wins: 0, losses: 0, total: 0 })
  })
})

describe('computeCorpusStats — sell-size distribution', () => {
  it('matches the hand-computed distribution for both sides', () => {
    const { games } = buildFixtureGames()
    const stats = computeCorpusStats(games)

    // human sold once at qty=2 (game A) and once at qty=1 (game B)
    expect(Object.fromEntries(stats.sellSizes.human)).toEqual({ 2: 1, 1: 1 })
    // ai sold at qty=1 (A), qty=2 (A), qty=3 (B)
    expect(Object.fromEntries(stats.sellSizes.ai)).toEqual({ 1: 1, 2: 1, 3: 1 })
  })
})

describe('computeCorpusStats — tokens-per-card efficiency', () => {
  it('averages got/quantity per SELL, matching analyze.py exactly (mean of per-sale ratios, not a global weighted average)', () => {
    const { games } = buildFixtureGames()
    const stats = computeCorpusStats(games)

    // human: spice qty2 -> (6+4)/2=5.0 ; cloth qty1 -> 5/1=5.0 => mean 5.0
    expect(mean(stats.tokensPerCard.human)).toBeCloseTo(5.0, 6)
    // ai: spice qty1 -> 4/1=4.0 ; diamond qty2 -> (6+4)/2=5.0 ; cloth qty3 -> (4+3+2)/3=3.0 => mean 4.0
    expect(mean(stats.tokensPerCard.ai)).toBeCloseTo(4.0, 6)
  })
})

describe('computeCorpusStats — action mix, camels, bonus/precious sells', () => {
  it('counts each actor’s action types', () => {
    const { games } = buildFixtureGames()
    const stats = computeCorpusStats(games)
    expect(Object.fromEntries(stats.actionMix.human)).toEqual({ SELL: 2, TAKE_CAMELS: 1, TAKE_SINGLE: 1 })
    expect(Object.fromEntries(stats.actionMix.ai)).toEqual({ SELL: 3, TAKE_CAMELS: 1 })
  })

  it('records TAKE_CAMELS herd-before per actor', () => {
    const { games } = buildFixtureGames()
    const stats = computeCorpusStats(games)
    expect(stats.takeCamelHerd.human).toEqual([0]) // game A human herd[0] at TAKE_CAMELS
    expect(stats.takeCamelHerd.ai).toEqual([2]) // game B ai herd[1] at TAKE_CAMELS
  })

  it('buckets bonus-eligible sells (qty>=3) by min(qty,5), and precious-good sells by quantity', () => {
    const { games } = buildFixtureGames()
    const stats = computeCorpusStats(games)
    // only ai's cloth qty=3 sale in game B qualifies as bonus-eligible (qty>=3)
    expect(Object.fromEntries(stats.bonusEarned.ai)).toEqual({ 3: 1 })
    expect(Object.fromEntries(stats.bonusEarned.human)).toEqual({})
    // precious goods = diamond/gold/silver; only ai's diamond qty=2 sale qualifies
    expect(Object.fromEntries(stats.preciousSells.ai)).toEqual({ 2: 1 })
    expect(Object.fromEntries(stats.preciousSells.human)).toEqual({})
  })
})

describe('computeCorpusStats — ISMCTS candidate signals (near-ties, decisiveness, q)', () => {
  it('flags near-ties at top1/top2 visit ratio < 1.15, over all ai moves with candidates', () => {
    const { games } = buildFixtureGames()
    const stats = computeCorpusStats(games)
    // ratios: A2 100/40=2.5 (no), A4 50/50=1.0 (tie), B2 200/10=20 (no), B4 80/79≈1.0127 (tie)
    expect(stats.nearTies).toBe(2)
    expect(stats.top1Visits).toHaveLength(4)
  })

  it('computes decisiveness thresholds over the same ratio population', () => {
    const { games } = buildFixtureGames()
    const stats = computeCorpusStats(games)
    const dec = decisivenessPct(stats.ratios, [2, 10])
    // >=2x: A2(2.5) and B2(20) qualify => 2/4 = 50%; >=10x: only B2 => 1/4 = 25%
    expect(dec[0]).toEqual({ t: 2, pct: 50 })
    expect(dec[1]).toEqual({ t: 10, pct: 25 })
  })

  it('splits root q by whether the BOT eventually won that game (inverse of the human outcome)', () => {
    const { games } = buildFixtureGames()
    const stats = computeCorpusStats(games)
    // game A: human won => bot lost => its ai q's (0.5, 0.2) go to qByResult.loss
    // game B: human lost => bot won => its ai q's (0.3, 0.05) go to qByResult.win
    expect(stats.qByResult.loss).toEqual([0.5, 0.2])
    expect(stats.qByResult.win).toEqual([0.3, 0.05])
  })
})

describe('computeRoundEndTrigger', () => {
  it('counts the actor of the final move of each game (both fixture games are single-round)', () => {
    const { games } = buildFixtureGames()
    const trig = computeRoundEndTrigger(games)
    // game A's last entry is ai (ply4); game B's last entry is ai (ply4)
    expect(trig.get('ai_final')).toBe(2)
    expect(trig.has('human_final')).toBe(false)
  })
})

describe('computeScoreTrajectoryPhases', () => {
  it('buckets human-minus-bot score by quartile of preState-bearing entries', () => {
    const { games } = buildFixtureGames()
    const gameA = games.find((g) => g.timestamp === 1000)!
    const buckets = computeScoreTrajectoryPhases([gameA])
    // 4 preState entries in game A => one per phase; score diffs: 0-0=0, 4-0=4, 4-4=0, 4-4=0
    expect(buckets[0]).toEqual([0])
    expect(buckets[1]).toEqual([4])
    expect(buckets[2]).toEqual([0])
    expect(buckets[3]).toEqual([0])
  })
})

describe('resolveAccountId', () => {
  const players = new Map([['acct1', 'theonenonlyvj']])

  it('returns the input unchanged when it is already a known account id', () => {
    expect(resolveAccountId('acct1', players)).toBe('acct1')
  })
  it('resolves a case-insensitive display_name match', () => {
    expect(resolveAccountId('TheOneNonlyVJ', players)).toBe('acct1')
  })
  it('resolves a case-insensitive substring match', () => {
    expect(resolveAccountId('nonlyvj', players)).toBe('acct1')
  })
  it('falls back to treating unknown input as a raw account id', () => {
    expect(resolveAccountId('some-other-id', players)).toBe('some-other-id')
  })
})

describe('stats helpers (ported from Python\'s statistics module)', () => {
  it('mean/median match plain arithmetic', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([1, 2, 3])).toBe(2)
  })

  it('quantilesExclusive(n=10) reproduces CPython statistics.quantiles(method="exclusive") p10/p90 on the real corpus scale', () => {
    // Same population size class as the real top1Visits corpus (n=1645) isn't
    // needed to prove correctness — a small hand-checkable set suffices:
    // data = 1..19, method='exclusive', n=10 gives deciles at the data values
    // themselves (m=20, i*m/10 lands exactly on an integer j for every i).
    const data = Array.from({ length: 19 }, (_, i) => i + 1) // 1..19
    const q = quantilesExclusive(data, 10)
    expect(q).toHaveLength(9)
    expect(q[0]).toBeCloseTo(2, 6) // p10
    expect(q[8]).toBeCloseTo(18, 6) // p90
  })
})

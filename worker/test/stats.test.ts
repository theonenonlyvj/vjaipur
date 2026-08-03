import { env, SELF } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  MIN_GAMES_FOR_RANK,
  getAvailableOpponentTypes,
  getHistory,
  getLeaderboard,
  getRollup,
  isValidOpponentTypeFilter,
  reportMatch,
} from '../src/do/stats'
import { applyD1Schema, acct, seedMatch, seedGame, seedSeat, seedPlayer } from './helpers'

const DB = () => (env as unknown as { DB: D1Database }).DB

beforeAll(async () => {
  await applyD1Schema(DB())
})

// =============================================================================
// getLeaderboard
// =============================================================================

describe('getLeaderboard', () => {
  it('keys rows by account_id, NEVER display_name: two accounts sharing a display name stay TWO rows', async () => {
    const a = acct('alice-twin')
    const b = acct('bob-twin')
    await seedPlayer(DB(), a, 'Same Name')
    await seedPlayer(DB(), b, 'Same Name')
    for (let i = 0; i < 3; i++) {
      await seedMatch(DB(), { accountId: a, playerScore: 100, opponentScore: 50, won: true, timestamp: Date.now() + i })
    }
    for (let i = 0; i < 3; i++) {
      await seedMatch(DB(), { accountId: b, playerScore: 40, opponentScore: 100, won: false, timestamp: Date.now() + 1000 + i })
    }

    const { overall } = await getLeaderboard(DB())
    const rowA = overall.find((r) => r.accountId === a)
    const rowB = overall.find((r) => r.accountId === b)
    expect(rowA).toBeTruthy()
    expect(rowB).toBeTruthy()
    expect(rowA).not.toBe(rowB)
    expect(rowA!.displayName).toBe('Same Name')
    expect(rowB!.displayName).toBe('Same Name')
    expect(rowA!.games).toBe(3)
    expect(rowA!.wins).toBe(3)
    expect(rowA!.winRate).toBe(1)
    expect(rowB!.games).toBe(3)
    expect(rowB!.wins).toBe(0)
    expect(rowB!.winRate).toBe(0)
  })

  it('splits overall (all sources) vs verified (online_authoritative only)', async () => {
    const a = acct('split-account')
    await seedPlayer(DB(), a, 'Splitter')
    await seedMatch(DB(), {
      accountId: a,
      playerScore: 100,
      opponentScore: 10,
      won: true,
      source: 'online_authoritative',
      opponentType: 'online',
      timestamp: Date.now(),
    })
    await seedMatch(DB(), {
      accountId: a,
      playerScore: 90,
      opponentScore: 80,
      won: true,
      source: 'client_reported',
      opponentType: 'medium',
      timestamp: Date.now() + 1,
    })

    const { overall, verified } = await getLeaderboard(DB())
    const overallRow = overall.find((r) => r.accountId === a)
    const verifiedRow = verified.find((r) => r.accountId === a)
    expect(overallRow?.games).toBe(2)
    expect(verifiedRow?.games).toBe(1) // only the online_authoritative row counts as verified
  })

  it(`applies the ${MIN_GAMES_FOR_RANK}-game qualification floor: a qualified lower-win-rate account outranks an unqualified higher-win-rate one`, async () => {
    const qualified = acct('qualified')
    const unqualified = acct('unqualified')
    await seedPlayer(DB(), qualified, 'Qualified')
    await seedPlayer(DB(), unqualified, 'Unqualified')

    // Qualified: MIN_GAMES_FOR_RANK games, only 1 win (low win rate).
    for (let i = 0; i < MIN_GAMES_FOR_RANK; i++) {
      await seedMatch(DB(), { accountId: qualified, playerScore: 50, opponentScore: 90, won: i === 0, timestamp: Date.now() + 2000 + i })
    }
    // Unqualified: fewer than the floor, but a perfect win rate.
    for (let i = 0; i < MIN_GAMES_FOR_RANK - 1; i++) {
      await seedMatch(DB(), { accountId: unqualified, playerScore: 100, opponentScore: 10, won: true, timestamp: Date.now() + 3000 + i })
    }

    const { overall } = await getLeaderboard(DB())
    const qIdx = overall.findIndex((r) => r.accountId === qualified)
    const uIdx = overall.findIndex((r) => r.accountId === unqualified)
    expect(qIdx).toBeGreaterThanOrEqual(0)
    expect(uIdx).toBeGreaterThanOrEqual(0)
    expect(qIdx).toBeLessThan(uIdx) // qualified-before-unqualified beats raw win rate
  })

  it('filters by opponentType: only that tier\'s matches are aggregated/ranked, and two same-name accounts stay separate', async () => {
    const a = acct('filter-alice-twin')
    const b = acct('filter-bob-twin')
    await seedPlayer(DB(), a, 'Filter Twin')
    await seedPlayer(DB(), b, 'Filter Twin')
    // a: 3 games vs 'medium', 2 vs 'online'.
    for (let i = 0; i < 3; i++) {
      await seedMatch(DB(), { accountId: a, opponentType: 'medium', source: 'client_reported', playerScore: 100, opponentScore: 50, won: true, timestamp: Date.now() + i })
    }
    for (let i = 0; i < 2; i++) {
      await seedMatch(DB(), { accountId: a, opponentType: 'online', playerScore: 10, opponentScore: 90, won: false, timestamp: Date.now() + 100 + i })
    }
    // b: 3 games vs 'medium' only, same display name as a.
    for (let i = 0; i < 3; i++) {
      await seedMatch(DB(), { accountId: b, opponentType: 'medium', source: 'client_reported', playerScore: 20, opponentScore: 80, won: false, timestamp: Date.now() + 200 + i })
    }

    const { overall } = await getLeaderboard(DB(), 'medium')
    const rowA = overall.find((r) => r.accountId === a)
    const rowB = overall.find((r) => r.accountId === b)
    expect(rowA).toBeTruthy()
    expect(rowB).toBeTruthy()
    expect(rowA).not.toBe(rowB) // still two distinct rows despite sharing a display name
    expect(rowA!.games).toBe(3) // the 2 'online' matches are excluded by the filter
    expect(rowB!.games).toBe(3)
  })

  it("a filter by an AI tier yields an empty 'verified' (online_authoritative rows are always opponent_type='online')", async () => {
    const a = acct('filter-verified-ai')
    await seedPlayer(DB(), a, 'AI Filter')
    for (let i = 0; i < 3; i++) {
      await seedMatch(DB(), { accountId: a, opponentType: 'easy', source: 'client_reported', playerScore: 60, opponentScore: 40, won: true, timestamp: Date.now() + 300 + i })
    }

    const { overall, verified } = await getLeaderboard(DB(), 'easy')
    expect(overall.find((r) => r.accountId === a)?.games).toBe(3)
    expect(verified.find((r) => r.accountId === a)).toBeUndefined()
  })

  it("a filter by 'online' makes 'verified' equal 'overall' (every online match is online_authoritative)", async () => {
    const a = acct('filter-verified-online')
    await seedPlayer(DB(), a, 'Online Filter')
    for (let i = 0; i < 3; i++) {
      await seedMatch(DB(), { accountId: a, opponentType: 'online', source: 'online_authoritative', playerScore: 70, opponentScore: 30, won: true, timestamp: Date.now() + 400 + i })
    }

    const { overall, verified } = await getLeaderboard(DB(), 'online')
    const overallRow = overall.find((r) => r.accountId === a)
    const verifiedRow = verified.find((r) => r.accountId === a)
    expect(overallRow?.games).toBe(3)
    expect(verifiedRow?.games).toBe(3)
  })

  it('a filtered response has no availableOpponents field (only the unfiltered call carries it)', async () => {
    const filtered = await getLeaderboard(DB(), 'online')
    expect(filtered.availableOpponents).toBeUndefined()

    const unfiltered = await getLeaderboard(DB())
    expect(Array.isArray(unfiltered.availableOpponents)).toBe(true)
  })

  it('an unrecognized opponentType (already-validated-away at the route layer) just yields empty rows, not an error', async () => {
    const { overall, verified } = await getLeaderboard(DB(), 'totally-not-a-real-type')
    expect(overall).toEqual([])
    expect(verified).toEqual([])
  })

  // ---------------------------------------------------------------------
  // Comma-list / family aggregation (StatsDashboard.tsx's "All Hard" drill-
  // down default: opponentType passed as a string[] instead of a string).
  // ---------------------------------------------------------------------

  it('aggregates matches across a LIST of opponentTypes: rows are the union of matches for every listed type, GROUP BY account_id', async () => {
    const a = acct('family-agg')
    await seedPlayer(DB(), a, 'Family Aggregator')
    for (let i = 0; i < 2; i++) {
      await seedMatch(DB(), { accountId: a, opponentType: 'hard2', source: 'client_reported', playerScore: 90, opponentScore: 40, won: true, timestamp: Date.now() + 700 + i })
    }
    for (let i = 0; i < 3; i++) {
      await seedMatch(DB(), { accountId: a, opponentType: 'ismcts', source: 'client_reported', playerScore: 80, opponentScore: 50, won: true, timestamp: Date.now() + 800 + i })
    }
    // A 'medium' match for the same account must NOT be swept into the
    // ['hard2','ismcts'] aggregate.
    await seedMatch(DB(), { accountId: a, opponentType: 'medium', source: 'client_reported', playerScore: 10, opponentScore: 90, won: false, timestamp: Date.now() + 900 })

    const { overall } = await getLeaderboard(DB(), ['hard2', 'ismcts'])
    const row = overall.find((r) => r.accountId === a)
    expect(row?.games).toBe(5) // 2 hard2 + 3 ismcts, the 1 medium match excluded
    expect(row?.wins).toBe(5)
  })

  it('aggregates across the full retired-inclusive "Hard family" list (hard2, ismcts, hard, fair)', async () => {
    const a = acct('family-agg-full')
    await seedMatch(DB(), { accountId: a, opponentType: 'hard2', source: 'client_reported', playerScore: 10, opponentScore: 5, won: true, timestamp: Date.now() + 1000 })
    await seedMatch(DB(), { accountId: a, opponentType: 'ismcts', source: 'client_reported', playerScore: 10, opponentScore: 5, won: true, timestamp: Date.now() + 1001 })
    await seedMatch(DB(), { accountId: a, opponentType: 'hard', source: 'client_reported', playerScore: 10, opponentScore: 5, won: false, timestamp: Date.now() + 1002 })
    await seedMatch(DB(), { accountId: a, opponentType: 'fair', source: 'client_reported', playerScore: 10, opponentScore: 5, won: false, timestamp: Date.now() + 1003 })

    const { overall } = await getLeaderboard(DB(), ['hard2', 'ismcts', 'hard', 'fair'])
    const row = overall.find((r) => r.accountId === a)
    expect(row?.games).toBe(4)
    expect(row?.wins).toBe(2)
  })

  it('a single-element list behaves identically to passing that id as a plain string', async () => {
    const a = acct('family-agg-single')
    for (let i = 0; i < 3; i++) {
      await seedMatch(DB(), { accountId: a, opponentType: 'medium', source: 'client_reported', playerScore: 60, opponentScore: 20, won: true, timestamp: Date.now() + 1100 + i })
    }

    const asString = await getLeaderboard(DB(), 'medium')
    const asList = await getLeaderboard(DB(), ['medium'])
    expect(asList.overall.find((r) => r.accountId === a)?.games).toBe(3)
    expect(asList.overall.find((r) => r.accountId === a)?.games).toBe(asString.overall.find((r) => r.accountId === a)?.games)
    expect(asList.availableOpponents).toBeUndefined() // still "filtered" shape, same as the string form
  })

  it('a LIST filter also has no availableOpponents field (same filtered-shape rule as a single id)', async () => {
    const filtered = await getLeaderboard(DB(), ['hard2', 'ismcts'])
    expect(filtered.availableOpponents).toBeUndefined()
  })
})

// =============================================================================
// getLeaderboard — GAMES-first (owner's 2026-07-28 ruling): a mixed fixture
// spanning all three resolution branches (online-exact-via-seals, vs-AI
// legacy-null-fallback, vs-AI explicit-split) in ONE account, plus a
// dedicated proof that RANKING itself now runs on games, not matches.
// =============================================================================

describe('getLeaderboard — GAMES-first per-row resolution (2026-07-28 ruling)', () => {
  it('resolves games_won/games_lost per-branch and sums them correctly across a mixed fixture, while the compat games/wins fields stay MATCH totals', async () => {
    const a = acct('games-mixed')
    const opponent = acct('games-mixed-opp')
    await seedPlayer(DB(), a, 'Mixed Fixture')

    // Branch 1: an ONLINE 3-game match, EXACT split via games.seals0/seals1 —
    // this account sits in seat 0 (2 seals) vs the opponent's seat 1 (1 seal).
    const gameUuid = `guuid-mixed-${a}`
    await seedGame(DB(), { gameUuid, seals0: 2, seals1: 1, winnerSeat: 0 })
    await seedSeat(DB(), gameUuid, 0, a)
    await seedSeat(DB(), gameUuid, 1, opponent)
    await seedMatch(DB(), {
      accountId: a, opponentType: 'online', opponentAccountId: opponent, source: 'online_authoritative',
      gameUuid, playerScore: 150, opponentScore: 90, won: true, timestamp: Date.now(),
    })

    // Branch 2: a LEGACY vs-AI row — no game_uuid, no stored split (both
    // NULL, exactly like every row that predates migration 0004) — falls
    // back to 1-0 by `won`.
    await seedMatch(DB(), {
      accountId: a, opponentType: 'medium', source: 'client_reported',
      playerScore: 80, opponentScore: 40, won: true, timestamp: Date.now() + 1,
    })

    // Branch 3: a NEW vs-AI row with an EXPLICIT 2-1 split (migration 0004).
    await seedMatch(DB(), {
      accountId: a, opponentType: 'hard2', source: 'client_reported',
      playerScore: 200, opponentScore: 140, won: true, timestamp: Date.now() + 2,
      gamesWon: 2, gamesLost: 1,
    })

    const { overall } = await getLeaderboard(DB())
    const row = overall.find((r) => r.accountId === a)
    expect(row).toBeTruthy()

    // Compat fields — MATCH totals, unchanged: 3 matches, all 3 won.
    expect(row!.games).toBe(3)
    expect(row!.wins).toBe(3)
    expect(row!.winRate).toBe(1)

    // GAMES totals — 2+1 (online, exact) + 1+0 (legacy, 1-0 fallback) + 2+1
    // (explicit) = 5 won, 2 lost.
    expect(row!.gamesWon).toBe(5)
    expect(row!.gamesLost).toBe(2)
  })

  it('ranking runs on GAMES, not matches: a single swept 3-game online match outranks three separate 1-game losses', async () => {
    // Sweeper: ONE match, but it's a 3-game online sweep (3 games won, 0
    // lost) — under the OLD matches-based ranking this account would have
    // only 1 "game" and sit UNQUALIFIED below the MIN_GAMES_FOR_RANK floor;
    // under the new games-based ranking it has 3 GAMES at a perfect win rate.
    const sweeper = acct('games-rank-sweeper')
    const sweeperOpp = acct('games-rank-sweeper-opp')
    const sweepUuid = `guuid-sweep-${sweeper}`
    await seedGame(DB(), { gameUuid: sweepUuid, seals0: 3, seals1: 0, winnerSeat: 0 })
    await seedSeat(DB(), sweepUuid, 0, sweeper)
    await seedSeat(DB(), sweepUuid, 1, sweeperOpp)
    await seedMatch(DB(), {
      accountId: sweeper, opponentType: 'online', opponentAccountId: sweeperOpp, source: 'online_authoritative',
      gameUuid: sweepUuid, playerScore: 210, opponentScore: 100, won: true, timestamp: Date.now() + 10,
    })

    // Grinder: 3 SEPARATE 1-game matches (matchLength 1, game==match), 1 win
    // / 2 losses — 3 games at a losing win rate, definitely qualified either
    // way (matches count == games count here).
    const grinder = acct('games-rank-grinder')
    for (let i = 0; i < 3; i++) {
      await seedMatch(DB(), {
        accountId: grinder, opponentType: 'medium', source: 'client_reported',
        playerScore: i === 0 ? 60 : 20, opponentScore: i === 0 ? 40 : 80, won: i === 0, timestamp: Date.now() + 20 + i,
      })
    }

    const { overall } = await getLeaderboard(DB())
    const sweeperIdx = overall.findIndex((r) => r.accountId === sweeper)
    const grinderIdx = overall.findIndex((r) => r.accountId === grinder)
    expect(sweeperIdx).toBeGreaterThanOrEqual(0)
    expect(grinderIdx).toBeGreaterThanOrEqual(0)

    const sweeperRow = overall[sweeperIdx]!
    const grinderRow = overall[grinderIdx]!
    // The compat `games` field (MATCH count) would have put the sweeper
    // (1 match) below the MIN_GAMES_FOR_RANK floor and the grinder (3
    // matches) above it — proof this isn't just "both happen to qualify
    // either way".
    expect(sweeperRow.games).toBe(1)
    expect(sweeperRow.games).toBeLessThan(MIN_GAMES_FOR_RANK)
    expect(grinderRow.games).toBeGreaterThanOrEqual(MIN_GAMES_FOR_RANK)
    // But by GAMES, the sweeper qualifies (3 games) at a perfect win rate —
    // and ranks ABOVE the grinder.
    expect(sweeperRow.gamesWon).toBe(3)
    expect(sweeperRow.gamesLost).toBe(0)
    expect(sweeperIdx).toBeLessThan(grinderIdx)
  })
})

// =============================================================================
// getAvailableOpponentTypes / isValidOpponentTypeFilter
// =============================================================================

describe('getAvailableOpponentTypes', () => {
  it('lists DISTINCT opponent_types with at least one match, and nothing else', async () => {
    const a = acct('avail-types')
    await seedMatch(DB(), { accountId: a, opponentType: 'hard3', source: 'client_reported', playerScore: 5, opponentScore: 1, won: true, timestamp: Date.now() + 500 })

    const types = await getAvailableOpponentTypes(DB())
    expect(types).toContain('hard3') // present: this test just seeded one
    expect(new Set(types).size).toBe(types.length) // DISTINCT, no duplicates
  })
})

describe('isValidOpponentTypeFilter', () => {
  it("accepts 'online' and any known tier id (active or retired)", () => {
    expect(isValidOpponentTypeFilter('online')).toBe(true)
    expect(isValidOpponentTypeFilter('easy')).toBe(true)
    expect(isValidOpponentTypeFilter('medium')).toBe(true)
    expect(isValidOpponentTypeFilter('hard2')).toBe(true)
    expect(isValidOpponentTypeFilter('hard3')).toBe(true)
    expect(isValidOpponentTypeFilter('hard')).toBe(true) // retired, still valid
    expect(isValidOpponentTypeFilter('fair')).toBe(true) // retired, still valid
  })

  it('rejects garbage', () => {
    expect(isValidOpponentTypeFilter('nonsense')).toBe(false)
    expect(isValidOpponentTypeFilter('')).toBe(false)
    expect(isValidOpponentTypeFilter('Online')).toBe(false) // case-sensitive
  })
})

// =============================================================================
// GET /stats/leaderboard (router — query param validation + wiring)
// =============================================================================

describe('GET /stats/leaderboard router', () => {
  it('with no ?opponentType= behaves as before and includes availableOpponents', async () => {
    const res = await SELF.fetch(new Request('https://worker/stats/leaderboard'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { overall: unknown[]; verified: unknown[]; availableOpponents: string[] }
    expect(Array.isArray(body.overall)).toBe(true)
    expect(Array.isArray(body.verified)).toBe(true)
    expect(Array.isArray(body.availableOpponents)).toBe(true)
  })

  it('with a valid ?opponentType= filters through to getLeaderboard', async () => {
    const a = acct('router-filter')
    await seedPlayer(DB(), a, 'Router Filter')
    for (let i = 0; i < 3; i++) {
      await seedMatch(DB(), { accountId: a, opponentType: 'medium', source: 'client_reported', playerScore: 1, opponentScore: 0, won: true, timestamp: Date.now() + 600 + i })
    }

    const res = await SELF.fetch(new Request('https://worker/stats/leaderboard?opponentType=medium'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { overall: { accountId: string; games: number }[] }
    expect(body.overall.find((r) => r.accountId === a)?.games).toBe(3)
  })

  it('with a garbage ?opponentType= returns 400 invalid_opponent_type', async () => {
    const res = await SELF.fetch(new Request('https://worker/stats/leaderboard?opponentType=not-a-real-tier'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_opponent_type' })
  })

  it('with a comma-separated ?opponentType= list, aggregates matches across every listed type', async () => {
    const a = acct('router-family')
    await seedMatch(DB(), { accountId: a, opponentType: 'hard2', source: 'client_reported', playerScore: 1, opponentScore: 0, won: true, timestamp: Date.now() + 1200 })
    await seedMatch(DB(), { accountId: a, opponentType: 'ismcts', source: 'client_reported', playerScore: 1, opponentScore: 0, won: true, timestamp: Date.now() + 1201 })
    await seedMatch(DB(), { accountId: a, opponentType: 'hard', source: 'client_reported', playerScore: 1, opponentScore: 0, won: true, timestamp: Date.now() + 1202 })
    await seedMatch(DB(), { accountId: a, opponentType: 'fair', source: 'client_reported', playerScore: 1, opponentScore: 0, won: true, timestamp: Date.now() + 1203 })

    const res = await SELF.fetch(new Request('https://worker/stats/leaderboard?opponentType=hard2,ismcts,hard,fair'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { overall: { accountId: string; games: number }[]; availableOpponents?: string[] }
    expect(body.overall.find((r) => r.accountId === a)?.games).toBe(4)
    expect(body.availableOpponents).toBeUndefined() // still filtered shape, same as a single id
  })

  it('a single id passed with no comma behaves exactly as before (single-id path unchanged)', async () => {
    const a = acct('router-single-unchanged')
    for (let i = 0; i < 2; i++) {
      await seedMatch(DB(), { accountId: a, opponentType: 'easy', source: 'client_reported', playerScore: 1, opponentScore: 0, won: true, timestamp: Date.now() + 1300 + i })
    }

    const res = await SELF.fetch(new Request('https://worker/stats/leaderboard?opponentType=easy'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { overall: { accountId: string; games: number }[] }
    expect(body.overall.find((r) => r.accountId === a)?.games).toBe(2)
  })

  it('an invalid id ANYWHERE in a comma list 400s the whole request (no partial/silent-drop)', async () => {
    const res = await SELF.fetch(new Request('https://worker/stats/leaderboard?opponentType=medium,not-a-real-tier'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_opponent_type' })
  })

  it('an invalid id at the START of an otherwise-valid comma list still 400s', async () => {
    const res = await SELF.fetch(new Request('https://worker/stats/leaderboard?opponentType=not-a-real-tier,hard2,ismcts'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_opponent_type' })
  })
})

// =============================================================================
// getHistory
// =============================================================================

describe('getHistory', () => {
  it("returns the account's own matches, newest first", async () => {
    const a = acct('history-account')
    const t0 = Date.now()
    await seedMatch(DB(), { accountId: a, playerScore: 10, opponentScore: 20, won: false, timestamp: t0 })
    await seedMatch(DB(), { accountId: a, playerScore: 30, opponentScore: 20, won: true, timestamp: t0 + 10 })
    await seedMatch(DB(), { accountId: a, playerScore: 50, opponentScore: 10, won: true, timestamp: t0 + 20 })

    const rows = await getHistory(DB(), a)
    expect(rows.length).toBe(3)
    expect(rows.map((r) => r.timestamp)).toEqual([t0 + 20, t0 + 10, t0]) // newest first
    expect(rows.every((r) => r.opponentType === 'online')).toBe(true)
  })

  it('never returns another account\'s matches', async () => {
    const a = acct('history-mine')
    const other = acct('history-theirs')
    await seedMatch(DB(), { accountId: a, playerScore: 1, opponentScore: 2, won: false, timestamp: Date.now() })
    await seedMatch(DB(), { accountId: other, playerScore: 3, opponentScore: 4, won: false, timestamp: Date.now() })

    const rows = await getHistory(DB(), a)
    expect(rows.every((r) => r.playerScore !== 3)).toBe(true) // the other account's row never leaks in
  })

  // BUG 3 fix (2026-07-27): "Online Rivals" was showing the rival's raw
  // account UUID because getHistory never resolved a name for
  // opponent_account_id at all — StatsDashboard.tsx had nothing else to
  // render. getHistory now LEFT JOINs `players` on opponent_account_id.
  it('resolves the opponent\'s display name via a players LEFT JOIN on opponent_account_id', async () => {
    const a = acct('history-with-rival')
    const rival = acct('history-rival')
    await seedPlayer(DB(), rival, 'Sureka')
    await seedMatch(DB(), { accountId: a, opponentAccountId: rival, playerScore: 40, opponentScore: 33, won: true, timestamp: Date.now() })

    const rows = await getHistory(DB(), a)
    expect(rows.length).toBe(1)
    expect(rows[0]!.opponentAccountId).toBe(rival)
    expect(rows[0]!.opponentName).toBe('Sureka')
  })

  it('opponentName is null (never the raw UUID) when the opponent has no players row yet', async () => {
    const a = acct('history-unresolved-rival')
    const neverSeenRival = acct('history-never-seen-rival')
    await seedMatch(DB(), { accountId: a, opponentAccountId: neverSeenRival, playerScore: 10, opponentScore: 5, won: true, timestamp: Date.now() })

    const rows = await getHistory(DB(), a)
    expect(rows[0]!.opponentAccountId).toBe(neverSeenRival) // still returned — LEFT, not INNER, join
    expect(rows[0]!.opponentName).toBeNull()
  })

  it('opponentName is null for a local vs-AI report (no opponent_account_id at all)', async () => {
    const a = acct('history-vs-ai')
    await seedMatch(DB(), { accountId: a, opponentType: 'medium', opponentAccountId: null, source: 'client_reported', playerScore: 100, opponentScore: 80, won: true, timestamp: Date.now() })

    const rows = await getHistory(DB(), a)
    expect(rows[0]!.opponentAccountId).toBeNull()
    expect(rows[0]!.opponentName).toBeNull()
  })

  it('two different rivals resolve to their own distinct names, not the caller\'s own display_name or each other\'s', async () => {
    const a = acct('history-two-rivals')
    const rival1 = acct('history-rival-1')
    const rival2 = acct('history-rival-2')
    await seedPlayer(DB(), a, 'MyOwnName') // never leaks into an opponentName column
    await seedPlayer(DB(), rival1, 'Alice')
    await seedPlayer(DB(), rival2, 'Bob')
    await seedMatch(DB(), { accountId: a, opponentAccountId: rival1, playerScore: 10, opponentScore: 5, won: true, timestamp: Date.now() })
    await seedMatch(DB(), { accountId: a, opponentAccountId: rival2, playerScore: 5, opponentScore: 10, won: false, timestamp: Date.now() + 1 })

    const rows = await getHistory(DB(), a)
    const byOpponent = new Map(rows.map((r) => [r.opponentAccountId, r.opponentName]))
    expect(byOpponent.get(rival1)).toBe('Alice')
    expect(byOpponent.get(rival2)).toBe('Bob')
  })

  // ---------------------------------------------------------------------
  // gamesWon/gamesLost — per-row GAMES split (owner's 2026-07-28 ruling).
  // Same three resolution branches as getLeaderboard's mixed fixture above,
  // but asserted per-row here (getHistory never aggregates).
  // ---------------------------------------------------------------------

  it('resolves an EXACT gamesWon/gamesLost for an online match from games.seals0/seals1 via the caller\'s own seat', async () => {
    const a = acct('history-games-online')
    const opponent = acct('history-games-online-opp')
    const gameUuid = `guuid-hist-online-${a}`
    // Caller sits in seat 1 this time (seat mapping is per-match, never a
    // constant) — seals1 is "mine", seals0 is "theirs".
    await seedGame(DB(), { gameUuid, seals0: 1, seals1: 2, winnerSeat: 0 })
    await seedSeat(DB(), gameUuid, 0, opponent)
    await seedSeat(DB(), gameUuid, 1, a)
    await seedMatch(DB(), {
      accountId: a, opponentType: 'online', opponentAccountId: opponent, source: 'online_authoritative',
      gameUuid, playerScore: 130, opponentScore: 90, won: true, timestamp: Date.now(),
    })

    const rows = await getHistory(DB(), a)
    expect(rows[0]!.gamesWon).toBe(2) // seat 1's own seals
    expect(rows[0]!.gamesLost).toBe(1) // seat 0's seals
  })

  it('falls back to a 1-0/0-1 approximation by `won` for a LEGACY vs-AI row with no stored split', async () => {
    const a = acct('history-games-legacy')
    await seedMatch(DB(), { accountId: a, opponentType: 'easy', source: 'client_reported', playerScore: 20, opponentScore: 45, won: false, timestamp: Date.now() })

    const rows = await getHistory(DB(), a)
    expect(rows[0]!.gamesWon).toBe(0)
    expect(rows[0]!.gamesLost).toBe(1)
  })

  it('resolves the EXACT stored split for a vs-AI row reported with an explicit games_won/games_lost (migration 0004)', async () => {
    const a = acct('history-games-explicit')
    await seedMatch(DB(), {
      accountId: a, opponentType: 'hard3', source: 'client_reported',
      playerScore: 300, opponentScore: 210, won: true, timestamp: Date.now(),
      gamesWon: 3, gamesLost: 2,
    })

    const rows = await getHistory(DB(), a)
    expect(rows[0]!.gamesWon).toBe(3)
    expect(rows[0]!.gamesLost).toBe(2)
  })
})

// =============================================================================
// reportMatch
// =============================================================================

describe('reportMatch', () => {
  it('accepts a valid local vs-AI report (a real tier id, in-range integer scores)', async () => {
    const a = acct('report-valid')
    const result = await reportMatch(DB(), a, {
      opponent_type: 'medium',
      player_score: 120,
      opponent_score: 80,
      won: true,
      timestamp: Date.now(),
    })
    expect(result).toEqual({ ok: true })

    const rows = await getHistory(DB(), a)
    expect(rows.length).toBe(1)
    expect(rows[0]!.source).toBe('client_reported')
    expect(rows[0]!.opponentType).toBe('medium')
  })

  it('rejects an opponent_type that is not a tier id (incl. "online" — that is not a local-vs-AI report) with 400-shaped error', async () => {
    const a = acct('report-bad-tier')
    expect(await reportMatch(DB(), a, { opponent_type: 'online', player_score: 10, opponent_score: 5, won: true, timestamp: Date.now() })).toEqual({
      error: 'invalid_opponent_type',
    })
    expect(
      await reportMatch(DB(), a, { opponent_type: 'nonsense-tier', player_score: 10, opponent_score: 5, won: true, timestamp: Date.now() }),
    ).toEqual({ error: 'invalid_opponent_type' })
  })

  it('accepts a RETIRED tier id (still a historically valid opponent_type)', async () => {
    const a = acct('report-retired-tier')
    const result = await reportMatch(DB(), a, { opponent_type: 'hard', player_score: 10, opponent_score: 5, won: true, timestamp: Date.now() })
    expect(result).toEqual({ ok: true })
  })

  it('rejects an out-of-range or non-integer score', async () => {
    const a = acct('report-bad-score')
    const now = Date.now()
    expect(await reportMatch(DB(), a, { opponent_type: 'easy', player_score: -1, opponent_score: 5, won: true, timestamp: now })).toEqual({
      error: 'invalid_player_score',
    })
    expect(await reportMatch(DB(), a, { opponent_type: 'easy', player_score: 501, opponent_score: 5, won: true, timestamp: now })).toEqual({
      error: 'invalid_player_score',
    })
    expect(await reportMatch(DB(), a, { opponent_type: 'easy', player_score: 10.5, opponent_score: 5, won: true, timestamp: now })).toEqual({
      error: 'invalid_player_score',
    })
    expect(await reportMatch(DB(), a, { opponent_type: 'easy', player_score: 10, opponent_score: 999, won: true, timestamp: now })).toEqual({
      error: 'invalid_opponent_score',
    })
  })

  it('rejects a missing/invalid `won` or an insane timestamp', async () => {
    const a = acct('report-bad-misc')
    const now = Date.now()
    expect(await reportMatch(DB(), a, { opponent_type: 'easy', player_score: 10, opponent_score: 5, timestamp: now })).toEqual({
      error: 'invalid_won',
    })
    expect(
      await reportMatch(DB(), a, { opponent_type: 'easy', player_score: 10, opponent_score: 5, won: true, timestamp: 1 }),
    ).toEqual({ error: 'invalid_timestamp' })
    expect(
      await reportMatch(DB(), a, {
        opponent_type: 'easy',
        player_score: 10,
        opponent_score: 5,
        won: true,
        timestamp: now + 365 * 24 * 60 * 60 * 1000,
      }),
    ).toEqual({ error: 'invalid_timestamp' })
  })

  it('dedups a retried report (same account/timestamp/opponent_type) via ON CONFLICT DO NOTHING', async () => {
    const a = acct('report-dedup')
    const ts = Date.now()
    const first = await reportMatch(DB(), a, { opponent_type: 'fair', player_score: 200, opponent_score: 150, won: true, timestamp: ts })
    expect(first).toEqual({ ok: true })

    const retry = await reportMatch(DB(), a, { opponent_type: 'fair', player_score: 200, opponent_score: 150, won: true, timestamp: ts })
    expect(retry).toEqual({ ok: true, duplicate: true })

    const rows = await getHistory(DB(), a)
    expect(rows.length).toBe(1) // the duplicate never landed a 2nd row
  })

  // ---------------------------------------------------------------------
  // games_won/games_lost persistence (migration 0004 — owner's 2026-07-28
  // GAMES-first ruling). src/store/gameStore.ts's vs-ai nextRound sends the
  // match's own final `seals` here.
  // ---------------------------------------------------------------------

  describe('games_won/games_lost (migration 0004)', () => {
    it('persists a valid explicit split, readable back via getHistory', async () => {
      const a = acct('report-games-split')
      const result = await reportMatch(DB(), a, {
        opponent_type: 'medium', player_score: 90, opponent_score: 60, won: true, timestamp: Date.now(),
        games_won: 2, games_lost: 1,
      })
      expect(result).toEqual({ ok: true })

      const rows = await getHistory(DB(), a)
      expect(rows[0]!.gamesWon).toBe(2)
      expect(rows[0]!.gamesLost).toBe(1)

      const raw = await DB().prepare(`SELECT games_won, games_lost FROM matches WHERE account_id = ?`).bind(a).first<{ games_won: number; games_lost: number }>()
      expect(raw).toEqual({ games_won: 2, games_lost: 1 }) // stored on the actual columns, not just resolved at read time
    })

    it('omitting the split entirely stores NULL on both columns — the report still succeeds, and getHistory falls back to the 1-0/0-1-by-won approximation', async () => {
      const a = acct('report-games-omitted')
      const result = await reportMatch(DB(), a, { opponent_type: 'easy', player_score: 10, opponent_score: 5, won: true, timestamp: Date.now() })
      expect(result).toEqual({ ok: true })

      const raw = await DB().prepare(`SELECT games_won, games_lost FROM matches WHERE account_id = ?`).bind(a).first<{ games_won: number | null; games_lost: number | null }>()
      expect(raw).toEqual({ games_won: null, games_lost: null })

      const rows = await getHistory(DB(), a)
      expect(rows[0]!.gamesWon).toBe(1) // fallback: 1-0 by won
      expect(rows[0]!.gamesLost).toBe(0)
    })

    it('an out-of-range games_won/games_lost (e.g. negative, non-integer, >5) is skipped — the report still succeeds, both columns stay NULL', async () => {
      const a = acct('report-games-insane')
      const result = await reportMatch(DB(), a, {
        opponent_type: 'easy', player_score: 10, opponent_score: 5, won: false, timestamp: Date.now(),
        games_won: -1, games_lost: 1,
      })
      expect(result).toEqual({ ok: true }) // never fails the report over a bad split

      const raw = await DB().prepare(`SELECT games_won, games_lost FROM matches WHERE account_id = ?`).bind(a).first<{ games_won: number | null; games_lost: number | null }>()
      expect(raw).toEqual({ games_won: null, games_lost: null })
    })

    it('providing only ONE of games_won/games_lost stores NULL on BOTH — never a half-written split', async () => {
      const a = acct('report-games-half')
      const result = await reportMatch(DB(), a, {
        opponent_type: 'easy', player_score: 10, opponent_score: 5, won: true, timestamp: Date.now(),
        games_won: 2, // games_lost omitted
      })
      expect(result).toEqual({ ok: true })

      const raw = await DB().prepare(`SELECT games_won, games_lost FROM matches WHERE account_id = ?`).bind(a).first<{ games_won: number | null; games_lost: number | null }>()
      expect(raw).toEqual({ games_won: null, games_lost: null })
    })
  })
})

// =============================================================================
// migration 0004 — games_won/games_lost columns present on `matches`
// =============================================================================

describe('migration 0004 (games_won/games_lost columns)', () => {
  it('the `matches` table has both new nullable columns', async () => {
    const { results } = await DB().prepare(`PRAGMA table_info(matches)`).all<{ name: string }>()
    const columnNames = results.map((r) => r.name)
    expect(columnNames).toContain('games_won')
    expect(columnNames).toContain('games_lost')
  })
})

// =============================================================================
// reportMatch — match_logs (per-move game logging, migration 0002)
// =============================================================================
//
// Per-move play-by-play for AI-tuning (src/store/aiGameLog.ts client-side).
// No read endpoint exists (tuning reads D1 directly) — these tests query
// `match_logs` straight off the D1 binding, mirroring how a tuning script
// would.

type MatchLogRow = { id: number; account_id: string; opponent_type: string; timestamp: number; log: string; created_at: number }

async function getMatchLogs(accountId: string): Promise<MatchLogRow[]> {
  const { results } = await DB()
    .prepare(`SELECT id, account_id, opponent_type, timestamp, log, created_at FROM match_logs WHERE account_id = ?`)
    .bind(accountId)
    .all<MatchLogRow>()
  return results
}

describe('reportMatch — match_logs', () => {
  it('stores a valid log row keyed to account+opponent_type on a fresh (non-duplicate) report', async () => {
    const a = acct('mlog-valid')
    const ts = Date.now()
    const log = JSON.stringify([{ ply: 1, round: 1, actor: 'human', tier: 'medium', action: { type: 'TAKE_CAMELS' } }])

    const result = await reportMatch(DB(), a, { opponent_type: 'medium', player_score: 90, opponent_score: 40, won: true, timestamp: ts, log })
    expect(result).toEqual({ ok: true })

    const rows = await getMatchLogs(a)
    expect(rows).toHaveLength(1)
    expect(rows[0].opponent_type).toBe('medium')
    expect(rows[0].timestamp).toBe(ts)
    expect(rows[0].log).toBe(log)
    expect(JSON.parse(rows[0].log)).toEqual(JSON.parse(log))
  })

  it('omitting `log` entirely records the match with no log row, and does not error', async () => {
    const a = acct('mlog-absent')
    const result = await reportMatch(DB(), a, { opponent_type: 'easy', player_score: 10, opponent_score: 5, won: true, timestamp: Date.now() })
    expect(result).toEqual({ ok: true })
    expect(await getMatchLogs(a)).toHaveLength(0)
  })

  it('an oversized log (>300KB) is skipped — the match still records, no log row is written', async () => {
    const a = acct('mlog-oversized')
    const hugeLog = JSON.stringify(Array.from({ length: 20_000 }, (_, i) => ({ ply: i, action: { type: 'TAKE_CAMELS' } })))
    expect(hugeLog.length).toBeGreaterThan(300_000) // sanity: this really is over budget

    const result = await reportMatch(DB(), a, { opponent_type: 'easy', player_score: 10, opponent_score: 5, won: true, timestamp: Date.now(), log: hugeLog })
    expect(result).toEqual({ ok: true }) // the report itself never fails over a bad log
    expect(await getMatchLogs(a)).toHaveLength(0)
  })

  it('a garbage (unparseable) log is skipped — the match still records, no log row', async () => {
    const a = acct('mlog-garbage')
    const result = await reportMatch(DB(), a, {
      opponent_type: 'easy', player_score: 10, opponent_score: 5, won: true, timestamp: Date.now(),
      log: '{not valid json',
    })
    expect(result).toEqual({ ok: true })
    expect(await getMatchLogs(a)).toHaveLength(0)
  })

  it('a log that IS valid JSON but not an array is skipped — the match still records, no log row', async () => {
    const a = acct('mlog-not-array')
    const result = await reportMatch(DB(), a, {
      opponent_type: 'easy', player_score: 10, opponent_score: 5, won: true, timestamp: Date.now(),
      log: JSON.stringify({ not: 'an array' }),
    })
    expect(result).toEqual({ ok: true })
    expect(await getMatchLogs(a)).toHaveLength(0)
  })

  it('a non-string `log` (wrong type) is skipped — the match still records, no log row', async () => {
    const a = acct('mlog-wrong-type')
    const result = await reportMatch(DB(), a, {
      opponent_type: 'easy', player_score: 10, opponent_score: 5, won: true, timestamp: Date.now(),
      log: [{ ply: 1 }] as unknown, // an actual array, not its JSON-string encoding
    })
    expect(result).toEqual({ ok: true })
    expect(await getMatchLogs(a)).toHaveLength(0)
  })

  it('a duplicate match report never inserts a duplicate log row', async () => {
    const a = acct('mlog-dedup')
    const ts = Date.now()
    const log = JSON.stringify([{ ply: 1, action: { type: 'TAKE_CAMELS' } }])

    const first = await reportMatch(DB(), a, { opponent_type: 'hard3', player_score: 100, opponent_score: 80, won: true, timestamp: ts, log })
    expect(first).toEqual({ ok: true })
    expect(await getMatchLogs(a)).toHaveLength(1)

    // Retried POST — same account/timestamp/opponent_type, so the `matches`
    // insert is a dedup no-op; the log insert must be skipped right along
    // with it (never a 2nd log row for the same match).
    const retryLog = JSON.stringify([{ ply: 1 }, { ply: 2 }])
    const retry = await reportMatch(DB(), a, { opponent_type: 'hard3', player_score: 100, opponent_score: 80, won: true, timestamp: ts, log: retryLog })
    expect(retry).toEqual({ ok: true, duplicate: true })

    const rows = await getMatchLogs(a)
    expect(rows).toHaveLength(1) // still just the one, from the first (real) report
    expect(JSON.parse(rows[0].log)).toEqual(JSON.parse(log)) // untouched by the retry's log
  })

  it('invalid report fields (rejected before any insert) never write a log row either', async () => {
    const a = acct('mlog-invalid-report')
    const log = JSON.stringify([{ ply: 1 }])
    const result = await reportMatch(DB(), a, { opponent_type: 'not-a-tier', player_score: 10, opponent_score: 5, won: true, timestamp: Date.now(), log })
    expect(result).toEqual({ error: 'invalid_opponent_type' })
    expect(await getMatchLogs(a)).toHaveLength(0)
  })
})

// =============================================================================
// reportMatch — players.last_seen_at stamp
// =============================================================================
//
// `players.last_seen_at` used to be write-once (the migration seed value) —
// nothing ever updated it after a vs-AI report, so it never reflected real
// activity for a local-only player (their only server touch is match-end).
// These tests pin down: (1) a report stamps it close to "now" even with no
// prior `players` row, (2) a SUBSEQUENT report UPDATES an existing (possibly
// stale) value rather than leaving it untouched, and (3) doing so NEVER
// clobbers an already-set `display_name` to a placeholder — `reportMatch`
// only ever has `accountId` in hand, never a display name, so the UPSERT must
// leave `display_name` alone on conflict.

async function seedStalePlayer(accountId: string, displayName: string, lastSeenAt: number): Promise<void> {
  await DB().prepare(`INSERT INTO players (account_id, display_name, last_seen_at) VALUES (?, ?, ?)`).bind(accountId, displayName, lastSeenAt).run()
}

describe('reportMatch — players.last_seen_at stamp', () => {
  it('stamps players.last_seen_at close to now after a report (fresh account, no prior players row)', async () => {
    const a = acct('report-last-seen-fresh')
    const before = Date.now()

    const result = await reportMatch(DB(), a, { opponent_type: 'medium', player_score: 10, opponent_score: 5, won: true, timestamp: Date.now() })
    expect(result).toEqual({ ok: true })

    const row = await DB().prepare(`SELECT last_seen_at FROM players WHERE account_id = ?`).bind(a).first<{ last_seen_at: number }>()
    expect(row).toBeTruthy()
    expect(Number(row!.last_seen_at)).toBeGreaterThanOrEqual(before)
    expect(Number(row!.last_seen_at)).toBeLessThanOrEqual(Date.now())
  })

  it('a report UPDATES an existing (stale) last_seen_at — not just an insert-once', async () => {
    const a = acct('report-last-seen-update')
    const stale = Date.now() - 10_000_000
    await seedStalePlayer(a, 'Stale Name', stale)

    const before = Date.now()
    await reportMatch(DB(), a, { opponent_type: 'easy', player_score: 5, opponent_score: 1, won: true, timestamp: Date.now() })

    const row = await DB().prepare(`SELECT last_seen_at FROM players WHERE account_id = ?`).bind(a).first<{ last_seen_at: number }>()
    expect(Number(row!.last_seen_at)).toBeGreaterThan(stale)
    expect(Number(row!.last_seen_at)).toBeGreaterThanOrEqual(before)
  })

  it('does NOT clobber display_name to a placeholder when last_seen_at updates for an already-named account', async () => {
    const a = acct('report-preserve-name')
    const stale = Date.now() - 10_000_000
    await seedStalePlayer(a, 'Real Name', stale)

    await reportMatch(DB(), a, { opponent_type: 'easy', player_score: 5, opponent_score: 1, won: true, timestamp: Date.now() })

    const row = await DB().prepare(`SELECT display_name, last_seen_at FROM players WHERE account_id = ?`).bind(a).first<{ display_name: string; last_seen_at: number }>()
    expect(row?.display_name).toBe('Real Name') // never clobbered to 'Player' or NULL
    expect(Number(row!.last_seen_at)).toBeGreaterThan(stale) // but last_seen_at DID update
  })
})

// =============================================================================
// getRollup — STATS-FEDERATION v0 contract
// =============================================================================

describe('getRollup', () => {
  it('a known account returns real totals with epoch-ms lastPlayedAt', async () => {
    const a = acct('rollup-known')
    await seedPlayer(DB(), a, 'Rolly')
    const t0 = Date.now()
    await seedMatch(DB(), { accountId: a, playerScore: 10, opponentScore: 20, won: false, timestamp: t0 })
    await seedMatch(DB(), { accountId: a, playerScore: 30, opponentScore: 20, won: true, timestamp: t0 + 50 })

    const rollup = await getRollup(DB(), a)
    expect(rollup).toEqual({
      game: 'jaipur',
      accountId: a,
      displayName: 'Rolly',
      games: 2,
      wins: 1,
      losses: 1,
      lastPlayedAt: t0 + 50,
    })
    expect(Number.isInteger(rollup.lastPlayedAt)).toBe(true) // epoch-ms, not an ISO string
  })

  it('an UNKNOWN account returns 200-shaped zeros, never a 404 shape (no account-enumeration oracle)', async () => {
    const rollup = await getRollup(DB(), acct('rollup-totally-unknown'))
    expect(rollup.games).toBe(0)
    expect(rollup.wins).toBe(0)
    expect(rollup.losses).toBe(0)
    expect(rollup.lastPlayedAt).toBeNull()
    expect(rollup.game).toBe('jaipur')
    expect(rollup.displayName).toBe('Player') // safe placeholder, not an error
  })
})

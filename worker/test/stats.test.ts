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
import { applyD1Schema } from './helpers'

const DB = () => (env as unknown as { DB: D1Database }).DB

beforeAll(async () => {
  await applyD1Schema(DB())
})

let ctr = 0
/** A globally-unique account id per call, so assertions never collide with
 *  rows other test files (or other `it`s in this shared-D1 run — see
 *  vitest.config.ts's `fileParallelism:false`/`isolate:false`) may have
 *  written. */
function acct(prefix: string): string {
  return `${prefix}-${Date.now()}-${ctr++}`
}

type SeedMatch = {
  accountId: string
  opponentType?: string
  opponentAccountId?: string | null
  playerScore: number
  opponentScore: number
  won: boolean
  source?: string
  aiCovered?: boolean
  gameUuid?: string | null
  timestamp: number
}

async function seedMatch(m: SeedMatch): Promise<void> {
  await DB()
    .prepare(
      `INSERT INTO matches
         (account_id, opponent_type, opponent_account_id, player_score, opponent_score,
          won, source, ai_covered, game_uuid, timestamp, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      m.accountId,
      m.opponentType ?? 'online',
      m.opponentAccountId ?? null,
      m.playerScore,
      m.opponentScore,
      m.won ? 1 : 0,
      m.source ?? 'online_authoritative',
      m.aiCovered ? 1 : 0,
      m.gameUuid ?? null,
      m.timestamp,
      m.timestamp,
    )
    .run()
}

async function seedPlayer(accountId: string, displayName: string): Promise<void> {
  await DB()
    .prepare(
      `INSERT INTO players (account_id, display_name, last_seen_at)
       VALUES (?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET display_name = excluded.display_name`,
    )
    .bind(accountId, displayName, Date.now())
    .run()
}

// =============================================================================
// getLeaderboard
// =============================================================================

describe('getLeaderboard', () => {
  it('keys rows by account_id, NEVER display_name: two accounts sharing a display name stay TWO rows', async () => {
    const a = acct('alice-twin')
    const b = acct('bob-twin')
    await seedPlayer(a, 'Same Name')
    await seedPlayer(b, 'Same Name')
    for (let i = 0; i < 3; i++) {
      await seedMatch({ accountId: a, playerScore: 100, opponentScore: 50, won: true, timestamp: Date.now() + i })
    }
    for (let i = 0; i < 3; i++) {
      await seedMatch({ accountId: b, playerScore: 40, opponentScore: 100, won: false, timestamp: Date.now() + 1000 + i })
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
    await seedPlayer(a, 'Splitter')
    await seedMatch({
      accountId: a,
      playerScore: 100,
      opponentScore: 10,
      won: true,
      source: 'online_authoritative',
      opponentType: 'online',
      timestamp: Date.now(),
    })
    await seedMatch({
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
    await seedPlayer(qualified, 'Qualified')
    await seedPlayer(unqualified, 'Unqualified')

    // Qualified: MIN_GAMES_FOR_RANK games, only 1 win (low win rate).
    for (let i = 0; i < MIN_GAMES_FOR_RANK; i++) {
      await seedMatch({ accountId: qualified, playerScore: 50, opponentScore: 90, won: i === 0, timestamp: Date.now() + 2000 + i })
    }
    // Unqualified: fewer than the floor, but a perfect win rate.
    for (let i = 0; i < MIN_GAMES_FOR_RANK - 1; i++) {
      await seedMatch({ accountId: unqualified, playerScore: 100, opponentScore: 10, won: true, timestamp: Date.now() + 3000 + i })
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
    await seedPlayer(a, 'Filter Twin')
    await seedPlayer(b, 'Filter Twin')
    // a: 3 games vs 'medium', 2 vs 'online'.
    for (let i = 0; i < 3; i++) {
      await seedMatch({ accountId: a, opponentType: 'medium', source: 'client_reported', playerScore: 100, opponentScore: 50, won: true, timestamp: Date.now() + i })
    }
    for (let i = 0; i < 2; i++) {
      await seedMatch({ accountId: a, opponentType: 'online', playerScore: 10, opponentScore: 90, won: false, timestamp: Date.now() + 100 + i })
    }
    // b: 3 games vs 'medium' only, same display name as a.
    for (let i = 0; i < 3; i++) {
      await seedMatch({ accountId: b, opponentType: 'medium', source: 'client_reported', playerScore: 20, opponentScore: 80, won: false, timestamp: Date.now() + 200 + i })
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
    await seedPlayer(a, 'AI Filter')
    for (let i = 0; i < 3; i++) {
      await seedMatch({ accountId: a, opponentType: 'easy', source: 'client_reported', playerScore: 60, opponentScore: 40, won: true, timestamp: Date.now() + 300 + i })
    }

    const { overall, verified } = await getLeaderboard(DB(), 'easy')
    expect(overall.find((r) => r.accountId === a)?.games).toBe(3)
    expect(verified.find((r) => r.accountId === a)).toBeUndefined()
  })

  it("a filter by 'online' makes 'verified' equal 'overall' (every online match is online_authoritative)", async () => {
    const a = acct('filter-verified-online')
    await seedPlayer(a, 'Online Filter')
    for (let i = 0; i < 3; i++) {
      await seedMatch({ accountId: a, opponentType: 'online', source: 'online_authoritative', playerScore: 70, opponentScore: 30, won: true, timestamp: Date.now() + 400 + i })
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
    await seedPlayer(a, 'Family Aggregator')
    for (let i = 0; i < 2; i++) {
      await seedMatch({ accountId: a, opponentType: 'hard2', source: 'client_reported', playerScore: 90, opponentScore: 40, won: true, timestamp: Date.now() + 700 + i })
    }
    for (let i = 0; i < 3; i++) {
      await seedMatch({ accountId: a, opponentType: 'ismcts', source: 'client_reported', playerScore: 80, opponentScore: 50, won: true, timestamp: Date.now() + 800 + i })
    }
    // A 'medium' match for the same account must NOT be swept into the
    // ['hard2','ismcts'] aggregate.
    await seedMatch({ accountId: a, opponentType: 'medium', source: 'client_reported', playerScore: 10, opponentScore: 90, won: false, timestamp: Date.now() + 900 })

    const { overall } = await getLeaderboard(DB(), ['hard2', 'ismcts'])
    const row = overall.find((r) => r.accountId === a)
    expect(row?.games).toBe(5) // 2 hard2 + 3 ismcts, the 1 medium match excluded
    expect(row?.wins).toBe(5)
  })

  it('aggregates across the full retired-inclusive "Hard family" list (hard2, ismcts, hard, fair)', async () => {
    const a = acct('family-agg-full')
    await seedMatch({ accountId: a, opponentType: 'hard2', source: 'client_reported', playerScore: 10, opponentScore: 5, won: true, timestamp: Date.now() + 1000 })
    await seedMatch({ accountId: a, opponentType: 'ismcts', source: 'client_reported', playerScore: 10, opponentScore: 5, won: true, timestamp: Date.now() + 1001 })
    await seedMatch({ accountId: a, opponentType: 'hard', source: 'client_reported', playerScore: 10, opponentScore: 5, won: false, timestamp: Date.now() + 1002 })
    await seedMatch({ accountId: a, opponentType: 'fair', source: 'client_reported', playerScore: 10, opponentScore: 5, won: false, timestamp: Date.now() + 1003 })

    const { overall } = await getLeaderboard(DB(), ['hard2', 'ismcts', 'hard', 'fair'])
    const row = overall.find((r) => r.accountId === a)
    expect(row?.games).toBe(4)
    expect(row?.wins).toBe(2)
  })

  it('a single-element list behaves identically to passing that id as a plain string', async () => {
    const a = acct('family-agg-single')
    for (let i = 0; i < 3; i++) {
      await seedMatch({ accountId: a, opponentType: 'medium', source: 'client_reported', playerScore: 60, opponentScore: 20, won: true, timestamp: Date.now() + 1100 + i })
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
// getAvailableOpponentTypes / isValidOpponentTypeFilter
// =============================================================================

describe('getAvailableOpponentTypes', () => {
  it('lists DISTINCT opponent_types with at least one match, and nothing else', async () => {
    const a = acct('avail-types')
    await seedMatch({ accountId: a, opponentType: 'hard3', source: 'client_reported', playerScore: 5, opponentScore: 1, won: true, timestamp: Date.now() + 500 })

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
    await seedPlayer(a, 'Router Filter')
    for (let i = 0; i < 3; i++) {
      await seedMatch({ accountId: a, opponentType: 'medium', source: 'client_reported', playerScore: 1, opponentScore: 0, won: true, timestamp: Date.now() + 600 + i })
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
    await seedMatch({ accountId: a, opponentType: 'hard2', source: 'client_reported', playerScore: 1, opponentScore: 0, won: true, timestamp: Date.now() + 1200 })
    await seedMatch({ accountId: a, opponentType: 'ismcts', source: 'client_reported', playerScore: 1, opponentScore: 0, won: true, timestamp: Date.now() + 1201 })
    await seedMatch({ accountId: a, opponentType: 'hard', source: 'client_reported', playerScore: 1, opponentScore: 0, won: true, timestamp: Date.now() + 1202 })
    await seedMatch({ accountId: a, opponentType: 'fair', source: 'client_reported', playerScore: 1, opponentScore: 0, won: true, timestamp: Date.now() + 1203 })

    const res = await SELF.fetch(new Request('https://worker/stats/leaderboard?opponentType=hard2,ismcts,hard,fair'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { overall: { accountId: string; games: number }[]; availableOpponents?: string[] }
    expect(body.overall.find((r) => r.accountId === a)?.games).toBe(4)
    expect(body.availableOpponents).toBeUndefined() // still filtered shape, same as a single id
  })

  it('a single id passed with no comma behaves exactly as before (single-id path unchanged)', async () => {
    const a = acct('router-single-unchanged')
    for (let i = 0; i < 2; i++) {
      await seedMatch({ accountId: a, opponentType: 'easy', source: 'client_reported', playerScore: 1, opponentScore: 0, won: true, timestamp: Date.now() + 1300 + i })
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
    await seedMatch({ accountId: a, playerScore: 10, opponentScore: 20, won: false, timestamp: t0 })
    await seedMatch({ accountId: a, playerScore: 30, opponentScore: 20, won: true, timestamp: t0 + 10 })
    await seedMatch({ accountId: a, playerScore: 50, opponentScore: 10, won: true, timestamp: t0 + 20 })

    const rows = await getHistory(DB(), a)
    expect(rows.length).toBe(3)
    expect(rows.map((r) => r.timestamp)).toEqual([t0 + 20, t0 + 10, t0]) // newest first
    expect(rows.every((r) => r.opponentType === 'online')).toBe(true)
  })

  it('never returns another account\'s matches', async () => {
    const a = acct('history-mine')
    const other = acct('history-theirs')
    await seedMatch({ accountId: a, playerScore: 1, opponentScore: 2, won: false, timestamp: Date.now() })
    await seedMatch({ accountId: other, playerScore: 3, opponentScore: 4, won: false, timestamp: Date.now() })

    const rows = await getHistory(DB(), a)
    expect(rows.every((r) => r.playerScore !== 3)).toBe(true) // the other account's row never leaks in
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
    await seedPlayer(a, 'Rolly')
    const t0 = Date.now()
    await seedMatch({ accountId: a, playerScore: 10, opponentScore: 20, won: false, timestamp: t0 })
    await seedMatch({ accountId: a, playerScore: 30, opponentScore: 20, won: true, timestamp: t0 + 50 })

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

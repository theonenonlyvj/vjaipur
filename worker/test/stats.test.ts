import { env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import { MIN_GAMES_FOR_RANK, getHistory, getLeaderboard, getRollup, reportMatch } from '../src/do/stats'
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

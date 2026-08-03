import { env, SELF } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import { getMyStyle } from '../src/do/style'
import { applyD1Schema, acct, seedMatch } from './helpers'

const DB = () => (env as unknown as { DB: D1Database }).DB

beforeAll(async () => {
  await applyD1Schema(DB())
})

function tok(overrides: Record<string, number[]>): number[][] {
  const GOOD_ORDER = ['diamond', 'gold', 'silver', 'cloth', 'spice', 'leather']
  return GOOD_ORDER.map((g) => overrides[g] ?? [1, 1, 1])
}

async function seedMatchLog(accountId: string, opponentType: string, timestamp: number, log: unknown[]): Promise<number> {
  const res = await DB()
    .prepare(`INSERT INTO match_logs (account_id, opponent_type, timestamp, log, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(accountId, opponentType, timestamp, JSON.stringify(log), timestamp)
    .run()
  return Number(res.meta.last_row_id)
}

async function getCacheRow(accountId: string, tier: string): Promise<{ last_log_id: number; agg: string; updated_at: number } | null> {
  return DB()
    .prepare(`SELECT last_log_id, agg, updated_at FROM style_cache WHERE account_id = ? AND tier = ?`)
    .bind(accountId, tier)
    .first<{ last_log_id: number; agg: string; updated_at: number }>()
}

// Two simple fixture games, human-known-quantities so the folded numbers are
// hand-verifiable (mirrors tests/shared/styleAgg.test.ts's fixture style).
// `ply`/`round` and `preState.herd` are required by src/shared/styleAgg.ts
// (ply-based trajectory bucketing, round-end camel-majority) — see that
// module's StyleLogEntry/StyleLogPreState docstrings.
function gameOneLog() {
  return [
    { actor: 'human', ply: 1, round: 1, action: { type: 'SELL', good: 'spice', quantity: 2 }, preState: { tok: tok({ spice: [6, 4, 3] }), score: [0, 0], herd: [0, 0] } },
    { actor: 'ai', ply: 2, round: 1, action: { type: 'TAKE_CAMELS' }, preState: { tok: tok({}), score: [10, 0], herd: [0, 0] } },
  ]
}

function gameTwoLog() {
  return [
    { actor: 'ai', ply: 1, round: 1, action: { type: 'SELL', good: 'cloth', quantity: 3 }, preState: { tok: tok({ cloth: [5, 4, 3, 2] }), score: [0, 0], herd: [0, 0] } },
    { actor: 'human', ply: 2, round: 1, action: { type: 'TAKE_CAMELS' }, preState: { tok: tok({}), score: [0, 5], herd: [0, 0] } },
  ]
}

function gameThreeLog() {
  return [
    { actor: 'human', ply: 1, round: 1, action: { type: 'SELL', good: 'diamond', quantity: 1 }, preState: { tok: tok({ diamond: [7, 6] }), score: [0, 0], herd: [0, 0] } },
  ]
}

describe('getMyStyle', () => {
  it('an account with no match_logs at all returns games:0, an all-zero-but-JSON-safe style, and an empty availableTiers', async () => {
    const a = acct('style-empty')
    const result = await getMyStyle(DB(), a, 'ismcts')

    expect(result.games).toBe(0)
    expect(result.availableTiers).toEqual([])
    expect(result.style.games).toBe(0)
    expect(JSON.parse(JSON.stringify(result))).toEqual(result) // no NaN/Infinity anywhere

    // Nothing to cache — a pure empty read never writes a row.
    expect(await getCacheRow(a, 'ismcts')).toBeNull()
  })

  it('seeding 2 match_logs+matches rows folds correctly into the finalized style', async () => {
    const a = acct('style-two-games')
    const t1 = Date.now()
    const t2 = t1 + 1000
    await seedMatchLog(a, 'ismcts', t1, gameOneLog())
    await seedMatch(DB(), { accountId: a, opponentType: 'ismcts', timestamp: t1, won: true, source: 'client_reported' })
    await seedMatchLog(a, 'ismcts', t2, gameTwoLog())
    await seedMatch(DB(), { accountId: a, opponentType: 'ismcts', timestamp: t2, won: false, source: 'client_reported' })

    const result = await getMyStyle(DB(), a, 'ismcts')

    expect(result.games).toBe(2)
    expect(result.style.games).toBe(2)
    expect(result.style.wins).toBe(1)
    expect(result.style.losses).toBe(1)
    expect(result.availableTiers).toEqual([{ tier: 'ismcts', games: 2 }])

    // human sold spice qty2 for 6+4=10 -> tokensPerCard 10/2=5
    // ai sold cloth qty3 for 5+4+3=12 -> tokensPerCard 12/3=4
    const row = result.style.rows.find((r) => r.id === 'tokensPerCard')!
    expect(row.human).toBeCloseTo(5, 6)
    expect(row.ai).toBeCloseTo(4, 6)

    // A cache row now exists, pinned to the higher of the two seeded log ids.
    const cache = await getCacheRow(a, 'ismcts')
    expect(cache).toBeTruthy()
    const cachedAgg = JSON.parse(cache!.agg)
    expect(cachedAgg.games).toBe(2)
  })

  it('a re-request with no new rows returns the SAME cached finalize and does not rewrite the cache row', async () => {
    const a = acct('style-no-new-rows')
    const t1 = Date.now()
    await seedMatchLog(a, 'medium', t1, gameOneLog())
    await seedMatch(DB(), { accountId: a, opponentType: 'medium', timestamp: t1, won: true, source: 'client_reported' })

    const first = await getMyStyle(DB(), a, 'medium')
    const cacheAfterFirst = await getCacheRow(a, 'medium')
    expect(cacheAfterFirst).toBeTruthy()

    const second = await getMyStyle(DB(), a, 'medium')
    expect(second).toEqual(first)

    const cacheAfterSecond = await getCacheRow(a, 'medium')
    expect(cacheAfterSecond!.updated_at).toBe(cacheAfterFirst!.updated_at) // untouched — no write happened
    expect(cacheAfterSecond!.last_log_id).toBe(cacheAfterFirst!.last_log_id)
  })

  // -------------------------------------------------------------------
  // Incremental correctness — the property the whole cache design rests
  // on: after the first call caches rows [1,2], we CORRUPT row 1's log
  // in place (blank it out) so that if getMyStyle ever recomputed from
  // scratch off the raw table, the numbers would visibly change. Adding a
  // 3rd row and re-requesting must still reflect row 1's ORIGINAL
  // (pre-corruption) contribution — proving the cache, not the raw table,
  // is what's actually being read forward from.
  // -------------------------------------------------------------------
  it('incremental: only genuinely new rows are folded, and the cache — not a re-scan — carries old rows forward', async () => {
    const a = acct('style-incremental')
    const t1 = Date.now()
    const t2 = t1 + 1000
    const t3 = t1 + 2000

    const id1 = await seedMatchLog(a, 'hard2', t1, gameOneLog())
    await seedMatch(DB(), { accountId: a, opponentType: 'hard2', timestamp: t1, won: true, source: 'client_reported' })
    const id2 = await seedMatchLog(a, 'hard2', t2, gameTwoLog())
    await seedMatch(DB(), { accountId: a, opponentType: 'hard2', timestamp: t2, won: false, source: 'client_reported' })

    const afterTwo = await getMyStyle(DB(), a, 'hard2')
    expect(afterTwo.games).toBe(2)
    const humanTokensPerCardAfterTwo = afterTwo.style.rows.find((r) => r.id === 'tokensPerCard')!.human
    expect(humanTokensPerCardAfterTwo).toBeCloseTo(5, 6) // from row 1's spice sale (10 tokens / 2 cards)

    const cacheAfterTwo = await getCacheRow(a, 'hard2')
    expect(cacheAfterTwo!.last_log_id).toBe(id2) // cache advanced past both seeded rows
    const lastLogIdAfterTwo = cacheAfterTwo!.last_log_id

    // Corrupt row 1's log — if getMyStyle ever re-scanned raw match_logs
    // instead of trusting the cache forward, this would zero out row 1's
    // contribution (tokensEarned/cardsSold) on the next call.
    await DB().prepare(`UPDATE match_logs SET log = '[]' WHERE id = ?`).bind(id1).run()

    // Add a 3rd game and re-request.
    await seedMatchLog(a, 'hard2', t3, gameThreeLog())
    await seedMatch(DB(), { accountId: a, opponentType: 'hard2', timestamp: t3, won: true, source: 'client_reported' })

    const afterThree = await getMyStyle(DB(), a, 'hard2')
    expect(afterThree.games).toBe(3)
    expect(afterThree.style.wins).toBe(2)
    expect(afterThree.style.losses).toBe(1)

    // human tokensEarned: row1's spice (10) + row3's diamond (7) = 17,
    // cardsSold: row1's 2 + row3's 1 = 3 -> 17/3 ≈ 5.667. If the corrupted
    // row 1 had been re-read from scratch, row1's 10/2 would be LOST and
    // this would instead be 7/1 = 7 — a different, wrong number.
    const humanTokensPerCardAfterThree = afterThree.style.rows.find((r) => r.id === 'tokensPerCard')!.human
    expect(humanTokensPerCardAfterThree).toBeCloseTo(17 / 3, 6)
    expect(humanTokensPerCardAfterThree).not.toBeCloseTo(7, 1) // would be 7 if row 1 were re-scanned post-corruption

    // The cache's last_log_id advanced past the corrupted row 1's id — it
    // only needed to look at the genuinely new row 3.
    const cacheAfterThree = await getCacheRow(a, 'hard2')
    expect(cacheAfterThree!.last_log_id).toBeGreaterThan(lastLogIdAfterTwo)
  })

  it('a log row with no matching matches row is skipped (never fails the request)', async () => {
    const a = acct('style-orphan-log')
    const t1 = Date.now()
    await seedMatchLog(a, 'easy', t1, gameOneLog()) // no seedMatch for this timestamp

    const result = await getMyStyle(DB(), a, 'easy')
    expect(result.style.games).toBe(0) // orphan log contributes nothing
    expect(result.availableTiers).toEqual([{ tier: 'easy', games: 1 }]) // still counted as "a log exists"
  })

  // BUG 9 (2026-08-03): the cache write is now a CONDITIONAL UPDATE (WHERE
  // last_log_id = the value this request read at the start) — a stale
  // writer's own attempt affects 0 rows and must never regress a newer
  // write, per do/style.ts#writeCache's docstring.
  describe('conditional cache write under a concurrent stale writer (BUG 9)', () => {
    it('a stale writer\'s conditional UPDATE bound to an old last_log_id is a no-op — never regresses a newer write', async () => {
      const a = acct('style-stale-writer')
      const t1 = Date.now()
      await seedMatchLog(a, 'medium', t1, gameOneLog())
      await seedMatch(DB(), { accountId: a, opponentType: 'medium', timestamp: t1, won: true, source: 'client_reported' })

      // Prime the cache normally.
      await getMyStyle(DB(), a, 'medium')
      const primed = await getCacheRow(a, 'medium')
      const staleSinceLogId = primed!.last_log_id

      // A "faster" concurrent writer already advanced the cache past what a
      // slower request (still holding `staleSinceLogId` from its own
      // earlier read) knows about.
      const fasterWriterLogId = staleSinceLogId + 1000
      await DB()
        .prepare(`UPDATE style_cache SET last_log_id = ?, agg = ?, updated_at = ? WHERE account_id = ? AND tier = ?`)
        .bind(fasterWriterLogId, primed!.agg, Date.now(), a, 'medium')
        .run()

      // The slower request's own conditional UPDATE — bound to the STALE
      // sinceLogId it read before the faster writer landed — is exactly the
      // SQL do/style.ts#writeCache now issues for an existing row.
      const staleWrite = await DB()
        .prepare(
          `UPDATE style_cache SET last_log_id = ?, agg = ?, updated_at = ?
           WHERE account_id = ? AND tier = ? AND last_log_id = ?`,
        )
        .bind(staleSinceLogId, '{"fake":"stale-agg"}', Date.now(), a, 'medium', staleSinceLogId)
        .run()

      expect(staleWrite.meta.changes).toBe(0) // the WHERE guard rejected the stale write

      const finalCache = await getCacheRow(a, 'medium')
      expect(finalCache!.last_log_id).toBe(fasterWriterLogId) // untouched by the stale writer
      expect(finalCache!.agg).not.toContain('stale-agg') // never clobbered
    })

    it('two concurrent first-ever writers for the same (account,tier) never both insert — the loser skips cleanly and the read still succeeds', async () => {
      const a = acct('style-race-insert')
      const t1 = Date.now()
      const t2 = t1 + 1000
      await seedMatchLog(a, 'ismcts', t1, gameOneLog())
      await seedMatch(DB(), { accountId: a, opponentType: 'ismcts', timestamp: t1, won: true, source: 'client_reported' })
      await seedMatchLog(a, 'ismcts', t2, gameTwoLog())
      await seedMatch(DB(), { accountId: a, opponentType: 'ismcts', timestamp: t2, won: false, source: 'client_reported' })

      // Fire two concurrent FIRST-ever getMyStyle calls — both may read
      // cacheRow=null before either writes.
      const [resultA, resultB] = await Promise.all([
        getMyStyle(DB(), a, 'ismcts'),
        getMyStyle(DB(), a, 'ismcts'),
      ])

      // Both requests still serve the correct, fully-folded result — a
      // losing writer never blocks (or corrupts) its own read.
      expect(resultA.games).toBe(2)
      expect(resultB.games).toBe(2)
      expect(resultA.style).toEqual(resultB.style)

      // Exactly one cache row exists (no crash/duplicate-key error from the
      // race), reflecting a fully-folded state.
      const cache = await getCacheRow(a, 'ismcts')
      expect(cache).toBeTruthy()
      expect(JSON.parse(cache!.agg).games).toBe(2)
    })
  })

  it('tier isolation: two tiers for the same account never mix, and availableTiers reports both with correct counts', async () => {
    const a = acct('style-tier-isolation')
    const t1 = Date.now()
    const t2 = t1 + 1000
    await seedMatchLog(a, 'medium', t1, gameOneLog())
    await seedMatch(DB(), { accountId: a, opponentType: 'medium', timestamp: t1, won: true, source: 'client_reported' })
    await seedMatchLog(a, 'ismcts', t2, gameTwoLog())
    await seedMatch(DB(), { accountId: a, opponentType: 'ismcts', timestamp: t2, won: false, source: 'client_reported' })

    const mediumResult = await getMyStyle(DB(), a, 'medium')
    expect(mediumResult.games).toBe(1)
    expect(mediumResult.style.wins).toBe(1)
    expect(mediumResult.style.losses).toBe(0)

    const ismctsResult = await getMyStyle(DB(), a, 'ismcts')
    expect(ismctsResult.games).toBe(1)
    expect(ismctsResult.style.wins).toBe(0)
    expect(ismctsResult.style.losses).toBe(1)

    const tiersByName = Object.fromEntries(mediumResult.availableTiers.map((t) => [t.tier, t.games]))
    expect(tiersByName).toEqual({ medium: 1, ismcts: 1 })
  })
})

describe('GET /stats/my-style router', () => {
  it('401s when unauthenticated', async () => {
    const res = await SELF.fetch(new Request('https://worker/stats/my-style?tier=medium'))
    expect(res.status).toBe(401)
  })

  it('400s with invalid_tier when ?tier= is missing', async () => {
    const res = await SELF.fetch(new Request('https://worker/stats/my-style'), {
      headers: { Authorization: 'Bearer test:acct-router-my-style:Router' },
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_tier' })
  })

  it('400s with invalid_tier when ?tier= is garbage', async () => {
    const res = await SELF.fetch(new Request('https://worker/stats/my-style?tier=not-a-real-tier'), {
      headers: { Authorization: 'Bearer test:acct-router-my-style-2:Router' },
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_tier' })
  })

  it('200s with a real tier for an authed caller and returns the MyStyleResponse shape', async () => {
    const accountId = `acct-router-my-style-3-${Date.now()}`
    const res = await SELF.fetch(new Request('https://worker/stats/my-style?tier=easy'), {
      headers: { Authorization: `Bearer test:${accountId}:Router` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { tier: string; games: number; availableTiers: unknown[]; style: { games: number } }
    expect(body.tier).toBe('easy')
    expect(body.games).toBe(0)
    expect(Array.isArray(body.availableTiers)).toBe(true)
    expect(body.style.games).toBe(0)
  })
})

import {
  aggregateGame,
  emptyStyleAgg,
  finalizeStyle,
  type StyleAgg,
  type StyleFinalized,
  type StyleLogEntry,
} from '../../../src/shared/styleAgg'

/**
 * `GET /stats/my-style?tier=<tierId>` backing logic (design: see the
 * feature's build brief — "MY STYLE" tab in the Hall of Records). Pure D1-
 * query logic, no `Response` construction (index.ts's job) — same layering
 * convention as `do/stats.ts`.
 *
 * HARD CONSTRAINT (Vijay-approved): ZERO compute for a player who never
 * opens the tab. This module is invoked from exactly ONE place — index.ts's
 * `/stats/my-style` route, on an authed GET — and nowhere else. In
 * particular, `do/stats.ts#reportMatch` (the match-end write path) never
 * imports or calls anything here; the `style_cache` table this module reads
 * and writes (migration 0003) simply does not exist for an account until
 * that account's owner opens the tab at least once. Lazy AND incremental:
 * once a cache row exists, a later call only re-folds match_logs rows newer
 * than the cached `last_log_id` — it never re-scans full history.
 */

type CacheRow = { last_log_id: number; agg: string }
type LogRow = { id: number; timestamp: number; log: string }
type OutcomeRow = { timestamp: number; won: number }
type TierCountRow = { tier: string; games: number }

export interface AvailableTier {
  tier: string
  games: number
}

export interface MyStyleResponse {
  tier: string
  /** Games logged for THIS tier (== the matching entry in availableTiers,
   *  pulled out for convenience — the client's <5-games gate reads this
   *  directly rather than re-scanning availableTiers). */
  games: number
  /** DISTINCT opponent_type values this account has ANY match_logs rows
   *  for, with per-tier counts — so the client can build a tier picker and
   *  default to the most-played tier, all from one response. */
  availableTiers: AvailableTier[]
  style: StyleFinalized
}

/** DISTINCT opponent_type + row count from match_logs for this account —
 *  cheap (both columns are indexed: idx_mlogs_acct, idx_mlogs_type). Always
 *  computed (not cached) — it's a tiny aggregate query, not worth the extra
 *  cache-invalidation surface a stale copy would introduce. */
async function loadAvailableTiers(db: D1Database, accountId: string): Promise<AvailableTier[]> {
  const { results } = await db
    .prepare(`SELECT opponent_type AS tier, COUNT(*) AS games FROM match_logs WHERE account_id = ? GROUP BY opponent_type`)
    .bind(accountId)
    .all<TierCountRow>()
  return results.map((r) => ({ tier: r.tier, games: Number(r.games) }))
}

/**
 * Fold every match_logs row with `id > sinceLogId` (for this account+tier,
 * ascending) into `startAgg`, joining each to its `matches` outcome by
 * `timestamp` — a log row with no matching `matches` row (shouldn't happen
 * in practice, since both are written together by `reportMatch`, but never
 * assume) is SKIPPED, never thrown over, same "skip, don't fail" contract
 * `do/stats.ts#reportMatch` already uses for a malformed log. Returns the
 * folded agg plus the highest id actually seen (so the caller can advance
 * the cache's `last_log_id` even if some rows were skipped).
 */
async function foldNewRows(
  db: D1Database,
  accountId: string,
  tier: string,
  sinceLogId: number,
  startAgg: StyleAgg,
): Promise<{ agg: StyleAgg; lastLogId: number; foldedAny: boolean }> {
  const { results: newLogs } = await db
    .prepare(`SELECT id, timestamp, log FROM match_logs WHERE account_id = ? AND opponent_type = ? AND id > ? ORDER BY id`)
    .bind(accountId, tier, sinceLogId)
    .all<LogRow>()

  if (newLogs.length === 0) return { agg: startAgg, lastLogId: sinceLogId, foldedAny: false }

  const timestamps = newLogs.map((r) => r.timestamp)
  const placeholders = timestamps.map(() => '?').join(', ')
  const { results: outcomes } = await db
    .prepare(`SELECT timestamp, won FROM matches WHERE account_id = ? AND opponent_type = ? AND timestamp IN (${placeholders})`)
    .bind(accountId, tier, ...timestamps)
    .all<OutcomeRow>()
  const outcomeByTs = new Map(outcomes.map((o) => [o.timestamp, o.won === 1]))

  let agg = startAgg
  let lastLogId = sinceLogId
  for (const row of newLogs) {
    lastLogId = row.id // advance regardless of skip — never re-fetch a row we've already looked at
    const won = outcomeByTs.get(row.timestamp)
    if (won === undefined) continue // no matching outcome row — skip, never fail

    let entries: unknown
    try {
      entries = JSON.parse(row.log)
    } catch {
      continue // malformed log — skip, never fail (mirrors reportMatch's own tolerance)
    }
    if (!Array.isArray(entries)) continue

    agg = aggregateGame(agg, entries as StyleLogEntry[], { won })
  }

  return { agg, lastLogId, foldedAny: true }
}

/**
 * `GET /stats/my-style?tier=` core logic. Reads the cached `style_cache` row
 * (if any), folds in only genuinely NEW match_logs rows (see `foldNewRows`),
 * upserts the cache when there was anything new to fold, and returns the
 * finalized display shape either way. When there's nothing new, the cached
 * finalize is returned with NO write — a re-open of the tab between games is
 * a pure read.
 */
export async function getMyStyle(db: D1Database, accountId: string, tier: string): Promise<MyStyleResponse> {
  const [availableTiers, cacheRow] = await Promise.all([
    loadAvailableTiers(db, accountId),
    db.prepare(`SELECT last_log_id, agg FROM style_cache WHERE account_id = ? AND tier = ?`).bind(accountId, tier).first<CacheRow>(),
  ])

  const startAgg: StyleAgg = cacheRow ? (JSON.parse(cacheRow.agg) as StyleAgg) : emptyStyleAgg()
  const sinceLogId = cacheRow?.last_log_id ?? 0

  const { agg, lastLogId, foldedAny } = await foldNewRows(db, accountId, tier, sinceLogId, startAgg)

  if (foldedAny) {
    await db
      .prepare(
        `INSERT INTO style_cache (account_id, tier, last_log_id, agg, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(account_id, tier) DO UPDATE SET last_log_id = excluded.last_log_id, agg = excluded.agg, updated_at = excluded.updated_at`,
      )
      .bind(accountId, tier, lastLogId, JSON.stringify(agg), Date.now())
      .run()
  }

  const games = availableTiers.find((t) => t.tier === tier)?.games ?? 0

  return { tier, games, availableTiers, style: finalizeStyle(agg) }
}

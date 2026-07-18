import { MIN_GAMES_FOR_RANK, rankBySkill, type RankableRow } from '../../../src/components/leaderboardRank'
import { getTier } from '../../../src/ai/tiers'

/**
 * `worker/migrations/0001_init.sql`'s `matches`/`players` tables are THE
 * stats store (design spec §6, ADDENDUM S/T). This module is pure D1-query
 * logic — no `Response` construction (that's index.ts's job) — so it stays
 * unit-testable against a bare `D1Database` without spinning up the router.
 */

// ---- leaderboard -------------------------------------------------------------

export type LeaderboardRow = {
  accountId: string
  displayName: string
  games: number
  wins: number
  winRate: number
}

export type LeaderboardResponse = {
  overall: LeaderboardRow[]
  /** `online_authoritative` only — rule-legal + server-authoritative, NOT
   *  proof of two distinct humans (ADDENDUM T: a user can self-play two
   *  ghost accounts; no collusion mitigation tonight). */
  verified: LeaderboardRow[]
}

type AggRow = { account_id: string; display_name: string | null; games: number; wins: number | null; avg_delta: number | null }

async function loadLeaderboardRows(db: D1Database, verifiedOnly: boolean): Promise<LeaderboardRow[]> {
  const where = verifiedOnly ? `WHERE m.source = 'online_authoritative'` : ''
  const { results } = await db
    .prepare(
      `SELECT m.account_id AS account_id, COALESCE(p.display_name, 'Player') AS display_name,
              COUNT(*) AS games, SUM(m.won) AS wins, AVG(m.player_score - m.opponent_score) AS avg_delta
       FROM matches m
       LEFT JOIN players p ON p.account_id = m.account_id
       ${where}
       GROUP BY m.account_id`,
    )
    .all<AggRow>()

  // Ranked BY account_id (never display_name — ADDENDUM: two players sharing
  // a display name must stay two distinct rows; GROUP BY account_id above
  // already guarantees this structurally).
  const rankable: (RankableRow & { accountId: string; displayName: string; wins: number })[] = results.map((r) => ({
    accountId: r.account_id,
    displayName: r.display_name ?? 'Player',
    games: Number(r.games),
    wins: Number(r.wins ?? 0),
    avg_delta: Number(r.avg_delta ?? 0),
  }))

  // Same skill-ranking rule as the app's own leaderboard (qualified-before-
  // unqualified at MIN_GAMES_FOR_RANK, then win rate desc, wins desc, avg
  // score delta desc) — reusing the exact client comparator so the two never
  // drift apart.
  rankable.sort(rankBySkill)

  return rankable.map((r) => ({
    accountId: r.accountId,
    displayName: r.displayName,
    games: r.games,
    wins: r.wins,
    winRate: r.games > 0 ? r.wins / r.games : 0,
  }))
}

export async function getLeaderboard(db: D1Database): Promise<LeaderboardResponse> {
  const [overall, verified] = await Promise.all([loadLeaderboardRows(db, false), loadLeaderboardRows(db, true)])
  return { overall, verified }
}

// re-exported so a caller (or a test) can cite the exact same qualification
// floor the ranking above uses, without hand-duplicating the constant.
export { MIN_GAMES_FOR_RANK }

// ---- history ------------------------------------------------------------------

export type MatchHistoryRow = {
  id: number
  opponentType: string
  opponentAccountId: string | null
  playerScore: number
  opponentScore: number
  won: boolean
  source: string
  aiCovered: boolean
  gameUuid: string | null
  timestamp: number
}

type HistoryDbRow = {
  id: number
  opponent_type: string
  opponent_account_id: string | null
  player_score: number
  opponent_score: number
  won: number
  source: string
  ai_covered: number
  game_uuid: string | null
  timestamp: number
}

/** The caller's OWN matches, newest first (authed route — index.ts resolves
 *  `accountId` from the Bearer token, never a query param). */
export async function getHistory(db: D1Database, accountId: string): Promise<MatchHistoryRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, opponent_type, opponent_account_id, player_score, opponent_score,
              won, source, ai_covered, game_uuid, timestamp
       FROM matches WHERE account_id = ? ORDER BY timestamp DESC`,
    )
    .bind(accountId)
    .all<HistoryDbRow>()

  return results.map((r) => ({
    id: r.id,
    opponentType: r.opponent_type,
    opponentAccountId: r.opponent_account_id,
    playerScore: r.player_score,
    opponentScore: r.opponent_score,
    won: r.won === 1,
    source: r.source,
    aiCovered: r.ai_covered === 1,
    gameUuid: r.game_uuid,
    timestamp: r.timestamp,
  }))
}

// ---- report (client-reported local vs-AI match) --------------------------------

export type ReportMatchBody = {
  opponent_type?: unknown
  player_score?: unknown
  opponent_score?: unknown
  won?: unknown
  timestamp?: unknown
}

export type ReportMatchResult = { ok: true; duplicate?: true } | { error: string }

/** `src/ai/tiers.ts`'s `TIERS` (easy/medium/hard/hard2/hard3/fair) is the
 *  single source of truth for valid `opponent_type` tier ids — including
 *  RETIRED tiers (`hard`/`hard2`), which are still legitimate historical
 *  values (`getTierLabel`'s docstring: "'online' isn't an AI tier at all —
 *  callers handle that separately", which is exactly why 'online' is
 *  correctly rejected here: this route is local-vs-AI reports only). */
function isValidTierId(id: unknown): id is string {
  return typeof id === 'string' && getTier(id) !== undefined
}

function isSaneScore(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 500
}

/** A sane epoch-ms: an integer between "vjaipur could plausibly have
 *  existed" (2020) and now + 1 day (tolerates modest client clock skew
 *  without accepting garbage far-future values). */
function isSaneTimestamp(ts: unknown): ts is number {
  if (typeof ts !== 'number' || !Number.isInteger(ts)) return false
  const MIN = Date.UTC(2020, 0, 1)
  const MAX = Date.now() + 24 * 60 * 60 * 1000
  return ts >= MIN && ts <= MAX
}

/**
 * `POST /stats/report` — a client-reported LOCAL vs-AI match (tier ids only;
 * NOT for online games, which are archived server-side by
 * `do/archive.ts#archiveMatchEnd` and can never be self-reported).
 * `source:'client_reported'` (trust-scoped separately from
 * `online_authoritative` everywhere stats are read — see `getLeaderboard`'s
 * `verified` split). Dedup via the `matches` UNIQUE(account_id, timestamp,
 * opponent_type) index, so a retried POST (same client-minted `timestamp`)
 * is a safe no-op.
 */
export async function reportMatch(db: D1Database, accountId: string, body: ReportMatchBody): Promise<ReportMatchResult> {
  if (!isValidTierId(body.opponent_type)) return { error: 'invalid_opponent_type' }
  if (!isSaneScore(body.player_score)) return { error: 'invalid_player_score' }
  if (!isSaneScore(body.opponent_score)) return { error: 'invalid_opponent_score' }
  if (typeof body.won !== 'boolean') return { error: 'invalid_won' }
  if (!isSaneTimestamp(body.timestamp)) return { error: 'invalid_timestamp' }

  const now = Date.now()
  const result = await db
    .prepare(
      `INSERT INTO matches
         (account_id, opponent_type, opponent_account_id, player_score, opponent_score,
          won, source, ai_covered, game_uuid, timestamp, created_at)
       VALUES (?, ?, NULL, ?, ?, ?, 'client_reported', 0, NULL, ?, ?)
       ON CONFLICT(account_id, timestamp, opponent_type) DO NOTHING`,
    )
    .bind(accountId, body.opponent_type, body.player_score, body.opponent_score, body.won ? 1 : 0, body.timestamp, now)
    .run()

  const changes = result.meta?.changes ?? 0
  return changes > 0 ? { ok: true } : { ok: true, duplicate: true }
}

// ---- rollup (public, cross-game federation contract) ----------------------------

/** `GET /stats/rollup?accountId=` — the STATS-FEDERATION v0 contract
 *  (`vgames-platform/docs/STATS-FEDERATION.md`): mandatory
 *  games/wins/losses/lastPlayedAt, epoch-ms timestamps, 200-with-zeros for an
 *  unknown account (never 404 — no account-enumeration oracle), no
 *  cross-game math (this only ever reads vjaipur's own `matches`/`players`
 *  tables). Spans ALL sources (online + client-reported) — "games played" is
 *  a participation count, not a verified-score board (contrast
 *  `getLeaderboard`'s `verified` split, which exists specifically because
 *  THOSE boards are rankings, not raw counts). `bests`/`perMode` are
 *  optional per the contract and simply omitted — Jaipur has no rollup-worthy
 *  best-stat concept defined yet. */
export type RollupResponse = {
  game: 'jaipur'
  accountId: string
  displayName: string
  games: number
  wins: number
  losses: number
  lastPlayedAt: number | null
}

type RollupAggRow = { games: number; wins: number | null; last_played_at: number | null }

export async function getRollup(db: D1Database, accountId: string): Promise<RollupResponse> {
  const agg = await db
    .prepare(`SELECT COUNT(*) AS games, SUM(won) AS wins, MAX(timestamp) AS last_played_at FROM matches WHERE account_id = ?`)
    .bind(accountId)
    .first<RollupAggRow>()

  const player = await db
    .prepare(`SELECT display_name FROM players WHERE account_id = ?`)
    .bind(accountId)
    .first<{ display_name: string | null }>()

  const games = agg?.games ?? 0
  const wins = agg?.wins ?? 0

  return {
    game: 'jaipur',
    accountId,
    displayName: player?.display_name ?? 'Player',
    games,
    wins,
    losses: games - wins,
    lastPlayedAt: agg?.last_played_at ?? null,
  }
}

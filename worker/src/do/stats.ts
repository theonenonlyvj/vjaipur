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
  /** MATCH count (kept for compat — unchanged calc, same field name/meaning
   *  this had before the 2026-07-28 GAMES-first ruling). NOT the primary
   *  ranking number anymore — see `gamesWon`/`gamesLost` below and this
   *  file's header. */
  games: number
  /** MATCH wins (kept for compat, unchanged calc). */
  wins: number
  /** MATCH win rate = wins/games (kept for compat, unchanged calc). */
  winRate: number
  /** Per-GAME (deal/round) win/loss totals — the PRIMARY lifetime record per
   *  the owner's 2026-07-28 ruling (matches the RIVALRY modal's precedent —
   *  see worker/src/do/rivalry.ts's file header — and the home screen's own
   *  "MATCH LENGTH: 1 GAME / 3 GAMES" vocabulary). Resolved per-row via
   *  GAMES_WON_EXPR/GAMES_LOST_EXPR below: exact for every online match
   *  (games.seals0/seals1 via game_players.seat_index) and for any vs-AI
   *  match reported with an explicit split (migration 0004); approximated
   *  1-0/0-1 by `won` for a legacy vs-AI row with no stored split (exact for
   *  the dominant matchLength-1 case). Ranking (rankBySkill below) is fed
   *  THESE numbers, not `games`/`wins`. */
  gamesWon: number
  gamesLost: number
}

export type LeaderboardResponse = {
  /** All matches (or, when a filter was requested, all matches matching that
   *  `opponentType` — a single id, or the union of matches across a
   *  comma-separated LIST of ids, e.g. a "Hard family" aggregate). */
  overall: LeaderboardRow[]
  /** The `source = 'online_authoritative'` SUBSET of `overall` — rule-legal +
   *  server-authoritative, NOT proof of two distinct humans (ADDENDUM T: a
   *  user can self-play two ghost accounts; no collusion mitigation
   *  tonight). Since `archiveMatchEnd` only ever writes
   *  `online_authoritative` rows with `opponent_type='online'` (never an AI
   *  tier — see `do/archive.ts`), filtering by any AI tier id always yields
   *  an EMPTY `verified` (there is nothing to "verify" about a local vs-AI
   *  report); filtering by `'online'` makes `verified` equal to `overall`
   *  (every online match is server-authoritative); leaving the filter off
   *  reproduces the original all-sources-vs-verified-only split. One
   *  uniform rule for every case: `verified` is always "the
   *  online_authoritative rows within whatever `overall` already covers." */
  verified: LeaderboardRow[]
  /** DISTINCT `opponent_type` values with at least one match row — so a
   *  client can show a toggle ONLY for buckets that actually have data.
   *  Present ONLY on the unfiltered call (no `opponentType` passed in) to
   *  save a query on every filtered re-fetch; the unfiltered "All" load is
   *  always the first fetch a client makes, so this never costs an extra
   *  round-trip in practice. */
  availableOpponents?: string[]
}

/**
 * Per-row GAMES resolution, shared by `loadLeaderboardRows` (aggregated via
 * SUM) and `getHistory` (read directly, one row at a time). Requires the
 * caller's own SELECT to ALSO include `GAMES_SPLIT_JOIN` below — these are
 * bare expressions, not full clauses, so they slot into any SELECT list.
 *
 * Resolution order per row (see this file's header + migration
 * 0004_match_game_split.sql for the full rationale):
 *  1. ONLINE (m.game_uuid set AND the game_players join actually found this
 *     account's seat for that game) -> EXACT split from the archive's own
 *     `games.seals0/seals1`, picked by THIS match's own seat_index (a
 *     rematch can flip who's seat 0 — never assumed constant).
 *  2. vs-AI with an explicit `matches.games_won` (migration 0004, written
 *     going forward by reportMatch) -> EXACT.
 *  3. Legacy row (both NULL — every row that existed before migration 0004,
 *     or the rare online row somehow missing its games/game_players join)
 *     -> APPROXIMATED as 1-0/0-1 by `won`. Exact for the dominant
 *     matchLength-1 case; an undercount for a legacy 3/5-game vs-AI match
 *     (no per-round log exists for those to recover the true split from).
 */
const GAMES_WON_EXPR = `
    CASE
      WHEN m.game_uuid IS NOT NULL AND gp.seat_index IS NOT NULL
        THEN CASE WHEN gp.seat_index = 0 THEN g.seals0 ELSE g.seals1 END
      WHEN m.games_won IS NOT NULL THEN m.games_won
      ELSE m.won
    END`

const GAMES_LOST_EXPR = `
    CASE
      WHEN m.game_uuid IS NOT NULL AND gp.seat_index IS NOT NULL
        THEN CASE WHEN gp.seat_index = 0 THEN g.seals1 ELSE g.seals0 END
      WHEN m.games_lost IS NOT NULL THEN m.games_lost
      ELSE (1 - m.won)
    END`

/** The two LEFT JOINs GAMES_WON_EXPR/GAMES_LOST_EXPR depend on — `games` for
 *  the archive's own seals, `game_players` (scoped to THIS account) to
 *  resolve which seat's seals are "mine" for that one match. Both LEFT (not
 *  INNER): a vs-AI row has no `game_uuid` at all and must still return a
 *  row, just falling through to the expressions' NULL branches above. */
const GAMES_SPLIT_JOIN = `
     LEFT JOIN games g ON g.game_uuid = m.game_uuid
     LEFT JOIN game_players gp ON gp.game_uuid = m.game_uuid AND gp.account_id = m.account_id`

type AggRow = {
  account_id: string
  display_name: string | null
  matches: number
  match_wins: number | null
  games_won: number | null
  games_lost: number | null
  avg_delta: number | null
}

async function loadLeaderboardRows(
  db: D1Database,
  opts: { verifiedOnly?: boolean; opponentType?: string | string[] } = {},
): Promise<LeaderboardRow[]> {
  const conditions: string[] = []
  const binds: unknown[] = []
  if (opts.verifiedOnly) conditions.push(`m.source = 'online_authoritative'`)
  const types = Array.isArray(opts.opponentType) ? opts.opponentType : opts.opponentType ? [opts.opponentType] : []
  if (types.length > 0) {
    // A single id or a list (the "Hard family" aggregate — StatsDashboard.tsx's
    // drill-down default) both go through the same `IN (...)` clause; for a
    // single-element list this is SQL-equivalent to `= ?`, so single-id
    // callers see no behavior change.
    conditions.push(`m.opponent_type IN (${types.map(() => '?').join(', ')})`)
    binds.push(...types)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const stmt = db.prepare(
    `SELECT m.account_id AS account_id, COALESCE(p.display_name, 'Player') AS display_name,
            COUNT(*) AS matches, SUM(m.won) AS match_wins,
            SUM(${GAMES_WON_EXPR}) AS games_won, SUM(${GAMES_LOST_EXPR}) AS games_lost,
            AVG(m.player_score - m.opponent_score) AS avg_delta
     FROM matches m
     LEFT JOIN players p ON p.account_id = m.account_id
     ${GAMES_SPLIT_JOIN}
     ${where}
     GROUP BY m.account_id`,
  )
  const { results } = await (binds.length ? stmt.bind(...binds) : stmt).all<AggRow>()

  // Ranked BY account_id (never display_name — ADDENDUM: two players sharing
  // a display name must stay two distinct rows; GROUP BY account_id above
  // already guarantees this structurally).
  const rankable: (RankableRow & {
    accountId: string
    displayName: string
    matches: number
    matchWins: number
    gamesWon: number
    gamesLost: number
  })[] = results.map((r) => {
    const gamesWon = Number(r.games_won ?? 0)
    const gamesLost = Number(r.games_lost ?? 0)
    return {
      accountId: r.account_id,
      displayName: r.display_name ?? 'Player',
      matches: Number(r.matches),
      matchWins: Number(r.match_wins ?? 0),
      gamesWon,
      gamesLost,
      // RankableRow's generic `games`/`wins` — fed the GAMES record (owner's
      // 2026-07-28 ruling: ranking, and the MIN_GAMES_FOR_RANK floor, are now
      // both in GAMES, not matches). rankBySkill's algorithm itself is
      // untouched — only what it's fed changed.
      games: gamesWon + gamesLost,
      wins: gamesWon,
      avg_delta: Number(r.avg_delta ?? 0),
    }
  })

  // Same skill-ranking rule as the app's own leaderboard (qualified-before-
  // unqualified at MIN_GAMES_FOR_RANK, then win rate desc, wins desc, avg
  // score delta desc) — reusing the exact client comparator so the two never
  // drift apart.
  rankable.sort(rankBySkill)

  return rankable.map((r) => ({
    accountId: r.accountId,
    displayName: r.displayName,
    // Compat fields — MATCH totals, unchanged calc/meaning from before this
    // ruling (see LeaderboardRow's docstring).
    games: r.matches,
    wins: r.matchWins,
    winRate: r.matches > 0 ? r.matchWins / r.matches : 0,
    gamesWon: r.gamesWon,
    gamesLost: r.gamesLost,
  }))
}

/** DISTINCT `opponent_type`s with at least one row — the cheap "which
 *  toggles should the client even show" query backing `availableOpponents`.
 *  A single indexed-scan-free `SELECT DISTINCT` over `matches`; exported
 *  separately so a test (or a future dedicated endpoint) can call it without
 *  paying for a full leaderboard load. */
export async function getAvailableOpponentTypes(db: D1Database): Promise<string[]> {
  const { results } = await db.prepare(`SELECT DISTINCT opponent_type FROM matches`).all<{ opponent_type: string }>()
  return results.map((r) => r.opponent_type)
}

/**
 * `GET /stats/leaderboard[?opponentType=]` — see `LeaderboardResponse`'s
 * docstring for exactly what `overall`/`verified` mean in the filtered vs
 * unfiltered case. `opponentType`, when passed, must already be a validated
 * value OR list of values (index.ts's route splits `?opponentType=` on `,`
 * and checks every id via `isValidOpponentTypeFilter` BEFORE calling this —
 * this function does not re-validate, so an unrecognized value here just
 * silently yields empty rows rather than erroring, which is fine for a value
 * that's already known-good by the time it arrives). A list aggregates
 * matches across ALL listed types into one leaderboard — e.g.
 * `['hard2','ismcts','hard','fair']` for StatsDashboard.tsx's "All Hard"
 * family drill-down — via the same GROUP BY account_id + rankBySkill +
 * MIN_GAMES_FOR_RANK-floor pipeline a single id already used.
 */
export async function getLeaderboard(db: D1Database, opponentType?: string | string[]): Promise<LeaderboardResponse> {
  const isFiltered = Array.isArray(opponentType) ? opponentType.length > 0 : !!opponentType
  const [overall, verified] = await Promise.all([
    loadLeaderboardRows(db, { opponentType }),
    loadLeaderboardRows(db, { verifiedOnly: true, opponentType }),
  ])
  if (isFiltered) return { overall, verified }
  const availableOpponents = await getAvailableOpponentTypes(db)
  return { overall, verified, availableOpponents }
}

/** Valid values for the `?opponentType=` leaderboard filter: `'online'`
 *  (human vs human) or any known AI tier id — including RETIRED tiers
 *  (`isValidTierId`'s docstring), which still have real historical rows.
 *  Exported so index.ts's route can 400 on garbage without duplicating the
 *  tier-id check here. */
export function isValidOpponentTypeFilter(id: string): boolean {
  return id === 'online' || isValidTierId(id)
}

// re-exported so a caller (or a test) can cite the exact same qualification
// floor the ranking above uses, without hand-duplicating the constant.
export { MIN_GAMES_FOR_RANK }

// ---- history ------------------------------------------------------------------

export type MatchHistoryRow = {
  id: number
  opponentType: string
  opponentAccountId: string | null
  /** The opponent's display name, resolved via a `players` LEFT JOIN on
   *  `opponentAccountId` — `null` for a local vs-AI report (no
   *  `opponent_account_id` at all) or the rare online match whose opponent
   *  never got a `players` row (see `do/archive.ts`'s upsert-on-every-touch
   *  contract; should be effectively unreachable for a real online match,
   *  but the LEFT JOIN degrades to `null` rather than dropping the row).
   *  Callers (StatsDashboard.tsx's "Online Rivals" table) must fall back to
   *  a truncated `opponentAccountId` display, never show a bare `null`. */
  opponentName: string | null
  playerScore: number
  opponentScore: number
  won: boolean
  source: string
  aiCovered: boolean
  gameUuid: string | null
  timestamp: number
  /** This row's per-GAME split, resolved the same way (and by the same
   *  GAMES_WON_EXPR/GAMES_LOST_EXPR) as `getLeaderboard`'s aggregate —
   *  always present (never null): exact for an online match or an
   *  explicit-split vs-AI report, approximated 1-0/0-1 by `won` for a legacy
   *  vs-AI row. StatsDashboard.tsx's MY RECORDS reads these for its
   *  games-primary display. */
  gamesWon: number
  gamesLost: number
}

type HistoryDbRow = {
  id: number
  opponent_type: string
  opponent_account_id: string | null
  opponent_name: string | null
  player_score: number
  opponent_score: number
  won: number
  source: string
  ai_covered: number
  game_uuid: string | null
  timestamp: number
  games_won: number
  games_lost: number
}

/** The caller's OWN matches, newest first (authed route — index.ts resolves
 *  `accountId` from the Bearer token, never a query param). LEFT JOINs
 *  `players` on `opponent_account_id` to resolve the opponent's real display
 *  name (2026-07-27 fix: "Online Rivals" was showing the rival's raw account
 *  UUID — StatsDashboard.tsx never had a name to render). A LEFT (not INNER)
 *  join so a match with no `opponent_account_id` (a local vs-AI report) or a
 *  not-yet-cached opponent still returns its row, just with `opponentName:
 *  null`. */
export async function getHistory(db: D1Database, accountId: string): Promise<MatchHistoryRow[]> {
  const { results } = await db
    .prepare(
      `SELECT m.id, m.opponent_type, m.opponent_account_id, p.display_name AS opponent_name,
              m.player_score, m.opponent_score, m.won, m.source, m.ai_covered, m.game_uuid, m.timestamp,
              ${GAMES_WON_EXPR} AS games_won, ${GAMES_LOST_EXPR} AS games_lost
       FROM matches m
       LEFT JOIN players p ON p.account_id = m.opponent_account_id
       ${GAMES_SPLIT_JOIN}
       WHERE m.account_id = ? ORDER BY m.timestamp DESC`,
    )
    .bind(accountId)
    .all<HistoryDbRow>()

  return results.map((r) => ({
    id: r.id,
    opponentType: r.opponent_type,
    opponentAccountId: r.opponent_account_id,
    opponentName: r.opponent_name,
    playerScore: r.player_score,
    opponentScore: r.opponent_score,
    won: r.won === 1,
    source: r.source,
    aiCovered: r.ai_covered === 1,
    gameUuid: r.game_uuid,
    timestamp: r.timestamp,
    gamesWon: Number(r.games_won),
    gamesLost: Number(r.games_lost),
  }))
}

// ---- report (client-reported local vs-AI match) --------------------------------

export type ReportMatchBody = {
  opponent_type?: unknown
  player_score?: unknown
  opponent_score?: unknown
  won?: unknown
  timestamp?: unknown
  /** Optional per-move play-by-play (src/store/aiGameLog.ts's
   *  capLogForReport output) — an already-JSON-stringified, client-capped
   *  array. Independently validated by `isValidLogString` below; anything
   *  malformed/oversized is silently skipped (never fails the match
   *  report — see this function's docstring). */
  log?: unknown
  /** Optional exact per-GAME split (migration 0004 — src/store/gameStore.ts's
   *  vs-ai nextRound sends the match's own final `seals` here). Independently
   *  validated by `isSaneGameCount` below; either field failing validation
   *  (or either being absent) skips storing BOTH — never fails the match
   *  report over it (same skip-don't-fail contract as `log`). A row with no
   *  stored split falls back to the 1-0/0-1-by-`won` approximation at read
   *  time (see GAMES_WON_EXPR/GAMES_LOST_EXPR). */
  games_won?: unknown
  games_lost?: unknown
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

/** A sane per-match GAME count: an integer in [0,5] — `matchLength` is
 *  1|3|5 (src/store/gameStore.ts's MatchLength), so the winning side of even
 *  a 5-game match never exceeds 3 and the losing side never exceeds 2; 5 is
 *  a deliberately generous ceiling rather than re-deriving the exact bound
 *  from a `matchLength` this endpoint doesn't itself receive. */
function isSaneGameCount(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 5
}

/**
 * Best-effort `players.last_seen_at` stamp for an account we've just seen
 * demonstrably active (a vs-AI report, an authed `/my-games` poll — see call
 * sites). Only `last_seen_at` is ever written on conflict: this function
 * never has a real display name in hand (only `accountId`), so it must NEVER
 * clobber an existing `display_name` to a placeholder. On a genuinely new
 * account (no prior `players` row) the insert seeds `display_name = NULL`,
 * which every reader already treats as "no name yet" (`COALESCE(...,
 * 'Player')` in `getLeaderboard`/`getRollup`) — a later `archiveGameCreate`/
 * `archiveSeats`/`archiveMatchEnd` touch fills in the real name once the
 * account plays online.
 *
 * NEVER THROWS (matches `do/archive.ts`'s convention for every D1 write that
 * must not be allowed to fail its caller's real work): a D1 hiccup here must
 * never break a match report or block/fail the `/my-games` response.
 */
export async function touchPlayerLastSeen(db: D1Database, accountId: string, now: number): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO players (account_id, display_name, last_seen_at)
         VALUES (?, NULL, ?)
         ON CONFLICT(account_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
      )
      .bind(accountId, now)
      .run()
  } catch {
    // best-effort — see docstring.
  }
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

/** Client-side (src/store/aiGameLog.ts#capLogForReport) targets ~250KB; this
 *  is deliberately a bit more permissive so ordinary client-side rounding/
 *  drift near the boundary never gets rejected here for no real reason. */
const MAX_LOG_BYTES = 300_000

/**
 * `body.log`, if present, must be a JSON-STRING (the client sends it
 * pre-stringified — see capLogForReport) that decodes to an array, within
 * the byte budget. `.length` on the string doubles as the byte count for the
 * same reason it does client-side: every field the client ever emits into
 * this string is ASCII. Anything else (wrong type, too big, not valid JSON,
 * or valid JSON that isn't an array) returns `null` — the caller's contract
 * is to skip storing the log WITHOUT failing the match report over it.
 */
function isValidLogString(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false
  if (raw.length === 0 || raw.length > MAX_LOG_BYTES) return false
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
  } catch {
    return false
  }
}

/**
 * Best-effort `match_logs` insert alongside a freshly-recorded (non-
 * duplicate) `matches` row — see `reportMatch`'s docstring for the dedup and
 * skip-don't-fail contract. NEVER THROWS: a D1 hiccup here must never turn a
 * successful match report into a failure.
 */
async function insertMatchLog(
  db: D1Database,
  accountId: string,
  opponentType: string,
  timestamp: number,
  log: string,
  now: number,
): Promise<void> {
  try {
    await db
      .prepare(`INSERT INTO match_logs (account_id, opponent_type, timestamp, log, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(accountId, opponentType, timestamp, log, now)
      .run()
  } catch {
    // best-effort — see docstring.
  }
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
 *
 * `body.log`, if present and valid (`isValidLogString`), is stored alongside
 * in `match_logs` — the per-move play-by-play AI tuning reads directly from
 * D1 (no API endpoint). An invalid/oversized/garbage log is silently
 * skipped: it NEVER fails the match report itself. A duplicate `matches`
 * insert (retried POST) also skips the log insert — there's nothing new to
 * log, and it would otherwise create a second orphaned log row for the same
 * match.
 *
 * `body.games_won`/`body.games_lost` (migration 0004), if BOTH present and
 * sane (`isSaneGameCount`), are persisted onto the new columns — the exact
 * per-game split for this vs-AI match (src/store/gameStore.ts's nextRound
 * sends the match's own final `seals`). Either one missing or failing
 * validation stores NULL for both (never a half-written split) — same
 * skip-don't-fail contract as `log`; the row still records with its
 * required fields, just falls back to the 1-0/0-1-by-`won` read-time
 * approximation (GAMES_WON_EXPR/GAMES_LOST_EXPR) until a later report (if
 * ever) supplies a real split.
 */
export async function reportMatch(db: D1Database, accountId: string, body: ReportMatchBody): Promise<ReportMatchResult> {
  if (!isValidTierId(body.opponent_type)) return { error: 'invalid_opponent_type' }
  if (!isSaneScore(body.player_score)) return { error: 'invalid_player_score' }
  if (!isSaneScore(body.opponent_score)) return { error: 'invalid_opponent_score' }
  if (typeof body.won !== 'boolean') return { error: 'invalid_won' }
  if (!isSaneTimestamp(body.timestamp)) return { error: 'invalid_timestamp' }

  const hasGamesSplit = isSaneGameCount(body.games_won) && isSaneGameCount(body.games_lost)

  const now = Date.now()
  const result = await db
    .prepare(
      `INSERT INTO matches
         (account_id, opponent_type, opponent_account_id, player_score, opponent_score,
          won, source, ai_covered, game_uuid, timestamp, created_at, games_won, games_lost)
       VALUES (?, ?, NULL, ?, ?, ?, 'client_reported', 0, NULL, ?, ?, ?, ?)
       ON CONFLICT(account_id, timestamp, opponent_type) DO NOTHING`,
    )
    .bind(
      accountId,
      body.opponent_type,
      body.player_score,
      body.opponent_score,
      body.won ? 1 : 0,
      body.timestamp,
      now,
      hasGamesSplit ? body.games_won : null,
      hasGamesSplit ? body.games_lost : null,
    )
    .run()

  const isDuplicateMatch = (result.meta?.changes ?? 0) === 0
  if (!isDuplicateMatch && isValidLogString(body.log)) {
    await insertMatchLog(db, accountId, body.opponent_type, body.timestamp, body.log, now)
  }

  // A local vs-AI player's ONLY server touch is match-end — stamp
  // players.last_seen_at here so "who's recently active" means something for
  // them too, not just online players (who get it from archiveGameCreate/
  // archiveSeats/archiveMatchEnd). Whether this particular report was new or
  // a dedup no-op, the account was still just demonstrably active.
  await touchPlayerLastSeen(db, accountId, now)

  return isDuplicateMatch ? { ok: true, duplicate: true } : { ok: true }
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

/**
 * Wave 4 test-only D1 schema bootstrap. `vitest-pool-workers` does NOT
 * auto-apply `worker/migrations/*.sql` (unlike the DO's own per-boot
 * `runMigrations` against its LOCAL SQLite) — production applies migrations
 * via `wrangler d1 migrations apply vjaipur --remote`; tests instead call
 * `applyD1Schema(env.DB)` once in a `beforeAll`, mirroring viota's
 * `packages/worker/src/d1/schema.ts` + `test/d1-schema.test.ts` pattern.
 *
 * These statements MUST stay byte-equivalent (ignoring whitespace) to
 * `worker/migrations/0001_init.sql` — that file (Wave 2's, not ours to edit)
 * is the real source of truth applied in production; this is a same-shape
 * TS mirror for the miniflare D1 binding, which offers no "run this .sql
 * file" primitive from inside the workerd test sandbox (no `node:fs`).
 * `CREATE TABLE/INDEX IF NOT EXISTS` makes every statement idempotent, so
 * re-applying (e.g. once per test file, since D1 storage is shared across
 * files per `vitest.config.ts`'s `fileParallelism:false`/`isolate:false`) is
 * always a harmless no-op.
 *
 * `db.exec()` splits its input on newlines and runs each line as its own
 * statement (a D1/`workerd` quirk — see viota's `d1/schema.ts` docstring),
 * so every multi-line `CREATE` below is collapsed to one line before exec.
 */

import type { MetaRow, SeatRow } from '../src/do/storage'

const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS games (
     game_uuid        TEXT PRIMARY KEY,
     code             TEXT,
     status           TEXT NOT NULL,
     match_length     INTEGER NOT NULL,
     seals0           INTEGER DEFAULT 0,
     seals1           INTEGER DEFAULT 0,
     winner_seat      INTEGER,
     source           TEXT NOT NULL DEFAULT 'online_authoritative',
     engine_version   TEXT,
     created_at       INTEGER,
     last_activity_at INTEGER,
     ended_at         INTEGER
   )`,
  `CREATE INDEX IF NOT EXISTS idx_games_code ON games(code)`,
  `CREATE TABLE IF NOT EXISTS game_players (
     game_uuid        TEXT,
     seat_index       INTEGER,
     account_id       TEXT,
     display_name     TEXT,
     ai_covered_moves INTEGER DEFAULT 0,
     result           TEXT,
     PRIMARY KEY (game_uuid, seat_index)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_gp_account ON game_players(account_id)`,
  `CREATE TABLE IF NOT EXISTS moves (
     game_uuid       TEXT,
     move_index      INTEGER,
     round           INTEGER,
     seat_index      INTEGER,
     type            TEXT,
     payload         TEXT,
     by_ai           INTEGER,
     ai_difficulty   TEXT,
     client_move_id  TEXT,
     reverted        INTEGER DEFAULT 0,
     created_at      INTEGER,
     PRIMARY KEY (game_uuid, move_index)
   )`,
  `CREATE TABLE IF NOT EXISTS players (
     account_id   TEXT PRIMARY KEY,
     display_name TEXT,
     last_seen_at INTEGER
   )`,
  `CREATE TABLE IF NOT EXISTS matches (
     id                  INTEGER PRIMARY KEY AUTOINCREMENT,
     account_id          TEXT NOT NULL,
     opponent_type       TEXT NOT NULL,
     opponent_account_id TEXT,
     player_score        INTEGER NOT NULL,
     opponent_score      INTEGER NOT NULL,
     won                 INTEGER NOT NULL,
     source              TEXT NOT NULL,
     ai_covered          INTEGER DEFAULT 0,
     game_uuid           TEXT,
     timestamp           INTEGER NOT NULL,
     created_at          INTEGER NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_dedup ON matches(account_id, timestamp, opponent_type)`,
  `CREATE INDEX IF NOT EXISTS idx_matches_account ON matches(account_id)`,
  // Migration 0002 — per-move game logging (worker/migrations/0002_match_logs.sql).
  `CREATE TABLE IF NOT EXISTS match_logs (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     account_id    TEXT NOT NULL,
     opponent_type TEXT NOT NULL,
     timestamp     INTEGER NOT NULL,
     log           TEXT NOT NULL,
     created_at    INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_mlogs_acct ON match_logs(account_id)`,
  `CREATE INDEX IF NOT EXISTS idx_mlogs_type ON match_logs(opponent_type)`,
  // Migration 0003 — "MY STYLE" incremental cache (worker/migrations/0003_style_cache.sql).
  `CREATE TABLE IF NOT EXISTS style_cache (
     account_id   TEXT NOT NULL,
     tier         TEXT NOT NULL,
     last_log_id  INTEGER NOT NULL,
     agg          TEXT NOT NULL,
     updated_at   INTEGER NOT NULL,
     PRIMARY KEY (account_id, tier)
   )`,
]

/**
 * Migration 0004 (worker/migrations/0004_match_game_split.sql) is an ALTER
 * TABLE, not a CREATE — SQLite has no `ADD COLUMN IF NOT EXISTS`, so (unlike
 * every `CREATE TABLE/INDEX IF NOT EXISTS` statement above) simply
 * re-running it on a second `applyD1Schema` call — which happens in
 * practice, since D1 storage is shared across test FILES per this file's own
 * docstring (`fileParallelism:false`/`isolate:false`), and every stats-
 * adjacent test file calls `applyD1Schema` in its own `beforeAll` — would
 * throw "duplicate column name". Guarded the same way `wrangler d1
 * migrations apply` guards a real migration re-run: check first via `PRAGMA
 * table_info`, only ALTER if the column is actually missing. `table`/
 * `column` are always this file's own hardcoded literals (never external
 * input), so inlining them into the PRAGMA (which — unlike a normal query —
 * cannot bind `?` parameters) is safe.
 */
async function addColumnIfMissing(db: D1Database, table: string, column: string, ddl: string): Promise<void> {
  const { results } = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()
  if (results.some((r) => r.name === column)) return
  await db.exec(ddl)
}

export async function applyD1Schema(db: D1Database): Promise<void> {
  for (const stmt of SCHEMA_STATEMENTS) {
    await db.exec(stmt.replace(/\s+/g, ' ').trim())
  }
  // Migration 0004 — per-match GAME split (worker/migrations/0004_match_game_split.sql).
  await addColumnIfMissing(db, 'matches', 'games_won', 'ALTER TABLE matches ADD COLUMN games_won INTEGER')
  await addColumnIfMissing(db, 'matches', 'games_lost', 'ALTER TABLE matches ADD COLUMN games_lost INTEGER')
}

// =============================================================================
// Shared D1 fixture helpers — consolidated from near-identical copies that
// used to live in stats.test.ts, rivalry.test.ts (as `seedMatchRow`), and
// style.test.ts. D1 storage (and, separately, each `it()`'s DO-local SQLite)
// is shared across test FILES in this run (vitest.config.ts's
// `fileParallelism:false`/`isolate:false`), so every seeded row needs an
// identifier that can't collide with another file's fixtures.
// =============================================================================

let acctCtr = 0

/** A globally-unique account id per call, so assertions never collide with
 *  rows other test files (or other `it`s in this shared-D1 run) may have
 *  written. */
export function acct(prefix: string): string {
  return `${prefix}-${Date.now()}-${acctCtr++}`
}

export interface SeedMatch {
  accountId: string
  opponentType?: string
  opponentAccountId?: string | null
  /** Defaults to 10 (style.test.ts's original convenience default) — every
   *  other call site (stats.test.ts's) always passes both scores explicitly. */
  playerScore?: number
  /** Defaults to 5 — see `playerScore`. */
  opponentScore?: number
  won: boolean
  source?: string
  aiCovered?: boolean
  gameUuid?: string | null
  timestamp: number
  /** Migration 0004's per-match GAME split — omitted (both stay NULL) mirrors
   *  every legacy row that predates the migration; a test seeding a fresh
   *  vs-AI report with an explicit split passes both. */
  gamesWon?: number | null
  gamesLost?: number | null
}

/** Seeds a `matches` row. */
export async function seedMatch(db: D1Database, m: SeedMatch): Promise<void> {
  await db
    .prepare(
      `INSERT INTO matches
         (account_id, opponent_type, opponent_account_id, player_score, opponent_score,
          won, source, ai_covered, game_uuid, timestamp, created_at, games_won, games_lost)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      m.accountId,
      m.opponentType ?? 'online',
      m.opponentAccountId ?? null,
      m.playerScore ?? 10,
      m.opponentScore ?? 5,
      m.won ? 1 : 0,
      m.source ?? 'online_authoritative',
      m.aiCovered ? 1 : 0,
      m.gameUuid ?? null,
      m.timestamp,
      m.timestamp,
      m.gamesWon ?? null,
      m.gamesLost ?? null,
    )
    .run()
}

export interface SeedGame {
  gameUuid: string
  code?: string | null
  status?: string
  /** Required — `null` (an unresolved/abandoned game) is a meaningfully
   *  different value from "omitted", so this can't default via `??`. */
  winnerSeat: number | null
  seals0?: number
  seals1?: number
  createdAt?: number
  endedAt?: number
}

/** Seeds a `games` row (the online-match archive, keyed by `game_uuid`). */
export async function seedGame(db: D1Database, opts: SeedGame): Promise<void> {
  const now = Date.now()
  const createdAt = opts.createdAt ?? now
  await db
    .prepare(
      `INSERT INTO games (game_uuid, code, status, match_length, seals0, seals1, winner_seat, source, engine_version, created_at, last_activity_at, ended_at)
       VALUES (?, ?, ?, 3, ?, ?, ?, 'online_authoritative', 'v1', ?, ?, ?)`,
    )
    .bind(
      opts.gameUuid,
      opts.code ?? null,
      opts.status ?? 'completed',
      opts.seals0 ?? 0,
      opts.seals1 ?? 0,
      opts.winnerSeat,
      createdAt,
      createdAt, // last_activity_at mirrors created_at — no fixture here ever needs them to differ.
      opts.endedAt ?? now,
    )
    .run()
}

/** Seeds a `game_players` seat row for `seedGame`'s `games` row. */
export async function seedSeat(
  db: D1Database,
  gameUuid: string,
  seatIndex: number,
  accountId: string,
  displayName = 'Seated Player',
): Promise<void> {
  await db
    .prepare(`INSERT INTO game_players (game_uuid, seat_index, account_id, display_name) VALUES (?, ?, ?, ?)`)
    .bind(gameUuid, seatIndex, accountId, displayName)
    .run()
}

/** Seeds/updates a `players` row (upserts `display_name` on conflict). */
export async function seedPlayer(db: D1Database, accountId: string, displayName: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO players (account_id, display_name, last_seen_at)
       VALUES (?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET display_name = excluded.display_name`,
    )
    .bind(accountId, displayName, Date.now())
    .run()
}

// =============================================================================
// GameRepository fixture defaults — consolidated from near-identical copies
// in foundation.test.ts and archive.test.ts (its `game_uuid` used
// `crypto.randomUUID()` rather than a fixed literal, since archive.test.ts's
// rows also land in shared D1 tables; foundation.test.ts's one call site that
// relied on a fixed default now passes `{ game_uuid: 'uuid-xyz' }` explicitly).
// =============================================================================

export function baseMeta(overrides: Partial<MetaRow> = {}): MetaRow {
  return {
    game_uuid: crypto.randomUUID(),
    code: null,
    status: 'active',
    player_count: 2,
    match_length: 3,
    seals0: 0,
    seals1: 0,
    round: 1,
    phase: 'playing',
    current_seat: 0,
    move_index: 0,
    winner_seat: null,
    engine_version: 'engine-test',
    last_processed_at: null,
    ...overrides,
  }
}

export function baseSeat(overrides: Partial<SeatRow> = {}): SeatRow {
  return {
    seat_index: 0,
    owner_type: 'human',
    owner_account_id: 'acct-0',
    display_name: 'P0',
    controlled_by_ai: false,
    ai_difficulty: null,
    last_seen_at: null,
    disconnected_at: null,
    ...overrides,
  }
}

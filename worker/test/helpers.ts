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
]

export async function applyD1Schema(db: D1Database): Promise<void> {
  for (const stmt of SCHEMA_STATEMENTS) {
    await db.exec(stmt.replace(/\s+/g, ' ').trim())
  }
}

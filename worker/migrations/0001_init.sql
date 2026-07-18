-- vjaipur D1 analytics archive — migration 0001 (initial schema).
--
-- This is the DURABLE, QUERYABLE archive (registry + move-log + stats). The
-- DO-local SQLite (worker/src/do/storage.ts) is the authoritative LIVE truth
-- for any one game; this D1 database is written through via ctx.waitUntil
-- (Wave 4 do/archive.ts) and can be fully rebuilt by replaying the DO move
-- logs if it is ever dropped. Apply with:
--
--   wrangler d1 migrations apply vjaipur --remote
--
-- Design spec §6, MINUS quick-match (ADDENDUM A cut MatchmakerDO tonight).

-- Per-game archive row + the lobby registry. `code` is the human room code
-- (code -> game_uuid resolution); `last_activity_at` + `status` drive the
-- cron stale-game sweep. `source` is forced server-side
-- ('online_authoritative' for DO games).
CREATE TABLE IF NOT EXISTS games (
  game_uuid        TEXT PRIMARY KEY,
  code             TEXT,
  status           TEXT NOT NULL,      -- waiting|active|completed|resigned|abandoned
  match_length     INTEGER NOT NULL,   -- 1|3|5
  seals0           INTEGER DEFAULT 0,
  seals1           INTEGER DEFAULT 0,
  winner_seat      INTEGER,            -- 0|1, set at match_over/resign
  source           TEXT NOT NULL DEFAULT 'online_authoritative',
  engine_version   TEXT,
  created_at       INTEGER,
  last_activity_at INTEGER,
  ended_at         INTEGER
);
CREATE INDEX IF NOT EXISTS idx_games_code ON games(code);

-- Per-seat ownership at game time. The index on account_id is THE
-- cross-session analytics join.
CREATE TABLE IF NOT EXISTS game_players (
  game_uuid        TEXT,
  seat_index       INTEGER,
  account_id       TEXT,
  display_name     TEXT,
  ai_covered_moves INTEGER DEFAULT 0,
  result           TEXT,               -- win|loss|null
  PRIMARY KEY (game_uuid, seat_index)
);
CREATE INDEX IF NOT EXISTS idx_gp_account ON game_players(account_id);

-- The append-only move log IS the warehouse: complete and replayable.
-- `payload` is the TRANSLATED PUBLIC payload (ADDENDUM H) — never a raw
-- action that would require the private hand array to interpret.
CREATE TABLE IF NOT EXISTS moves (
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
);

-- Display-name cache for boards/leaderboards. Every authenticated touch
-- upserts this (best-effort, waitUntil) — see design spec §2.
CREATE TABLE IF NOT EXISTS players (
  account_id   TEXT PRIMARY KEY,
  display_name TEXT,
  last_seen_at INTEGER
);

-- THE stats table (migrated legacy Supabase rows + new online-authoritative
-- rows). One row per human seat per finished match.
CREATE TABLE IF NOT EXISTS matches (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id          TEXT NOT NULL,
  opponent_type       TEXT NOT NULL,   -- tier id ('easy','medium','fair','hard3',
                                        -- legacy ids) or 'online' (ADDENDUM S)
  opponent_account_id TEXT,            -- for online human games
  player_score        INTEGER NOT NULL,
  opponent_score       INTEGER NOT NULL,
  won                 INTEGER NOT NULL,
  source              TEXT NOT NULL,   -- 'online_authoritative' | 'client_reported'
  ai_covered          INTEGER DEFAULT 0, -- online: my seat had AI-covered moves
  game_uuid           TEXT,            -- online games link back to `games`
  timestamp           INTEGER NOT NULL,
  created_at          INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_dedup ON matches(account_id, timestamp, opponent_type);
CREATE INDEX IF NOT EXISTS idx_matches_account ON matches(account_id);

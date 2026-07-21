-- vjaipur D1 analytics archive — migration 0002 (per-move game logging).
--
-- Per-move play-by-play for LOCAL vs-AI matches only (see
-- src/store/aiGameLog.ts client-side, worker/src/do/stats.ts#reportMatch
-- server-side) — captured so AI-tuning can analyze real human-vs-bot games
-- instead of only the win/loss/score summary `matches` already stores.
-- `log` is a JSON-encoded array (the client's capped/serialized
-- src/store/aiGameLog.ts#AiLogEntry[]), stored verbatim as TEXT — this table
-- is read directly via `wrangler d1 execute`/local tooling, no API endpoint.
--
-- Apply with:
--
--   wrangler d1 migrations apply vjaipur --remote

CREATE TABLE IF NOT EXISTS match_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id    TEXT NOT NULL,
  opponent_type TEXT NOT NULL,   -- AI tier id the log was played against
  timestamp     INTEGER NOT NULL, -- matches the paired `matches` row's timestamp
  log           TEXT NOT NULL,   -- JSON-encoded AiLogEntry[] (see src/store/aiGameLog.ts)
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mlogs_acct ON match_logs(account_id);
CREATE INDEX IF NOT EXISTS idx_mlogs_type ON match_logs(opponent_type);

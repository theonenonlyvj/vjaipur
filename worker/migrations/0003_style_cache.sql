-- vjaipur D1 analytics archive — migration 0003 ("MY STYLE" incremental cache).
--
-- Backs GET /stats/my-style?tier=<tierId> (worker/src/do/style.ts): one
-- cached, MERGEABLE aggregate per (account, tier) so re-opening the tab
-- never re-scans a player's whole match_logs history — only rows with
-- id > last_log_id (since the last read) are folded in. This works because
-- src/shared/styleAgg.ts's aggregateGame/mergeStyleAgg are associative: a
-- cached agg merged with just the NEW rows is always exactly equal to
-- aggregating the whole history from scratch.
--
-- ZERO IDLE COMPUTE: this table is only ever written from inside
-- do/style.ts#getMyStyle, which only ever runs on an authed GET to
-- /stats/my-style — there is no hook anywhere at match-end (reportMatch in
-- do/stats.ts never touches this table). A player who never opens the "MY
-- STYLE" tab never causes a single row to be written here.
--
-- Apply with:
--
--   wrangler d1 migrations apply vjaipur --remote

CREATE TABLE IF NOT EXISTS style_cache (
  account_id   TEXT NOT NULL,
  tier         TEXT NOT NULL,   -- AI tier id the cached agg is scoped to (match_logs.opponent_type)
  last_log_id  INTEGER NOT NULL, -- highest match_logs.id already folded into `agg`
  agg          TEXT NOT NULL,   -- JSON-encoded src/shared/styleAgg.ts StyleAgg
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (account_id, tier)
);

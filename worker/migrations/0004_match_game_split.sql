-- vjaipur D1 analytics archive — migration 0004 (per-match GAME split).
--
-- Owner's GAMES-first vocabulary ruling (2026-07-28, see worker/src/do/
-- rivalry.ts's file header for the full rationale): a GAME is one deal/round
-- — what produces a score and awards a seal; a MATCH is the best-of-N
-- sitting wrapper `matches` already rows one-per (design spec §6). GAMES are
-- now the lifetime stat surfaced by the leaderboard/history/MY-RECORDS
-- boards (worker/src/do/stats.ts); MATCHES stay secondary context.
--
-- These two NULLABLE columns let a client-reported vs-AI `matches` row carry
-- its OWN exact per-game split going forward (worker/src/do/stats.ts#reportMatch),
-- so query-time reads (getLeaderboard/getHistory) can resolve every row's
-- games_won/games_lost. Online rows never need these written here at all —
-- their exact split is already independently derivable at query time from
-- `games.seals0/seals1` joined through `game_players.seat_index` (see
-- stats.ts's GAMES_WON_EXPR/GAMES_LOST_EXPR). A legacy vs-AI row (both
-- columns left NULL — every row that existed before this migration) falls
-- back to a 1-0/0-1 approximation by `won` — exact for the dominant
-- matchLength-1 case, an undercount for any legacy 3/5-game vs-AI match.
--
-- Apply with:
--
--   wrangler d1 migrations apply vjaipur --remote

ALTER TABLE matches ADD COLUMN games_won INTEGER;
ALTER TABLE matches ADD COLUMN games_lost INTEGER;

/**
 * Never-stall protocol constants (design spec §3.6, ADDENDUM L). One shared
 * module so every deadline uses the same value and there is a single place to
 * tune them. Ported from viota's packages/worker/src/do/constants.ts with the
 * Jaipur/ADDENDUM-L overrides called out below.
 *
 * All of these are DURATIONS in milliseconds; every actual deadline is a
 * server-side storage column (a `timers` row), never a client timer.
 */

/** Presence window: a seat is "present" iff last_seen_at is within this.
 *  Same as viota's. See ADDENDUM Q: heartbeat runs for the WHOLE online-match
 *  lifetime (a top-level hook, not a per-screen effect) so this window is
 *  meaningful even while a player sits on RoundEndScreen. */
export const PRESENCE_MS = 45_000

/** Off-turn disconnect grace before an absent seat is AI-covered. Named
 *  OFF_TURN_GRACE_MS (viota calls the equivalent constant GRACE_MS) per
 *  ADDENDUM L, to read unambiguously next to AWAY_TURN_MS below.
 *
 *  DORMANT (owner's decision, 2026-07-18): nothing arms a `'grace'` timer in
 *  live play anymore (it was already unreachable pre-existing — see
 *  do/presence.ts's file header) — kept for interface parity only. */
export const OFF_TURN_GRACE_MS = 120_000

/** On-turn fast-track: a disconnected seat that is ON turn is covered faster,
 *  so the present opponent is never held hostage by one locked phone.
 *  ADDENDUM L: fixed at 60s DIRECTLY (no host-configurable patience tonight —
 *  quick-match/host config is gone, 2p only, keep it simple). Wired for real:
 *  do NOT reintroduce a meta.ai_takeover_ms column.
 *
 *  DORMANT (owner's decision, 2026-07-18): `armDisconnectCoverIfAbsent`
 *  (do/presence.ts), the only function that ever read this, is no longer
 *  called by any live handler — an absent on-turn seat now simply PAUSES the
 *  game (see `CLAIM_GRACE_MS` below for the present player's new
 *  resolution). The function and this constant stay defined (still
 *  unit-tested, still available for a possible future AI/lobby mode) but are
 *  otherwise inert in production. */
export const AWAY_TURN_MS = 60_000

/** NEW (ADDENDUM J): round_end liveness. When a move ends a round
 *  (MatchState.phase -> 'round_end'), a `round_wait` timer is armed per
 *  absent-human seat at `now + ROUND_WAIT_MS`. If EITHER seat's deadline
 *  expires, the DO auto-advances the round on its own (calls the internal
 *  next-round-advance path directly) so a present player is never stuck
 *  waiting on an absent one to press Continue. See do/timers.ts (Wave 3):
 *  its `TimerKind` union must add `'round_wait'` alongside
 *  'grace' | 'turn' | 'ai_step' | 'heal' | 'soft' — the SQLite CHECK
 *  constraint for it already lives in do/storage.ts's `timers` table
 *  (this Wave), so Wave 3 only needs to widen the TS union to match.
 *
 *  DORMANT (owner's decision, 2026-07-18): same story as `AWAY_TURN_MS`
 *  above — `armRoundWaitIfAbsent` is no longer called by any live handler,
 *  so nothing arms a `'round_wait'` timer anymore; round_end now pauses on
 *  an absent seat exactly like `'playing'` does. Function + constant stay
 *  defined/unit-tested, otherwise inert in production. */
export const ROUND_WAIT_MS = 45_000

/** Self-tick cadence for the `heal` alarm (abandon check + re-drive safety).
 *  Copied from viota's HEAL_MS verbatim. */
export const HEAL_MS = 60_000

/** AI pacing between chained drive steps (humans see each play land, never a
 *  synchronous loop). Copied from viota's AI_STEP_MS verbatim (Wave 3). */
export const AI_STEP_MS = 800

/** Zero humans present for this long → the cron sweep pokes the game's DO.
 *  Copied from viota's ABANDON_MS verbatim (short, so a genuinely dead table
 *  is re-driven/checked promptly). */
export const ABANDON_MS = 600_000

/** Zero humans present for THIS long → a live game is truly abandoned. Long
 *  (~7 days) so a paused game survives "come back tomorrow": zero humans just
 *  FREEZES the game; it only abandons after this window. This is the
 *  never-forfeit fix (ADDENDUM: "NO auto-forfeit anywhere"; abandonment is
 *  the only terminal state absence alone can reach, and it has no winner). */
export const PAUSE_ABANDON_MS = 7 * 24 * 60 * 60 * 1000

/** A WAITING room made but never joined for THIS long (~2h) → the cron marks
 *  it abandoned (drops it out of resolve-by-code). Copied from viota
 *  verbatim; Jaipur's create-room + join replaces viota's create+start
 *  ceremony (design spec §3.8) but an unclaimed room can still go stale. */
export const WAITING_ABANDON_MS = 2 * 60 * 60 * 1000

/** NEW (owner's decision, 2026-07-18): "opponent ghosted" resolution grace.
 *  Vijay does NOT want an AI ever taking over a seat and finishing a match
 *  wearing the absent player's name (muddies stats, reads as them still
 *  "playing") — see `game-do.ts`'s `handleClaimWin`. A genuinely absent
 *  player's turn now simply PAUSES the game (no AI takeover, no auto-move);
 *  the present player's only resolution is `POST /claim-win`, and ONLY once
 *  the opponent has been continuously absent (not merely `!seatIndexPresent`
 *  — see `PRESENCE_MS`) for at least this much LONGER on top of that, so a
 *  brief network blip/backgrounded-tab reconnect can never be raced into a
 *  stolen win. Deliberately its OWN constant, not reused from
 *  AWAY_TURN_MS/ROUND_WAIT_MS — those drove auto-cover/auto-advance, which no
 *  longer exist; this drives a human-initiated claim instead and has no
 *  reason to share their tuning. */
export const CLAIM_GRACE_MS = 60_000

/** Sentinel seat for seat-agnostic timers (e.g. `heal`) and for server-minted
 *  moves not tied to one human seat (e.g. `round_start`). The `timers` PK is
 *  (kind, seat); a real seat is >= 0, so -1 never collides. NULL is avoided
 *  because SQLite treats NULLs as distinct in a UNIQUE/PK index, which would
 *  break ON CONFLICT upserts. Copied from viota verbatim. */
export const GLOBAL_SEAT = -1

// ---- Deliberately DROPPED from viota (ADDENDUM L) --------------------------
//
// AI_TAKEOVER_ALLOWED_MS / DEFAULT_AI_TAKEOVER_MS / the whole host-configurable
// AI-takeover-patience concept: quick-match and host-config are both gone
// tonight (2 players always, friends play via create-room + code), so
// AWAY_TURN_MS above is a fixed constant, not a per-game meta column. Do NOT
// resurrect a `meta.ai_takeover_ms` column in do/storage.ts.
//
// SOFT_TURN_MS: viota already marks this RETIRED (a CONNECTED player is NEVER
// auto-covered no matter how long they think) and keeps it only for
// backward-compat with pre-existing timer rows in an older viota DO
// generation. vjaipur has no legacy data to be compatible with, so the
// constant itself is dropped here — but 'soft' is still a valid `timers.kind`
// in do/storage.ts's CHECK constraint (copied verbatim from viota's schema
// shape) in case a future wave needs it.

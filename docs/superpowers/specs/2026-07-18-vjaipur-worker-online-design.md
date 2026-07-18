# vjaipur-worker: server-authoritative online — design spec

**Status: LOCKED for tonight's build (2026-07-18), after red-team council.**
Author: Claude. Owner decisions (Vijay 2026-07-18): own worker + own D1; cut over
tonight if green; keep per-tier stats across the cutover.

This is a PORT of viota's proven production architecture
(`viota/packages/worker` — spec `viota/docs/superpowers/specs/2026-07-06-viota-online-BEST-architecture.md`)
with Jaipur-specific adaptations. Where this doc is silent, **do what viota's
worker does** — build agents should read the corresponding viota file before
writing the vjaipur one.

## 0. Goals / non-goals

Goals: kill score forgery, hand/deck leaks, false forfeits, game loss on
restart, seat spoofing, and relay DoS — structurally. Games are durable,
resumable, and never stall.
Non-goals tonight: online-vs-AI mode; spectating; tournaments; retiring the
Render Socket.IO server (it keeps running for old tabs; client just stops
using it).

## 1. Topology

- **New Cloudflare Worker** `vjaipur-worker` living in `vjaipur/worker/`
  (own `package.json`, `wrangler.toml`, `vitest.config`), deployed to
  `https://vjaipur-worker.theonenonlyvj.workers.dev`.
- **One SQLite-backed Durable Object per game** (`GameDO`,
  `new_sqlite_classes`) + a singleton `MatchmakerDO` for quick-match.
- **Own D1 database `vjaipur`** (registry + archive + stats). Identity stays
  the shared `vgames-identity` service — this worker only *verifies* tokens.
- Client (Render static site) talks HTTP-first to the worker; WS is a nudge.
- Engine: **import vjaipur's certified `src/engine` via relative imports**
  (`../src/engine/...` from `worker/src/`) — pure TS, no deps; esbuild/wrangler
  bundles it. Same for `src/ai/mediumAi.ts` (+ its imports) for AI-cover, and
  `src/shared/rng.ts`. Engine files are NOT modified.

## 2. Auth (differs from viota — no shared JWT secret)

viota's worker verifies JWTs locally (it co-hosts identity). vjaipur-worker
instead **introspects**: `POST {env.VGAMES_URL}/auth/introspect {token}` →
`{valid, accountId, status, displayName}`. Rules:
- Fail-closed (invalid/network error/`status==='merged'` → 401), mirroring
  `server/vgamesAuth.ts`.
- **Cache** introspection results keyed by SHA-256(token): worker-isolate Map
  AND DO-local Map, TTL = 5 minutes (well under the 1h/24h token TTLs).
  Cache only positive results.
- `requireAuth(request)` reads `Authorization: Bearer` and returns
  `{accountId, displayName}` or a 401 Response. The acting account is ALWAYS
  token-derived, never a body field (viota rule).
- Every authenticated touch upserts `players(account_id, display_name,
  last_seen_at)` in D1 (best-effort, waitUntil) so leaderboards can label rows.

## 3. Game model (the Jaipur adaptation)

### 3.1 Match state (the DO snapshot)

The DO's snapshot is a **MatchState wrapper**, not a bare engine state:

```ts
type MatchState = {
  game: GameState            // vjaipur engine state for the CURRENT round
  seals: [number, number]
  round: number              // 1-based
  matchLength: 1 | 3 | 5     // sealsNeeded = floor(matchLength/2)+1
  phase: 'playing' | 'round_end' | 'match_over'
  lastRoundResult: RoundResult | null   // engine scoreRound output for round_end UI
  winnerSeat: 0 | 1 | null   // set at match_over (or via resign)
}
```

Build agents MUST first read `src/store/gameStore.ts` to discover exactly how
the client currently detects round end and advances rounds (seals logic,
`startNextRound`, engine `phase`/round-over signal) and mirror that logic
server-side — the DO now owns it. The engine remains the sole rules gate.

### 3.2 Rounds, seeds, determinism

- On deal (game start and each next round): the DO mints a round seed from
  `crypto.getRandomValues` and calls the engine's setup (same path the client
  uses today, discovered from gameStore). **The seed never leaves the DO.**
- Persist per round: `rounds(round, seed, initial_state_json)` in DO SQLite.
  The engine is deterministic given the seed (bonus-token draws ride the
  seeded rng inside GameState) → replay = per round `setup(seed)` + moves.
  Build agents must VERIFY this determinism claim against the engine (one
  test: setup+moves replayed twice ⇒ identical state); if any nondeterminism
  exists, persist `initial_state` and replay from it instead of the seed.
- Move log is continuous across rounds; each move row records `round`.
  Round/match lifecycle rows are server-minted moves with types
  `round_start`, `round_end`, `resign` (payload = seals/result), so the log
  fully narrates the match.

### 3.3 Actions

`POST /move` body: `{seatIndex, move: Action, clientMoveId}` where `Action` is
the engine's union (TAKE_SINGLE / TAKE_CAMELS / TAKE_EXCHANGE / SELL — read
`src/engine/types.ts` for exact shapes). `validateMovePayloadShape` port:
type allowlist + integer bounds on every index array (engine now also guards,
defense in depth). Apply pipeline = viota's `do/apply.ts` VERBATIM ordering
(status → authz → idempotency → reclaim-race guard → turn → engine → derive →
write move-first). After a committed move, the DO checks for round end; if the
round ended it, in the SAME transactionSync span, appends the server-minted
`round_end` move (with scoreRound result + seal updates) and either flips
`phase:'round_end'` or `match_over`. No `wild_recycle` analog exists in
Jaipur — every move consumes the turn.

### 3.4 Round advance

`POST /next-round` (authed, seat owner, only in `phase:'round_end'`):
idempotent per round (second caller gets benign `{already:true}` + view). First
caller triggers the next deal (server-minted `round_start` move + new
`rounds` row) and a nudge. `match_over` → 409.

### 3.5 Resign (replaces FORCE_FORFEIT)

`POST /resign` (authed seat owner, any phase before `match_over`): marks
`match_over`, `winnerSeat = other seat`, appends server-minted `resign` move,
archives + writes stats (`result` via resignation). Idempotent. The client
offers "Resign match" behind a confirm.

### 3.6 Presence / never-stall / cover (port viota wholesale)

Port `do/presence.ts`, `do/timers.ts`, `do/drive.ts`, `do/constants.ts`, the
alarm handler, heal tick, eviction-gap credit, CPU-kill floor, `/heartbeat`,
`/reclaim`, `/veto` — with these Jaipur constants/changes:
- 2 players always. AI-cover uses **`pickMediumAction` from `src/ai/mediumAi.ts`**
  (pure import). Verify it's workerd-safe (no DOM/worker APIs) with a test.
- `DEFAULT_AI_TAKEOVER_MS = 60_000` for an absent ON-TURN seat; off-turn grace
  120s (viota's). No host-configurable patience tonight (2p; keep it simple) —
  drop `ai_takeover_ms` from create.
- The CPU-kill floor move: Jaipur has no "pass". The O(1) always-legal floor is
  **TAKE_CAMELS if any camel is in market, else TAKE_SINGLE of the lowest-value
  market good (respecting the 7-card hand limit), else SELL of the largest
  legal hand group**. Build a `floorMove(state)` helper + test that it's legal
  in EVERY reachable state (fuzz: assert getLegalActions non-empty and
  floorMove ∈ legal for 1000 random states; Jaipur always has a legal move —
  verify with the engine's own getLegalActions).
- `phase:'round_end'` liveness: if one player is absent past cover deadline,
  the DO auto-advances the round on their behalf (server calls next-round) —
  a present player is never stuck waiting on an absent one to press Continue.
- **NO auto-forfeit anywhere.** Absence ⇒ AI cover + reclaim/veto on return;
  abandonment (both absent > 7 days) ⇒ `abandoned` (cron), no winner. This is
  the never-forfeit fix for the #1 complaint.
- Veto: port as-is (revert trailing AI run on your own seat, replay rebuild).
  Jaipur replay within the current round: `setup(round seed)` + that round's
  non-reverted moves; earlier rounds are sealed by their `round_end` rows.

### 3.7 Redaction (`do/view.ts` port)

```ts
type ClientView = {
  mySeat: 0|1
  phase, round, seals, matchLength, winnerSeat,
  lastRoundResult: RoundResult | null       // full (round_end/match_over only)
  game: {
    market: Card[]                          // public
    myHand: Card[]                          // full
    oppHandCount: number                    // count ONLY
    herds: [number, number]                 // public
    tokens: TokenPiles                      // public
    myBonusTokens: BonusToken[]             // full (values)
    oppBonusTokens: { tier: 3|4|5 }[]       // tier ONLY, never values
    deckCount: number                       // count ONLY
    myScore: number                         // own running total
    activePlayer: 0|1
    // ...whatever else the UI needs, discovered from GameScreen — but NEVER
    // opp hand cards, deck contents/order, seed, opp bonus values, opp score
    // mid-round (scores reveal bonus values; scores go public in lastRoundResult)
  }
  players: [{seat, displayName, accountId?, present, controlledByAi}, ...]
  coveredMoves: number[]                    // trailing AI-run indices on MY seat (veto affordance)
}
```
Redaction is a HARD rule; the fuzz council attacks it. `/sync?since=k` returns
`{moveIndex, view, moves}` where relayed moves are `toClientMove`-style
(type + seat + PUBLIC payload; a SELL reveals the sold cards — that's public in
real Jaipur; TAKE_SINGLE reveals the taken card via market diff — public;
TAKE_EXCHANGE reveals given/taken — public. The deck draw REPLACING market
cards is visible in the view, not the move).

### 3.8 Rooms / join / start

2-player simplification of viota: `POST /create-room` (authed) → seat 0 =
creator, seat 1 = open, `status:'waiting'`, code = 6-char (viota alphabet),
D1 registry row awaited. `POST /join` — idempotent for an account already
seated (works mid-game = invite-link resume); claims seat 1 in a sync span;
**the join immediately deals** (no host-start ceremony): flips to `active`,
`round_start`, nudge `{type:'started'}`. `GET /sync` on `waiting` → roster
view. `/leave` in waiting = room abandoned (creator) or seat freed (joiner);
`/leave` mid-game = instant AI cover (viota semantics), NOT resign.

## 4. Worker router (`worker/src/index.ts`)

CORS: port viota's current `cors.ts` (comma-separated exact-match allowlist;
`*` only when CLIENT_ORIGIN unset = local dev). Routes:
- `POST /games` {matchLength} → create DO (idFromName(gameUuid)), returns
  {gameId, code, view}
- `GET /resolve?code=` → D1 registry {gameId, status}
- `ALL /games/:id/(join|sync|move|heartbeat|reclaim|veto|next-round|resign|leave|socket)`
  → forward to DO stub (WS upgrade passes through)
- `POST /quick-match` {matchLength} → MatchmakerDO (§5)
- `GET /my-games` → D1: caller's active+waiting games, newest first
- `GET /stats/leaderboard` · `GET /stats/history` (own matches, authed) ·
  `POST /stats/report` (client-reported LOCAL vs-AI match, authed) ·
  `GET /stats/rollup?accountId=` (public, per
  `vgames-platform/docs/STATS-FEDERATION.md` v0 contract: 200-with-zeros for
  unknown accounts, epoch ms, no cross-game math)
- `GET /health`
All authed unless noted. Rate limit: simple per-isolate token bucket per
accountId on mutating routes (30/10s) — cheap, not load-bearing.

## 5. Quick-match

`MatchmakerDO` (singleton via idFromName('global')): `POST /queue`
{matchLength} + accountId → if a compatible queued entry exists (different
account, same matchLength, < 60s old): atomically pop it, create the game
(worker-level helper the DO calls via GAME_DO stub: create-room as playerA +
join as playerB — server-side, no tokens re-verified inside; accountIds passed
by the matchmaker which already verified both), return `{matched:true, gameId,
code}` to the second caller and record `{accountId → gameId}` so the FIRST
caller's `GET /quick-match/status` poll returns it. Entries expire 60s;
`DELETE /quick-match` cancels. Keep it ~150 lines + tests.

## 6. D1 schema (`worker/migrations/0001_init.sql`)

```sql
CREATE TABLE games (
  game_uuid TEXT PRIMARY KEY, code TEXT, status TEXT NOT NULL,          -- waiting|active|completed|resigned|abandoned
  match_length INTEGER NOT NULL, seals0 INTEGER DEFAULT 0, seals1 INTEGER DEFAULT 0,
  winner_seat INTEGER, source TEXT NOT NULL DEFAULT 'online_authoritative',
  engine_version TEXT, created_at INTEGER, last_activity_at INTEGER, ended_at INTEGER
);
CREATE INDEX idx_games_code ON games(code);
CREATE TABLE game_players (
  game_uuid TEXT, seat_index INTEGER, account_id TEXT, display_name TEXT,
  ai_covered_moves INTEGER DEFAULT 0, result TEXT,                       -- win|loss|null
  PRIMARY KEY (game_uuid, seat_index)
);
CREATE INDEX idx_gp_account ON game_players(account_id);
CREATE TABLE moves (
  game_uuid TEXT, move_index INTEGER, round INTEGER, seat_index INTEGER,
  type TEXT, payload TEXT, by_ai INTEGER, ai_difficulty TEXT,
  client_move_id TEXT, reverted INTEGER DEFAULT 0, created_at INTEGER,
  PRIMARY KEY (game_uuid, move_index)
);
CREATE TABLE players (           -- display-name cache for boards
  account_id TEXT PRIMARY KEY, display_name TEXT, last_seen_at INTEGER
);
CREATE TABLE matches (           -- THE stats table (migrated + new)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  opponent_type TEXT NOT NULL,       -- tier id ('easy','medium','fair','hard3',
                                     -- legacy ids) or 'human'
  opponent_account_id TEXT,          -- for human games
  player_score INTEGER NOT NULL, opponent_score INTEGER NOT NULL,
  won INTEGER NOT NULL,
  source TEXT NOT NULL,              -- 'online_authoritative' | 'client_reported'
  ai_covered INTEGER DEFAULT 0,      -- online: my seat had AI-covered moves
  game_uuid TEXT,                    -- online games link back
  timestamp INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_matches_dedup ON matches(account_id, timestamp, opponent_type);
CREATE INDEX idx_matches_account ON matches(account_id);
```
Online match end: the DO writes ONE `matches` row PER HUMAN SEAT
(opponent_type='human', opponent_account_id=other seat, scores = final match
seal-decided scores as today's client records them — read gameStore's current
online addMatch payload and mirror the semantics), `source='online_authoritative'`,
`ai_covered` = that seat had any non-reverted covered moves.
`POST /stats/report` = local vs-AI matches (client-reported, trust-scoped by
`source`), validated: tier id allowlisted (from a shared tiers list), integer
scores 0..500, timestamp sane, dedup via the unique index (ON CONFLICT DO
NOTHING → `{ok:true, duplicate:true}`).
Leaderboard: aggregate `matches` BY `account_id` (join `players` for names) —
never by display_name. Return both `overall` (all sources) and `verified`
(online_authoritative only) blocks; client renders as today plus a
"verified" marker where applicable.

## 7. Client changes (Phase 2C)

New `src/net/` (port viota client patterns): `http.ts` (Bearer + retry/backoff
+ 401→silent re-auth via existing `vgamesClient` quick flow), `online.ts` (all
endpoint calls), `nudge.ts` (WS + first-frame `{type:'auth',token}` + reopen on
foreground/visibility), `outbox.ts` (ONE pending move, uuid clientMoveId,
localStorage-persisted, drained before sync), `session.ts` (persist
`{gameId, code, mySeat}` in localStorage; cleared on match_over/resign/leave),
`reconcile.ts` (sync on: nudge, visibilitychange, pageshow, online, WS open).
`gameStore` online mode becomes **view-driven**: state rendered FROM ClientView
(a `viewToRenderState` adapter). No optimistic mutation: a move POSTs, UI shows
a pending affordance, view updates on response/nudge-sync (viota's model).
ActionBar legality: compute from own view via a pseudo-GameState (own hand +
market + herds + tokens + dummy deck of `deckCount` placeholders) —
`getLegalActions` never touches deck contents; verify with a test.
Heartbeat: 20s interval while an online game is mounted.
Screens: Lobby (create/join/quick + "Your games" resume list from /my-games),
GameScreen (banner: opponent away/AI-covering; own-seat covered → reclaim +
veto prompt), RoundEnd (Continue → /next-round; shows "waiting for opponent" /
auto-advanced), GameOver (+resigned outcome), Resign behind confirm in settings
area. DisconnectBanner is REPLACED by the cover/reclaim banner (no more
forfeit countdown — nothing forfeits).
Local vs-AI is UNTOUCHED except stats sync switches from Socket.IO SYNC_MATCH
to `POST /stats/report`; leaderboard + history reads move to worker endpoints.
socketService + the old protocol stay in the tree (old server still runs) but
nothing imports them on the online path after cutover; delete in a later pass.

## 8. Stats migration (Supabase → D1)

One-off script `worker/scripts/migrate-stats.mjs` (node, no deps): read
Supabase `players` (id, vgames_account_id, display_name) + `matches` via REST
(service key from env/.env — NEVER committed), map player_id→account_id, remap
`opponent_id` (a players.id for human games) → opponent_account_id, emit
`d1-matches.sql` INSERT ... ON CONFLICT DO NOTHING + a count report. Apply via
`wrangler d1 execute vjaipur --remote --file`. Rows whose player has no
vgames_account_id are skipped + reported. `source='client_reported'`,
`ai_covered=0`. Verify: D1 count == emitted count; spot-check Vijay's totals
match his current in-app stats. Supabase is left UNTOUCHED (rollback = ignore
D1 matches).

## 9. Deploy / cutover / rollback

Order: `wrangler d1 create vjaipur` → paste id into wrangler.toml →
`wrangler d1 migrations apply vjaipur --remote` → `wrangler deploy` (from
`worker/`) → set `CLIENT_ORIGIN` (https://vjaipur-game.onrender.com) + confirm
`VGAMES_URL` var → live e2e script (browser UA; Cloudflare WAF blocks
python-urllib): quick-auth two ghosts → create/join/play a full scripted round
incl. idempotent replay, foreign-seat 403, redaction assert (opp hand absent),
heartbeat, cover-after-absence, reclaim → stats rows appear. Then stats
migration (§8). Then client cutover commit (VITE_VJAIPUR_WORKER_URL baked into
Render env + code default) → push main → Render rebuilds static client →
verify live bundle hits the worker. **Rollback: push
`checkpoint-2026-07-18-hardening^{}:main`** (client returns to Socket.IO relay,
which still runs) — document in notes. Old in-flight relay games at cutover
moment are lost (acceptable at ~10-user scale, 1 AM deploy; note in report).

## 10. Testing bar (gates the cutover)

- Worker unit/integration (vitest-pool-workers, viota's current pins:
  @cloudflare/vitest-pool-workers ^0.18.4, vitest ^4, wrangler ^4.110):
  apply pipeline (authz/idempotency/turn/illegal), round transitions incl.
  double next-round, resign, redaction (opp hand/deck/bonus values NEVER in
  any view/move/sync payload — grep-style deep assert on serialized JSON),
  presence cover/reclaim/veto + reclaim-race, floorMove legality fuzz,
  determinism replay test, quick-match pairing races, stats writes + dedup,
  leaderboard by account_id, rollup contract shape, CORS.
- Client: net layer (mocked fetch), view-driven store transitions, outbox
  drain/dedup, session resume, ActionBar-legality-from-view.
- Full existing suites stay green (`npm run test`, `npm run test:server` —
  old server tests still pass untouched).
- Fuzz/pressure council (Phase 3) before deploy: seeded full-match fuzz vs an
  independent rules oracle; redaction leak hunt; race battery.

## 11. File-by-file port map (viota → vjaipur worker)

| viota `packages/worker/src/` | vjaipur `worker/src/` | change |
|---|---|---|
| game-do.ts | game-do.ts | 2p, no host-start, +next-round/+resign, no ai_takeover_ms, introspect auth |
| do/apply.ts | do/apply.ts | Jaipur engine apply + round-end append in-span |
| do/moves.ts | do/moves.ts | Action shape validation |
| do/view.ts | do/view.ts | §3.7 ClientView |
| do/presence.ts, timers.ts, drive.ts, constants.ts | same | constants tuned; drive uses mediumAi; floorMove |
| do/init.ts | do/init.ts | 2-seat create/deal; rounds table |
| do/storage.ts | do/storage.ts | + rounds table, match meta (seals/round/phase) |
| do/veto.ts, replay.ts | same | per-round replay base |
| do/client-move.ts | same | public move projection |
| do/archive.ts | do/archive.ts | + matches writes at end; games/seals columns |
| auth.ts, jwt.ts | authctx.ts (new) | introspect + cache (§2), no local JWT verify |
| cors.ts | cors.ts | copy current allowlist version |
| index.ts | index.ts | §4 routes + matchmaker + stats |
| — | matchmaker-do.ts | §5 |
| — | stats.ts | leaderboard/history/report/rollup |

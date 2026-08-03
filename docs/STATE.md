# vjaipur — Current State

**Read this first.** This is the cold-start orientation doc — what the app
is, what's live, what must never break, and where to look next. It is a
snapshot, not a log: for the blow-by-blow history (why things are the way
they are), read the chronicle; for open work, read the backlog. Both are
linked in **Pointers** at the bottom. If this file and the chronicle ever
disagree on a *current fact*, trust the chronicle's most recent entry and
fix this file.

Last verified against the repo: 2026-08-03 (`npx tsc --noEmit` clean; client
776/776, worker 292/292, legacy server 48/48 tests green — see **Test
suites** below).

## What this is

VJaipur is Vijay's private TypeScript/React implementation of the board game
Jaipur: local pass-and-play, six AI difficulty tiers, and server-authoritative
online play between real people, with accounts, stats, leaderboards, and a
per-player "style" analysis feature layered on top. It's played by Vijay,
Sureka, and a handful of friends (~10-user scale) — not a public product.

## Architecture map

- **Client** — React + Zustand, built with Vite (`src/`). Deployed as a
  static site on Render. `src/store/gameStore.ts` drives both local and
  online games from the same UI; `src/net/**` is the online HTTP/WS layer.
- **Engine** — `src/engine/**`, pure TypeScript, no I/O. **CERTIFIED / never
  touch** (see Invariants below) — both the client and the worker import it
  directly (the worker imports it via a relative path across the package
  boundary, not a copy).
- **AI** — `src/ai/**`, six tiers running off the main thread via Web
  Workers (`aiWorker*.ts`, `ismctsWorker.ts`, `workerBridge.ts`). See **AI
  tier lineup** below.
- **Online play (LIVE, current)** — vjaipur's own Cloudflare Worker
  (`worker/`), server-authoritative. One Durable Object per game (`GAME_DO`,
  SQLite-backed — `new_sqlite_classes`, required for the Workers Free plan),
  plus a D1 database named `vjaipur` as the durable, queryable, rebuildable
  archive (written through from the DO via `ctx.waitUntil`). Replaced the old
  Socket.IO relay in the 2026-07-18 rebuild.
- **Identity** — external, shared **vgames-identity** Cloudflare Worker (part
  of the sibling `vgames-platform` estate, not this repo). vjaipur-worker has
  no local identity of its own: every Bearer token is verified by calling out
  to `POST {VGAMES_URL}/auth/introspect` (5-minute positive-result cache), and
  since 2026-07-20 a `[[services]] IDENTITY` binding is used instead of a
  public fetch (worker→worker public fetches to another `*.workers.dev` on
  the same Cloudflare account get blocked/looped — see `worker/wrangler.toml`).
  The client also calls vgames-identity directly for `auth/quick`/login.
- **Legacy (HELD for decommission, still deployed)** — `server/`: a
  Node/Express + Socket.IO relay backed by Supabase. Superseded 2026-07-18 by
  the worker above, but Render still runs it (service `vjaipur-server` in
  `render.yaml`) so any stale client tab doesn't hard-break. Decommissioning
  it is an explicit backlog item, HELD on Vijay's go — do not delete
  `server/`, its Supabase wiring, or `.env` vars for it without asking.

## Live endpoints

| What | URL | Notes |
|---|---|---|
| Site (client) | https://vjaipur-game.onrender.com | Render static site. `render.yaml`'s blueprint service name is `vjaipur-client` — the live `.onrender.com` slug (`vjaipur-game`) predates that name and hasn't been resynced; harmless, same class of drift as the Blueprint-sync backlog item below. |
| Worker (online play) | https://vjaipur-worker.theonenonlyvj.workers.dev | Cloudflare Worker + Durable Objects + D1. |
| Identity (shared) | https://vgames-identity.theonenonlyvj.workers.dev | Owned by `vgames-platform`, not this repo. Login token TTL 24h (raised from 1h, 2026-07-26). |
| Legacy server (HELD) | Render service `vjaipur-server` | Node/Socket.IO + Supabase. Still deployed; superseded, not decommissioned. |

## The invariants that MUST hold

- **The engine is certified — `src/engine/**` is locked.** Multiple places in
  the codebase (`worker/src/game-do.ts`, `worker/test/fuzz-oracle.test.ts`,
  `worker/src/do/init.ts`) call it out explicitly: "per project memory, the
  engine is CERTIFIED/locked." It's pure, already fuzz-proven (oracle +
  redaction + races), and imported unmodified by both the client and the
  worker. Do not edit it without Vijay's explicit sign-off.
- **ISMCTS fairness proofs run pinned-iteration.** Both `tests/engine/
  hardAi2.fairness.test.ts` and `tests/engine/ismctsBot.fairness.test.ts`
  assert the bot picks an identical move when the opponent's true hidden hand
  or deck order changes but public information is held identical (seeded
  rng). This is what makes the "fair" AI tiers provably not-cheating. New
  search/eval features must keep these green; the iteration floor
  (`minIterations`, see AI tier lineup) explicitly does not apply in pinned
  mode.
- **Per-seat redaction: opponent hand/deck/bonus VALUES never leave the DO.**
  `worker/src/do/view.ts`'s `ClientView` is a closed allowlist, not a
  denylist — audited field-by-field against every component that renders
  online state. Round-end reveal (`lastRoundReveal`) is **goods tokens +
  bonus SUMS only**, at `round_end`/`match_over` — never individual bonus
  token values, and never anything mid-round. (Bonus piles fully reshuffle
  every round, so round-end values would be safe too — the sum-only display
  is a UI choice, not a security requirement; see the chronicle's 2026-07-27
  correction.)
- **Zero idle compute for style/rivalry endpoints.** `GET /stats/my-style`
  (`worker/src/do/style.ts`) and `GET /stats/rivalry`
  (`worker/src/do/rivalry.ts`) are each invoked from exactly one route, only
  on an authed GET. Neither is touched by the match-end write path
  (`do/stats.ts#reportMatch`). A player who never opens the MY STYLE tab or a
  Rivalry modal causes zero rows written and zero extra computation, ever.
- **Games-first stat vocabulary.** Per Vijay's 2026-07-28 ruling: a **GAME**
  is one deal/round (what produces a score and awards a seal); a **MATCH** is
  the best-of-N sitting (what the `games`/`matches` tables row one-per). The
  leaderboard, MY RECORDS, the home screen's record strip, and
  ProfileOverlay's career stats are all GAMES-first now; MATCHES are
  secondary context only.

## AI tier lineup

Source of truth: `src/ai/tiers.ts` — `id` is written verbatim as
`opponent_type` and must never change even when a tier is renamed or retired.

| id | Label | Engine | Notes |
|---|---|---|---|
| `easy` | Easy | `easyAi.ts` | Relaxed intro opponent. |
| `medium` | Medium | `mediumAi.ts` | Solid club player. |
| `hard2` | Hard (αβ) | `hardAi2.ts` | Fair (determinization, no peeking) alpha-beta search, ~1.5s budget. Active "Hard" since 2026-07-20. |
| `ismcts` | Hard (ISMCTS) | `ismctsBot.ts` | Information-Set MCTS, fair (never reads the true hidden hand/deck). Shipped 2026-07-21 alongside `hard2` for A/B; wall-clock budget with a 25,000-iteration floor (`minIterations`, `f7e78b2`) so a throttled phone can't quietly turn into an easier bot; unconditional-winner early stop cuts ~30% of think time on settled moves without changing the chosen move. **Eval V2 live** (`df8b9ac`, 2026-08-02, GATE PASS 60% vs the pre-v2 eval): deck-clock decay on held-stack value, clock-scaled stack-bonus option value, precious pair-momentum, and a fair denial term (reads only the determinized hand built from public `revealedHands`). Toggle is `__setEvalV2` in `src/ai/ismctsBot.ts` (production always runs v2 true). |
| `hard3` | Omniscient Bot | `hardAi3.ts` | Reads the opponent's real hand and deck order — genuinely omniscient, named honestly instead of hidden behind a disclaimer. Known issue: telegraphs the deck by its wait/act timing (see BACKLOG.md). |
| `hard` *(retired)* | Hard (Classic) | `hardAi.ts` | Off the picker since 2026-07-18; files under the `medium` leaderboard family (benchmarked ~70% vs Medium). |
| `fair` *(retired)* | Hard (FairBot, Classic) | `fairBot.ts` | Off the picker since 2026-07-20 (replaced by `hard2`); files under the `medium` leaderboard family (~73% vs Medium). |

## Test suites + commands

| Suite | Command | Last verified (2026-08-03) |
|---|---|---|
| Client/engine/UI | `npm run test` (repo root) | 776/776 passing, 62 files |
| Worker | `cd worker && npm test` | 292/292 passing, 15 files |
| Legacy server | `npm run test:server` | 48/48 passing, 4 files |
| Typecheck | `npx tsc --noEmit` (repo root) | clean |
| Combined client+server | `npm run test:all` | — |

Notes:
- `tsconfig.json`'s `include` is `["src","tests"]` — `npm run build`'s `tsc`
  step does **not** typecheck `server/`; `npm run test:server` (vitest) is
  the only gate on that legacy code.
- Known flake (documented in the chronicle, 2026-07-28 entry): a wall-clock
  contention test in the `hardAi2` family occasionally fails under full-suite
  load (search budget races the test's own clock) but is green every time in
  isolation. Not a real regression signal by itself.
- `docs/engineering/testing.md`'s "Known Failing Areas" section (Disconnect
  Timeout, Server DB Tests) did **not** reproduce in this pass — all 48
  legacy server tests are green today. That section is stale; see this
  file's header note and the report for this restructuring pass.

## Deploy

- **Client** — push to `main` → Render auto-deploys the static site
  (`render.yaml`, service `vjaipur-client`). **Gotcha:** Render's
  auto-deploy rebuilds the app but does **not** re-apply `render.yaml`'s
  `routes`/`headers` sections on every push — those only take effect after a
  manual **Blueprint sync** in the Render dashboard (see BACKLOG.md). To
  confirm a deploy actually landed, curl the live site and grep the served
  bundle for a marker string unique to the change (a constant, a UI string) —
  this is the team's standard verification move, e.g. `curl
  https://vjaipur-game.onrender.com/ | grep <marker>` (see `worker/DEPLOY.md`
  step C.3 and multiple chronicle entries that verify a deploy this way).
  `index.html` is served `no-cache, must-revalidate`; hashed `/assets/*` are
  cached forever — this is what makes the marker check meaningful (a stale
  index.html would pin a stale bundle, which is exactly the bug the
  update-available banner in `src/net/versionCheck.ts` also guards against).
- **Worker** — `cd worker && npx wrangler deploy` (see `worker/DEPLOY.md` for
  the full first-time bring-up: `wrangler d1 create vjaipur`, migrations,
  `CLIENT_ORIGIN` secret, the `IDENTITY` service binding).
- **D1 migrations** — `npx wrangler d1 migrations apply vjaipur --remote`
  from `worker/`. All migrations to date (`0001`-`0004`) use `CREATE TABLE/
  INDEX IF NOT EXISTS` or a guarded `ALTER TABLE`, so re-runs are safe. The
  2026-07-28 chronicle entry notes a "first-run rollback quirk" was checked
  when applying migration 0003 remotely — the repo doesn't document exactly
  what that quirk was beyond "checked, table verified"; treat any first
  remote apply of a new migration as worth a manual `wrangler d1 execute
  vjaipur --remote --command "SELECT ..."` spot-check afterward rather than
  trusting the apply command's exit code alone.
- **Rollback** — tag `checkpoint-2026-07-18-pre-online-worker` is the anchor
  from just before the online-worker cutover (`git push origin
  checkpoint-2026-07-18-pre-online-worker^{}:main --force-with-lease`
  reverts the client to the old Socket.IO relay, which is still running).

## Data (D1 database `vjaipur`)

One-liner per table (full definitions in `worker/migrations/000{1,2,3,4}_*.sql`):

- **`games` / `game_players` / `moves`** — the online-play archive. `games`
  is one row per online match (status, seals, winner); `game_players` is
  per-seat ownership (the `account_id` index is the cross-session analytics
  join); `moves` is the append-only, replayable, **already-redacted** public
  move log (every payload is translated via `worker/src/do/publicPayload.ts`
  before it's stored — never raw hand-index actions).
- **`matches`** — the stats table: one row per human seat per finished
  match, both online and vs-AI (`opponent_type` = a tier id or `'online'`).
  `games_won`/`games_lost` (migration 0004) let a client-reported row carry
  its own exact per-game split; online rows derive theirs at query time from
  `games.seals0/seals1` instead.
- **`match_logs`** — per-move play-by-play for **local vs-AI matches only**,
  captured so AI tuning can analyze real human-vs-bot games instead of only
  win/loss summaries. Read directly via `wrangler d1 execute` / `tools/
  mlogs/`, no API endpoint.
- **`style_cache`** — the incremental, mergeable "MY STYLE" aggregate cache,
  one row per `(account_id, tier)`, cursor'd by `last_log_id` so re-opening
  the tab never re-scans full history. Only ever written from inside `GET
  /stats/my-style` (see the zero-idle-compute invariant above).
- **`players`** — a display-name cache for boards/leaderboards, best-effort
  upserted on every authenticated touch.

## Tooling

- **`tools/mlogs/analyze.mjs`** — the re-runnable match-log analyzer.
  `--pull` dumps `match_logs`/`matches`/`players` from remote D1 (requires
  `wrangler` auth) into `tools/mlogs/data/` (gitignored — contains account
  ids and full game state, never commit it); default mode prints the ISMCTS
  bot-health block plus a per-player style report for every account with
  ≥5 logged games. `--help` for full usage.
- **`docs/ai/2026-07-27-ismcts-baseline-eval.md`** — the frozen numeric
  baseline the analyzer's output is compared against, plus re-run
  instructions and an explicit "what to watch in 3 months" list. Read its
  "What changed after this baseline was taken" section before comparing any
  future run's iteration counts (the early-stop feature deliberately lowers
  them without the bot getting weaker).

## Pointers

- **History** — `docs/superpowers/notes/2026-07-20-post-launch-fixes-and-backlog.md`
  is the append-only chronicle: every fix, investigation, and decision since
  the 2026-07-18 rebuild, in the order it happened. Read it when you need the
  *why*, not just the *what*. Its 2026-07-18 sibling,
  `docs/superpowers/notes/2026-07-18-overnight-online-rebuild.md`, covers the
  rebuild itself.
- **Open work** — `docs/BACKLOG.md` is the only live backlog. Everything
  still-open in the chronicle has been extracted there, deduped, with a
  status tag.
- **Mockups** — `docs/mockups/` (currently `you-vs-bot-panel.html`, the MY
  STYLE tab's design mockup).
- **Engineering** — `docs/engineering/testing.md` (verification gates) and
  `docs/engineering/release-checklist.md` (pre-release checklist) — both
  written for the pre-2026-07-18 world but still structurally useful; read
  this file's Test suites section above for current numbers instead of
  trusting hardcoded counts in either.
- **Legacy operations** — `docs/operations/*.md` (Render/Supabase/admin
  runbook) still describe the live-but-HELD legacy server accurately; not
  stale, just scoped to the system being decommissioned.
- **`docs/handoff.md`** / **`docs/status.md`** — pre-2026-07-18 archaeology,
  bannered stale. Kept for history only.

# Overnight online rebuild — running notes (2026-07-18)

Vijay's brief (2026-07-18 ~01:00): make vjaipur actually function online — fun and
solid. Migrate what needs migrating, push what works, checkpoint for regression.
No disclosure labels on AI — rename instead (Hard III → "Omniscient Bot" or
similar); need a fair hard player; good easy/medium too ("all my friends are
nerds"). Keep stats, cut them over, keep them tied to the tier they were played
against. Councils + cheap subagents at discretion. Ship by morning.

Decisions (Vijay, 2026-07-18):
1. Architecture: **own worker + own D1** (standalone vjaipur CF Worker, DO-per-game,
   its own D1; identity stays the shared vgames-identity service).
2. Cutover: **tonight**, if tests + live e2e on real Cloudflare are green.
3. AI: clean tier relaunch OK **as long as per-tier stats survive the cutover**.

## Log

- 01:13 — Re-verified hardening branch: tsc clean, server 48/48, client 329/329,
  prod build OK.
- 01:15 — Tagged `checkpoint-2026-07-18-pre-hardening` (= 24ede0b, prod as it was)
  and `checkpoint-2026-07-18-hardening` (= f8a5ebf). FF-merged
  `review-hardening-2026-07-16` → main, pushed with tags → Render auto-deploying
  both services. **ROLLBACK: push either tag's commit to main** (e.g.
  `git push origin checkpoint-2026-07-18-pre-hardening^{}:main --force-with-lease`).
- 01:33 — **Hardening LIVE on Render**: client bundle `index-B37EKcdn.js` carries
  the 180s + Back-to-Menu markers; backend `/health` ok (after free-tier cold
  start). Phase 0 done.
- 01:40 — Spec written: `docs/superpowers/specs/2026-07-18-vjaipur-worker-online-design.md`
  (port map of viota's DO architecture, Jaipur adaptations: MatchState wrapper,
  rounds/seeds, no-forfeit + AI-cover/reclaim/veto, resign, redaction incl.
  opp-bonus-tier-only, own D1 schema, introspect auth w/ 5-min cache,
  quick-match DO, stats+migration, cutover/rollback). 4-lens red-team council
  running on it.
- 01:45 — Parallel tracks landed + committed (local, unpushed):
  - `b69c34a` AI lineup: Easy / Medium / Hard (=fairBot, "No peeking. Pure
    skill.") / **Omniscient Bot** (=hardAi3, "It can see your hand. It can see
    the deck. Beat it anyway."). hard+hard2 retired from picker; all 6 historical
    tier ids still label correctly in stats (src/ai/tiers.ts = source of truth).
  - `4fab714` assets: 6 synthesized WAV SFX live (audio was 0-byte dead);
    OpenMoji card SVGs self-hosted. Leftover: CamelStack.tsx still hotlinks the
    camel SVG + linen texture (linen 404s upstream everywhere — needs a local
    substitute or drop); GameOverScreen shows raw tier id (use getTierLabel).
- 02:05 — **Red-team council (4 lenses) done** — many real findings. Wrote
  `...-ADDENDUM.md` (LOCKED, overrides base spec). Key decisions:
  - **CUT quick-match tonight** (MatchmakerDO had no viota precedent + 4
    findings; friends use code/link). Fast-follow.
  - **DEFER veto** (reclaim alone is fine v1; a returning player resumes from
    the current board).
  - Blockers fixed in spec: round_end liveness needs a NEW `round_wait` timer +
    phase-guards on drive/floor (ported machinery is phase-blind); TAKE_EXCHANGE
    must store a TRANSLATED public payload (raw hand-indices leak/break);
    winnerSeat = `seals[seat] >= sealsNeeded` NOT `>=2` (gameStore online path
    is bugged for matchLen 1/5); MatchState.seals/round/phase must NOT be read
    off the engine's frozen embedded fields; per-field move validation (-1 herd
    camel sentinel); migration opponent_id is a friend_code → leave
    opponent_account_id NULL; keep opponent_type='online' (not 'human'); ISO→
    epoch-ms; VGAMES_URL = vgames-identity.workers.dev; introspect 5-min cache
    bound; heartbeat spans all screens.
  - Cut fresh rollback tag **`checkpoint-2026-07-18-pre-online-worker`** (= main
    4fab714; the -hardening tag was 2 commits stale).
- 02:15 — Build waves launched. W1 (worker foundation: scaffold/storage/codec/
  constants) + migration-script (independent) running in parallel. Then W2 (DO
  handlers) → W3 (presence) + W4 (router/stats) → client 2C → fuzz → deploy.
  Jaipur GameState is plain-JSON (no Map) so the codec is trivial vs viota.
- 02:40 — **W1 GREEN** (foundation: 8 tests, engine runs in workerd ping=40,
  GameRepository surface documented). **Migration script DONE** (16 tests, ISO→
  epoch-ms, opponent_account NULL, real Supabase cols discovered from server/db.ts).
- 03:20 — **W2 GREEN** (authoritative DO core: 51 worker tests). Full flow
  create→join(auto-deal)→alternating human moves→round_end(scoreRound+seals)→
  next-round(loser-first)→match_over for matchLength 1 & 3 via seals[seat]>=
  sealsNeeded; resign; illegal/foreign-seat/wrong-turn rejected; idempotent
  replay; **redaction asserted** (seed/deck/opp-hand/opp-bonus-values never in
  any payload); **determinism asserted** (replay from rounds.initial_state).
  ClientView locked; archive stubs pinned; Wave-3 seams marked. authctx test
  seam: VGAMES_URL='test' → token `test:acct:name`.
- 03:25 — **W3 (presence/liveness) + W4 (router/auth-cache/archive/stats)
  launched in parallel** — file-disjoint writes (W3: game-do/presence/timers/
  drive/floor/storage/constants; W4: index/authctx/archive/stats/cors). After
  both: my full-tree integration + review, then client 2C, then fuzz council,
  then deploy+cutover.
- 03:03 — **W3 + W4 GREEN, full worker suite integrates: 121 tests / 10 files,
  tsc clean.** Highlights: floorMove fuzz 1000/1000 legal; round_wait
  auto-advance wired (alarm→advanceRoundInternal directly); phase guards on
  drive/floor; 5-min introspect cache (positive-only, bounded, tested);
  archiveMatchEnd = 1 matches row per human seat, opponent_type='online',
  accumulated round_end scores, won from winner_seat; leaderboard GROUP BY
  account_id reusing the app's own rankBySkill; gameId === room code (W4
  routing decision — code is the idFromName key). Launched a 3-lens
  adversarial integration review of the assembled worker.
- ~03:05 — **machine slept mid-review; woke ~09:11** and the review workflow
  auto-resumed (3 reviewers re-running). Vijay is back ("continue").
- 09:15 — Committed the green worker as `a09ba1e`. **Launched the client 2C
  rewrite in parallel** with the review (disjoint files): new src/net/* layer
  (http/online/nudge/outbox/session+heartbeat), view-driven gameStore online
  mode (viewToRenderState adapter, placeholder opp-hand/deck so existing
  components render unchanged), no-forfeit UX (cover/reclaim banners), stats
  via worker (report + history; online matches server-written only), Lobby
  without quick-match. Confirmed first: UI never renders discard, deck only as
  a count — ClientView contract sufficient.
- 09:30 — **Integration review (3 lenses + verify) done. REDACTION CLEAN** — no
  hidden-info leak anywhere (verified the AI-cover/floor moves route through the
  same toPublicPayload translation as human moves; opp bonus values stripped;
  seed never leaves the DO). Real findings, all being fixed by a worker-fix
  agent (parallel to 2C, disjoint files):
  - **BLOCKER**: archiveMatchEnd not idempotent — used Date.now() as the dedup
    timestamp so every post-match tick inserted DUPLICATE matches rows (would
    corrupt leaderboard/history — the exact thing this protects). Fix: stable
    timestamp from the terminal move's created_at + ended_at guard.
  - MAJOR: round_wait auto-advance didn't re-drive AI (present player stalls
    ≤60s if the new round opens on the covered seat) → fold post-deal wheel into
    advanceRoundInternal.
  - MAJOR: handleResign left timers armed (zombie autoCover) + didn't route
    through runArchiveTick → clear timers + rearm + runArchiveTick.
  - MAJOR: room code = DO key with no collision check → add a D1 pre-check
    (keep gameId===code).
  - MINOR: gate WS broadcasts to authed sockets; AI-cover payload regression
    test; sweep abandoned waiting rooms.
- 10:00 — Worker review fixes committed `7190d2e` (+ I fixed the same-class
  natural-match-over timer sweep myself; 140 worker tests). Client 2C committed
  `d9d23d7` (446 client tests, view-driven, no-forfeit UX, worker-backed stats).
- 10:27 — **Fuzz battery ALL PASS** (committed `fccbbee`, worker now 202 tests):
  oracle 45 matches/6830 moves vs independent scorer = 0 divergences; races 9/9
  no bugs; redaction 32 games/6315 steps = 0 leaks.
- 10:30–10:38 — **DEPLOYED + LIVE-VERIFIED ON CLOUDFLARE:**
  - D1 `vjaipur` created (`f363488e-1672-4104-851c-ccba73573820`), schema applied.
  - `CLIENT_ORIGIN` secret = https://vjaipur-game.onrender.com; `wrangler deploy`
    → **https://vjaipur-worker.theonenonlyvj.workers.dev** (version 94385877),
    cron active, GAME_DO + DB + VGAMES_URL bound.
  - **Live e2e ALL PASS** (2 real ghost tokens, full match to match_over):
    create/join/redaction/foreign-seat-403/idempotency/winnerSeat + 2 D1 matches
    rows (one per seat, opponent_type='online', source='online_authoritative').
    Wiped the e2e rows after.
  - **Stats migration DONE:** 77 Supabase matches (0 skipped) + 3 player names
    → D1. Live `/stats/leaderboard` shows `theonenonlyvj` (37g, 10.8% — the
    Omniscient Bot has been wrecking him) + `reks` (2-0); ranking floor works.
- 10:39 — **CUTOVER PUSHED** (`85b5b66`, 8 commits f8a5ebf→85b5b66 to origin/main).
  Client default worker URL baked (`src/net/http.ts`, prod builds only), so no
  Render env var needed. Render auto-deploying the static client. Polling for the
  new bundle. **ROLLBACK: `git push origin checkpoint-2026-07-18-pre-online-worker^{}:main --force-with-lease`** (client returns to the Socket.IO relay, still running).

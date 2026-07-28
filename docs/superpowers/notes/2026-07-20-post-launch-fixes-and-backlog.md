# vjaipur — post-launch fixes + backlog (2026-07-20 → 07-21)

Continuation after the 2026-07-18 online rebuild went live. Vijay + friends
(Chandy, Sureka/reks) playing; fixes driven by their reports.

## SHIPPED & LIVE today
- **BONUS! overlay stuck all game** — it only dismissed on an 'exit' animation
  that could never fire (deadlock; `def==='exit'` never matches inline animate).
  Now a HOLD_MS(900) timer (onDone in a ref so re-renders don't reset it).
- **vs-AI stats not saving / "Failed to create room"** — TWO root causes:
  1. **Worker→worker fetch blocked.** A top-level Worker's public fetch to
     another *.workers.dev on the same account is blocked/looped by Cloudflare,
     so every worker-level authed route (/my-games, /stats/*) 401'd (the DO's
     identical introspect worked, so online saved but vs-AI didn't). **FIX: a
     `[[services]] IDENTITY` binding; authctx.resolveAuth prefers the binding.**
     (LESSON: worker→worker same-account MUST use a service binding.)
  2. **Expired token re-sent.** ensureVGamesAccount short-circuited on ANY
     cached token; on 401 workerFetch re-handed the same expired token. **FIX:
     forceRefresh param → mint a fresh token on 401.**
- **"Hard" bot** = Hard II (hardAi2) with endgame tactics + ~1.5s budget; fair
  (determinization, no peeking). **Provably fair** — `tests/engine/hardAi2.fairness.test.ts`
  asserts identical move when the opponent's secret hand / deck order change but
  public state is held identical (with rng seeded). 100% vs Medium.
- **Leaderboard: filter-by-opponent toggle** (All / Online / each bot). Worker
  `GET /stats/leaderboard?opponentType=`; unfiltered response carries
  `availableOpponents` so the client shows only non-empty filters.
- **Guest names** seeded onto the leaderboard (Guest_1234 vs generic "Player").
- **last_seen_at** now stamped on reportMatch / archiveMatchEnd / /my-games
  (was frozen at 0). NOTE: stamps at match-END; a local vs-AI game in progress
  is still invisible server-side until it completes.
- **Update-available reload banner** — compares the running bundle hash (DOM)
  vs `fetch('/',{cache:'no-store'})` on foreground/visibility/focus; offers
  Reload (user-initiated). Beats iOS Safari's stale-tab caching that caused the
  repeated create-room/stats failures.
- **Deck count** moved next to the MARKET label; **home footer** ("Have
  feedback? See my other projects" → personal-site); clearer online error copy.
- **render.yaml** no-cache headers on index.html — pushed but **needs a
  one-time Render Blueprint sync in the dashboard to apply** (the update banner
  supersedes it either way).

## Identified players (behavioral inference; no geo on old accounts)
- Vijay = **theonenonlyvj**. Chandy = **Guest_9752** (confirmed by a 10:11am
  4/2 game he IDed). reks = **Sureka** (claimed July). Other guests = a mix of
  friends + Vijay's early guest sessions. After Chandy, 2nd-most is a tie:
  Guest_3334 (5g) / Guest_8471 (5g) — candidates for Sureka's old sessions.

## BACKLOG (not done — needs a real focused run or Vijay's call)
1. **HARDER FAIR BOT (the big one).** Vijay wants a fair (no-peeking) bot
   strong enough to beat him. An automated eval-overhaul + 3s-budget + deeper
   search attempt **REGRESSED** — it lost to the current Hard **2W-6L (25%)**
   while thinking 2× longer (classic eval/search backfire), so it was REVERTED
   (never deployed). The current Hard stays. Real paths: (a) incremental,
   benchmark-per-change eval tuning (slow, uncertain payoff), or (b) a proper
   **ISMCTS** rewrite (state-of-the-art for hidden-info card games — most likely
   to actually work, but a real project). Benchmarking is SLOW (3s/move → ~100s
   per self-play game). Fairness proof test must stay green. **Awaiting Vijay's
   pick of direction.**
2. **Omniscient bot is "readable"** — it telegraphs the deck (if it *waits*,
   good cards are coming, because it sees them). Add unpredictability so it
   stops leaking deck info. Fast-follow.
3. **Decommission old Render Node backend + Supabase** — ON HOLD for Vijay's
   explicit go once he's fully confident. Rollback anchor:
   `checkpoint-2026-07-18-pre-online-worker`.
4. **Render Blueprint sync** so the no-cache header applies (Vijay dashboard).
5. Existing stale tabs (Sureka's/others' phones) need ONE full reload to pick up
   the update-banner build; after that it self-heals.

## Status: everything actionable + validated is shipped. The harder-fair-bot is
## backlogged pending direction; a few items await Vijay's dashboard actions.

## UPDATE 2026-07-21 — Backlog item 1 RESOLVED: "Hard (ISMCTS)" shipped (c0c04f4)
Fable-directed rebuild with a genuinely different architecture (single-observer
ISMCTS: per-iteration determinization from public info, availability-aware UCB1,
truncated ε-greedy rollouts, exchange pruning, 3s budget). GATE RESULTS:
**90% (36-4) vs the current Hard · 10-0 vs Medium · 40% (4-6) vs the Omniscient
cheater · worst move 3.0s · 0 illegal moves · provably fair** (identical-move-
under-hidden-swap proof test, pinned iterations). Shipped as its own tier
"Hard (ISMCTS)" ALONGSIDE the untouched Hard so Vijay can A/B and decide which
survives. (The earlier eval-overhaul attempt that regressed stays reverted.)
Remaining backlog: Omniscient readability; decommission (held); Blueprint sync.

## UPDATE 2026-07-23 — the sync saga, resolved + session-UX council shipped (a8277e5)
Vijay's 25 vs-AI games (20 ISMCTS) weren't reaching the server: his claimed
account's token expired, silent quick-reauth failed on his device, failures
queued invisibly, and every surface said something cryptic ('unauthorized',
'Failed to create room' for Sureka) instead of "log back in" — which was the
whole fix. Shipped along the way: pending-sync banner + Sync now + error
surfacing + enriched 401 diagnostics. Then a 4-lens council review produced 5
fixes, all shipped: sessionExpired store signal + refuse silent claimed→ghost
identity swaps; global SessionBanner ("You're signed out — log in…" + Log In);
Lobby 401 copy fixed (was 'reload the page' — a dead end) + auto-open login;
sync banner CTA becomes Log In on auth failure with friendly copy; Profile red
expired strip + auto-expanded login + avatar red dot. 585 tests.
Root-cause note: WHY his device's quick-reauth was rejected remains unpinned
(repro attempts with claimed accts + legacy credentials all passed; CORS fine)
— but the UX now surfaces and recovers it in one tap, and login rebinds the
device. Watch for recurrence via the new signals.

## BACKLOG ADD 2026-07-26 — "Bonus Race" variant (parked, Vijay's idea)
Ordered 3/4/5 bonus piles (highest first — reward whoever sells big FIRST),
consistent with the goods tokens' descending order. Decision: keep official
random draw as DEFAULT (preserves round-end reveal suspense, protects casual
players, avoids compounding first-mover advantage); build as an OPT-IN variant
toggle (like Match Length; online = a room setting) if/when picked up.
Implementation notes: one-line engine setup change (sorted vs shuffle) but
ripples: certified-engine care + tests, bot evals assume random draws
(re-benchmark under variant — deterministic bonuses make ISMCTS stronger vs
humans), and redaction (opp bonus values become inferable when ordered).

## UPDATE 2026-07-26 — selection-staleness fix + persistent login (all SHIPPED, main=5098ffe)
1. **Selection follows the CARD, not the slot (`a71b820`).** Vijay: pre-selecting
   during the opponent's turn sometimes fired a move he never chose; and
   camels-selected + hand-click didn't switch intent. Council (4 lenses) isolated
   both: (A) index-keyed selection re-pointed when the market compacted/refilled
   under it (only reachable vs async bots + online); (B) the mid-exchange gate
   `selMarket.length<2` mistook a 2-3-camel group-select for an exchange.
   Fix confined to GameScreen.tsx: **Card.id-keyed selection re-resolved to live
   indices every render** (id stability verified in BOTH modes — engine moves
   refs; worker view.ts sends market/myHand verbatim). Fail-safe: vanished
   single silently clears; a broken multi-card exchange collapses WHOLE (the
   app may clear, never substitute). Herd-camel -1 stays a plain counter.
   HARD CONSTRAINT honored: no turn-gating, no confirms, zero added latency —
   a still-valid selection survives the opponent's move untouched (test A3).
   +7 tests (592).
2. **Persistent login (`7a06490` + identity `vgames-platform@4e92f29`).**
   Measured: /auth/login minted 1h tokens vs /auth/quick's 24h — logging in was
   worse than staying a guest; refresh was reactive-only (401). Client:
   tokenExpiry.ts + tokenRefresh.ts (boot/visibility/focus/15-min proactive
   refresh, 10-min skew), post-login upgrade to the 24h device token, failed
   refresh can never sign out a valid session. Identity service: **vgames TTL
   1h→24h** (deploys from vgames-platform/services/identity/ — viota's copy is
   legacy). Verified live 1.0h→24.0h; vjaipur+viota consumers 200 pre+post.
   vwiki agent notified in-repo. NOTE (pre-existing): viota /my-games 401s on
   vgames-iss login tokens (its client only uses quick tokens — latent, not live).
   +29 tests (621).
3. **Rules check by execution: sell 4 into a 3-token pile still earns the
   FOUR-tier bonus** (tier = cards sold). Regression test added; Vijay caught
   the fixture using an unreachable pile ([5,3,3]→[2,1,1], `5098ffe`). 622 tests.
4. Next session: per-game verifier runs (Vijay dispatching each game's agents);
   decommission still HELD ("will retire later").

## UPDATE 2026-07-27 — first match_logs harvest: ISMCTS health check + early stop (430c2ac)
Corpus: 87 real Vijay-vs-ISMCTS games (07-25→27), 1729 human + 1681 bot moves,
1645 with root-candidate diagnostics. Record vs ISMCTS overall: Vijay 44W-66L.
**Search verdict: HEALTHY, no strength tuning warranted** (median 60,612
iters/move, top1 share 0.84, 10% near-ties, q well-calibrated +0.43/-0.16 in
eventual wins/losses). Deliberately did NOT touch strength knobs (c, budget,
rollouts) — the bot wins 60% fairly, which is exactly what Vijay asked for.
**Shipped: unconditional-winner early stop** (65% of moves ended settled at
>=3x visit gap — the bot was thinking long after the move was decided).
Stops when the visit lead exceeds 1.25x the iterations the remaining budget
could run; max-visits pick provably unchanged. Gate: 0/69 fired stops changed
a move; ~30% avg think-time cut at 3000ms. Wall-clock mode only — pinned-
iteration fairness proofs untouched (both green). earlyStopped now in debug
info -> future match_logs can report fire rate in the wild.
Style notes for Vijay delivered in-session (token/card 3.79 vs bot 3.44; the
4-bonus gap 38 vs 56 is the main margin; loss trajectory = small compounding
deficits, win trajectory = late surge).

That one-off analysis is now a re-runnable tool: `tools/mlogs/analyze.mjs`
(`--pull` to dump match_logs/matches/players from D1, then a read mode that
prints the bot health block + a per-player style report for every account
with >=5 logged games). Frozen baseline + re-run instructions + "what to
watch in 3 months" at `docs/ai/2026-07-27-ismcts-baseline-eval.md`. Verified
digit-for-digit against the original Python script's output on the same
dump; metric definitions pinned by `tests/tools/mlogsAnalyze.test.ts` so they
can't silently drift.

## BACKLOG ADD 2026-07-27 — in-app "You vs the Bot" style panel
Surface the scripted analyzer's per-player report (action mix, sell-size
distribution, bonus sales, precious-at-2, tokens-per-card vs the bot's,
camel-take rate, score trajectory, round-end trigger) as a StatsDashboard tab
in the app itself, instead of only via `tools/mlogs/analyze.mjs` on demand.
Needs either a worker aggregate endpoint (`GET /my-style` or similar,
computing over that account's match_logs server-side) or a client-side
compute pass over already-fetched match data. **NOT started — awaiting
Vijay's call** on whether this is worth a tab (vs. staying a run-when-curious
CLI tool) and, if so, endpoint vs. client-compute.

## UPDATE 2026-07-27 night — live-match bug sweep (5a465c2, worker deployed)
Vijay+Sureka played WEFFFT (1-0) + 6DRHAJ (3-0, rounds 74-67/74-68/85-64 =
233-199 — totals VERIFIED correct against the archive; his "scoring stats
are off" was the fake breakdown). Three fixes shipped:
1. lastRoundReveal: real opponent GOODS tokens + bonus SUMS at round_end/
   match_over only (bonus VALUES still never leave the DO); fuzz-redaction
   extended, reveal verified null mid-round live post-deploy.
2. Stale final-move banner cleared at round_start (Sureka genuinely closed
   R1 AND R2 selling 3 silver — right attribution, wrong timing).
3. Online Rivals: display names via getHistory LEFT JOIN players (fallback
   Player <id8>).
CORRECTION on the earlier 21:12 join error: transient — NOT a workers.dev
block (disproven by their play minutes later). /api proxy fallback stays as
inert resilience; render.yaml route not active (auto-deploy takes builds,
not routes config) and that's fine.

## CORRECTION 2026-07-27 (Vijay caught it) — bonus-reveal rationale
Bonus piles are FULLY RESHUFFLED every round (setupRound -> initialBonusPiles(rng);
matches official Jaipur's per-round re-setup), so "revealing individual bonus
values at round end would let you count the pool between rounds" was WRONG.
The real invariant — and what fuzz-redaction actually asserts — is MID-ROUND
secrecy: opponent bonus values mid-round would expose their running score
(deliberately hidden for round-end suspense) and shift same-round bonus-draw
EV. Round-END individual values are provably safe to reveal; the shipped
sum-only display is UI minimalism, not security. Open offer: show the
opponent's actual bonus tokens on the round-end screen if Vijay wants it.

## UPDATE 2026-07-28 — MY STYLE tab SHIPPED (a834bab; client 718 / worker 255 tests)
Per-player "You vs the Bot" style read as a third Hall of Records tab.
Pipeline: mockup (docs/mockups/you-vs-bot-panel.html) -> Vijay picked
Variant A (tug-of-war) -> 4-lens design council (data-viz / Jaipur strategy /
statistics / product-UX) -> 5 blockers + ~20 accepted deltas ALL applied ->
shipped. Answers to Vijay's questions recorded: online matches can feed style
stats later from the public moves archive (full-info logging is client-side,
vs-AI only — full-info only matters for bot TUNING); panel covers ANY bot
tier (ismcts just has extra search diagnostics).
Zero-idle-compute (his constraint): computed ONLY on tab open, incremental
via style_cache(last_log_id) — merge-associativity proven in tests; match-end
path never touches it. Migration 0003 applied remotely (table verified —
first-run rollback quirk checked); worker deployed; live smoke: fresh ghost
200 games:0, unauthed 401.
Council highlights baked in: no fabricated numbers (test-enforced), coaching
conditioned + never advises holding precious 3-stacks, per-row minimum-N
floors (dimmed below), pp-vs-relative gap encoding split, 4-bonus as RATE,
new camel-majority-at-round-end metric, shared-scale gated sparklines,
neutral hero (win% only at 15+ games, "Hard bots are built to beat most
players"), ply-based cap-resistant phase bucketing. Council also fixed a
dormant bug in tools/mlogs/analyze.mjs phase bucketing (array-index vs ply)
— noted in the eval doc's watch list; analyze.mjs itself NOT yet patched
(baseline comparability unaffected today; patch alongside the next corpus
run).
Rejected (recorded): global bot-baseline pooling for low-N players — no
population to pool yet; per-row gates already prevent the harm.

## UPDATE 2026-07-28 (cont) — RIVALRY modal + deck warning (864e56b) + GAMES-first stats everywhere (9df4a24)
1. **RIVALRY modal**: click an Online Rival -> "YOU vs <name>" — games record
   + streak ("4-0 in games · across 2 matches"), lifetime points,
   camel-majority games, biggest game, per-game history grouped by match,
   craft rows (volume-gated), and the EDGE FINDER (Vijay overruled my
   no-coaching rule: "why not coaching?" — each viewer privately sees their
   largest opponent-favored gap as banter; leads-everywhere and
   not-enough-data fallbacks). Computed ON DEMAND from the public archive via
   deterministic goods-pile replay (engine's initialTokenPiles; no new
   logging, no cache needed at rivalry scale). Seat-swap correctness proven
   by fixture (seats differ per match). 404 no_shared_games; first smoke's
   404-for-everything was edge propagation lag, not a bug.
2. **Deck count warning**: amber #f09030 at <=6, red #e05050 at <=3.
3. **GAMES-first units everywhere** (Vijay's ruling; matches the home
   screen's own "1 GAME / 3 GAMES" vocabulary): GLOBAL leaderboard (ranking
   comparator unchanged, fed games), MY RECORDS, home RECORD strip,
   ProfileOverlay CAREER STATS. Split resolution: online EXACT via archive
   seals join; vs-AI forward EXACT via matches.games_won/games_lost
   (migration 0004 applied+verified); legacy vs-AI null -> by match result
   (exact for dominant matchLength-1). TOTAL Δ untouched — sum of per-match
   deltas == sum of per-game deltas (grouping invariance).
Suites: client 747 / worker 287. Known wall-clock contention flake
(hardAi2-class) appeared once per full run, green in isolation each time.

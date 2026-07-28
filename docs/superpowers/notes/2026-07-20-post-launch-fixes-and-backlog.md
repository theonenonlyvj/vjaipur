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

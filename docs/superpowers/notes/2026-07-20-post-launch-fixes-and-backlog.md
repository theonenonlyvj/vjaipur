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

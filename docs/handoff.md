# VJaipur Context Handoff

> ⚠️ **STALE — HISTORICAL ONLY (pre-2026-07-18).** This document describes the
> old Render-Node/socket.io/Supabase world. On 2026-07-18 online play was
> REBUILT server-authoritative on vjaipur's own Cloudflare Worker + DO + D1.
> **The living chronicle is
> [`docs/superpowers/notes/2026-07-20-post-launch-fixes-and-backlog.md`](superpowers/notes/2026-07-20-post-launch-fixes-and-backlog.md)**
> (and its 07-18 sibling for the rebuild itself). Read those first; use this
> file only for pre-rebuild archaeology. *(Banner added 2026-08-03.)*


Last updated: 2026-07-15 (2026-07-15 update appended; body below it is the 2026-07-09 pass)

## 2026-07-15 Update (read this first)

Big things changed since the 2026-07-09 pass below was written:

1. **The P0 account hole is CLOSED.** vjaipur auth was cut over to **VGames Identity**
   (commit `51821cb`, 2026-07-13, live on Render). SECURE/RESTORE are tombstones returning
   `{error:'gone'}`; passwords are PBKDF2-hashed in the shared VGames worker; plaintext
   `secret_key`s were scrubbed from Supabase. Cross-device restore = PULL_HISTORY (`a28d122`,
   cold-start-tolerant via `3eeb059`).
2. **A full account/stats/competitiveness critique of the whole VGames estate ran 2026-07-15** —
   read `../vgames-platform/docs/council/2026-07-15-account-stats-critique.md` and
   `../vgames-platform/docs/CURRENT-STATE.md` before planning new work here.
3. **Overnight 2026-07-15 fixes landed on main (local commits, NOT pushed/deployed):**
   - `282b676` claim state tracked explicitly — renaming no longer hides Create Account forever
     (the old `Guest_` prefix heuristic was a dead-end; `claimed?: boolean` in statsStore,
     self-heals from VGames auth `status`).
   - `f2bb6c9` global leaderboard ranks by skill (win rate, 3-game qualification floor) instead
     of games played.
   - `7216e7b` dead legacy account-restore paths deleted (statsStore syncFullHistory/
     pullFullHistory, socketService wrappers, server/db createPlayer/getPlayerByCode/
     updatePlayerName). The LIVE VGames paths (restoreAccount/secureAccount/pullVGamesHistory)
     kept — same names, don't confuse them.
   - `28b6e41` this docs tree committed.
   **Deploying these to users = push main → Render auto-deploys. Needs Vijay's explicit go.**
4. **Remaining known-red tests (pre-existing):** client `DisconnectBanner` (180s vs 60s grace
   mismatch); server `getPlayerMatches` stale mock + `roomManager` 60s timer. All documented in
   `docs/engineering/testing.md`.
5. **Top open items for this repo** (from the council, ranked): online multiplayer redesign is
   still #1 product pain (never-forfeit); leaderboard rows should be keyed on `account_id` not
   mutable `display_name` (same-name friends currently merge into one row — needs a small
   server+protocol change); head-to-head "ONLINE RIVALS" data already exists in
   `StatsDashboard.tsx` — promote it out of the modal with real names; match scores are still
   client-submitted (trust-based) until the P3 server-authority work.

The section below is the original 2026-07-09 handoff, kept for context.

## Start Here After Context Reset

Read these files in order:

1. `/Users/vijayram/Cursor/AGENTS.md`
2. `AGENTS.md`
3. `README.md`
4. `docs/status.md`
5. `docs/superpowers/specs/2026-07-09-vjaipur-stabilization-design.md`
6. `docs/superpowers/plans/2026-07-09-vjaipur-stabilization.md`

## Current Decision Record

- Normal play must stay frictionless. Do not require an account or password just
  to use the site.
- Account/recovery work should be optional and should improve safety without
  creating a login wall.
- Online multiplayer should be reimagined, not lightly patched. The current
  infrastructure has forced forfeits even while both players were active.
- Hard II final polish is deferred until stabilization gates are green.
- Do not deploy, push, rotate keys, or mutate cloud resources without Vijay's
  explicit instruction.

## What Was Written In This Pass

Project/docs baseline:

- `AGENTS.md`
- `README.md`
- `.env.example`
- `.gitignore`
- `docs/handoff.md`
- `docs/status.md`
- `docs/product/onboarding.md`
- `docs/assets.md`
- `docs/operations/render-deployment.md`
- `docs/operations/admin-runbook.md`
- `docs/operations/supabase-schema.md`
- `docs/engineering/testing.md`
- `docs/engineering/release-checklist.md`
- `docs/superpowers/specs/2026-07-09-vjaipur-stabilization-design.md`
- `docs/superpowers/plans/2026-07-09-vjaipur-stabilization.md`

## Verification Already Run

Documentation checks:

- Secret/placeholder scan on the new docs: no matches.
- `git diff --check`: passed.

App checks from the stabilization audit:

- `npm run build`: passed.
- `npm run test`: failed with 1 known failure in `DisconnectBanner`.
- `npm run test:server`: failed with 6 known failures in server tests.

The failing tests are documented in `docs/engineering/testing.md`.

## Known Dirty Working Tree

Expected new/modified files from this pass:

- Documentation files listed above.
- `.gitignore`.

Pre-existing or unrelated dirty state still present:

- Modified `.DS_Store` files.
- Historical untracked `docs/superpowers/` plan/spec files.
- Untracked `ref/`.
- Some reference image/source folders may still be untracked depending on local
  checkout state.

No commit has been made.

## Recommended Next Work

Follow `docs/superpowers/plans/2026-07-09-vjaipur-stabilization.md` in this
order:

1. Task 2: Reconnect timeout contract.
2. Task 3: Server DB test cleanup.
3. Task 4: Minimal account safety without password wall.
4. Task 5: Online multiplayer redesign spec.
5. Task 6: Deployment hardening.
6. Task 7: Test warning cleanup.
7. Task 8: Asset/audio cleanup.
8. Task 9: Hard II final polish.

## Important Context For The Next Agent

- The Supabase outage was caused by the project being paused.
- A service-role key was visible in a screenshot during debugging. Treat that key
  as compromised unless Vijay confirms it was rotated.
- The online game reliability issue is a product-critical complaint, not a
  theoretical code smell.
- The current leaderboard/stats model is client-submitted and should be
  documented as trust-based until redesigned.

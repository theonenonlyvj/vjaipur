# VJaipur Status And Roadmap

Last reviewed: 2026-07-15 (update block added; the 2026-07-09 audit below is kept for history)

## 2026-07-15 Update

- **P0 Account Integrity: RESOLVED.** Auth cut over to VGames Identity (`51821cb`, live).
  Guest accounts are no longer claimable; no plaintext secrets; SECURE/RESTORE return gone.
- **Test reality now:** client 1 known failure (`DisconnectBanner` 180s/60s mismatch);
  server 2 known failures (`getPlayerMatches` stale mock, `roomManager` 60s timer) after the
  2026-07-15 dead-code cleanup removed the obsolete `getPlayerByCode` tests.
- **New on main (local, undeployed):** explicit claim-state tracking (fixes the rename→can-never-
  claim dead-end), skill-based global leaderboard sort, dead restore-path deletion, docs commit.
- **P1 Online Multiplayer Reliability: still the top open item** (unchanged below).
- **New known issue (council 2026-07-15):** leaderboard aggregates key on mutable `display_name`
  — two players with the same name merge into one row; fix = carry `account_id` through
  server `getLeaderboard` + protocol + client. Scores remain client-submitted (trust-based).
- Full critique: `../vgames-platform/docs/council/2026-07-15-account-stats-critique.md`.

## Summary

VJaipur is playable, but the next work should be stabilization rather than AI
polish. The highest-risk areas are account integrity, online multiplayer
reliability, production deployment assumptions, and test drift.

Normal play must stay frictionless. A player should be able to visit the site
and play without creating an account or setting a password.

## Council Findings

### P0: Account Integrity

- `secure_account` currently relies on a short friend code and does not require
  the existing guest secret. That means a guest account can be claimed if the
  friend code is guessed.
- The secure account password is currently stored in the same field as the guest
  secret and is returned to the client during restore. This is not a production
  password model.
- Username, display name, and recovery identity are conflated.

Direction: keep anonymous play, but make account recovery optional and safer.
The first code pass should require the existing guest secret to secure a guest,
stop returning secrets unnecessarily, and document the current limitations.

### P1: Online Multiplayer Reliability

The current Socket.IO online mode is a trust-based state relay. Real play has
seen active users time out and force forfeits. The right next step is not a
small timeout tweak; it is an online subsystem redesign.

Direction: design a room protocol with explicit player session tokens,
heartbeats, reconnect grace, server-visible readiness, and server-side action
validation or a clearly documented trust boundary.

### P1: Tests Are Red

Fresh audit:

- `npm run test`: 1 failing test, 254 passing.
- `npm run test:server`: 6 failing tests, 17 passing.

Known failures:

- Disconnect timeout is inconsistent between UI, server, and tests.
- Server DB tests mock an older Supabase query shape.
- Server disconnect timer test expects 60 seconds while server code uses 180
  seconds.

### P1: Deployment And Operations

- `render.yaml` does not document all required server env vars.
- The production server starts with `npx tsx`, which depends on dev tooling.
- Supabase Free projects can pause, breaking account and leaderboard features.
- The admin runbook needs key rotation, pause/resume, readiness checks, and
  deploy verification steps.

### P2: Repo And Asset Hygiene

- `.gitignore` was too narrow.
- The repo has historical Superpowers docs with unchecked boxes that do not
  necessarily represent live work.
- Public sound files are currently zero-byte placeholders.
- Card visuals and texture assets depend on external runtime URLs and need
  provenance/attribution decisions.

## Current Pending Work

1. Stabilize account and identity model without a password wall.
2. Reimagine online multiplayer instead of patching the current unreliable
   reconnect flow.
3. Restore green test gates.
4. Document deployment, admin operations, schema, assets, and release process.
5. Replace or remove zero-byte audio files.
6. After the above: revisit Hard II final polish.

## Historical Plan Handling

Files under `docs/superpowers/` are useful context, but many unchecked boxes are
historical. A task is considered live only if it appears in this status file,
the current stabilization plan, or current failing tests/code comments.

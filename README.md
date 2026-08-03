# VJaipur

VJaipur is a private React/TypeScript implementation of Jaipur. It supports
local pass-and-play, AI opponents, online rooms, local match stats, and
account/history/leaderboard features.

> ⚠️ **STALE — the "Current Status" and "App Modes" sections below are
> pre-2026-07-18 and misdescribe today.** Online play was REBUILT
> server-authoritative on vjaipur's own Cloudflare Worker + Durable Object +
> D1 (no more Socket.IO relay, no more forfeit-on-disconnect), and accounts
> moved from Supabase to VGames Identity. The living chronicle is
> [`docs/superpowers/notes/2026-07-20-post-launch-fixes-and-backlog.md`](docs/superpowers/notes/2026-07-20-post-launch-fixes-and-backlog.md)
> (and its 07-18 sibling for the rebuild itself) — read those first; treat
> this section as historical only. *(Banner added 2026-08-03.)*

## Current Status

The game is playable, but the app is in a stabilization phase before more AI
polish. The priority is to make accounts, online play, tests, deployment, and
documentation reliable before continuing Hard II tuning.

See:

- `docs/handoff.md` for a context-reset handoff.
- `docs/status.md` for the live audit and priority roadmap.
- `docs/superpowers/plans/2026-07-09-vjaipur-stabilization.md` for code tasks.
- `docs/operations/admin-runbook.md` for Supabase and production operations.
- `docs/operations/render-deployment.md` for Render deployment notes.

## App Modes

- **vs AI**: Easy, Medium, Hard, Hard II, Hard III, and Fair Bot.
- **Local**: Pass-and-play on one device.
- **Online**: Socket.IO room-based multiplayer. This needs redesign; the
  current implementation has known reconnect/forfeit reliability issues.

Normal play should remain frictionless. Players should not need to create an
account or set a password just to use the site.

## Local Setup

Install dependencies from the project folder:

```bash
npm install
```

Create local env files as needed:

```bash
cp .env.example .env.local
```

Run the client:

```bash
npm run dev
```

Run the Socket.IO server:

```bash
npm run server:dev
```

## Scripts

```bash
npm run dev          # Vite client
npm run server:dev   # local Socket.IO server with watch mode
npm run build        # TypeScript check and Vite build
npm run test         # client/engine/UI tests
npm run test:server  # server tests
npm run test:all     # client plus server test suites
```

> ⚠️ **STALE — "Environment Variables", "Documentation Map", and "Notes For
> Future Work" below are also pre-2026-07-18.** `.env.example` at the repo
> root is the current source of truth for env vars (client AND server —
> including the VGames Identity/worker URLs this section omits entirely);
> Hard II/III and an ISMCTS eval pass have long since shipped. See the same
> living chronicle linked above. *(Banner added 2026-08-03.)*

## Environment Variables

Client:

- `VITE_SERVER_URL`: public Socket.IO server URL.

Server:

- `CLIENT_ORIGIN`: allowed browser origin for CORS.
- `SUPABASE_URL`: Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only Supabase service role key.

Never expose `SUPABASE_SERVICE_ROLE_KEY` to the client or screenshots. Rotate it
if it is ever shown.

## Documentation Map

- `docs/status.md`: current shipped state, findings, next steps.
- `docs/assets.md`: asset provenance and gaps.
- `docs/product/onboarding.md`: player flows and account intent.
- `docs/operations/render-deployment.md`: Render setup and deploy checks.
- `docs/operations/admin-runbook.md`: operational procedures.
- `docs/operations/supabase-schema.md`: inferred database shape and migration
  notes.
- `docs/engineering/testing.md`: verification gates and current failures.
- `docs/engineering/release-checklist.md`: release readiness checklist.

## Notes For Future Work

Hard II polish is intentionally paused until stabilization is complete. Online
mode should be reimagined instead of lightly patched, because real games have
timed out and forced forfeits even while both players were active.

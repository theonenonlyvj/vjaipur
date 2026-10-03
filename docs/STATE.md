# VJaipur Current State

This is the current architecture and invariant reference. Use
[`handoff/START_HERE.md`](handoff/START_HERE.md) for the reading order and
[`BACKLOG.md`](BACKLOG.md) for open work. Files under `docs/superpowers/` are
historical records, not live instructions.

## Architecture

- **Client:** React, Zustand, and Vite in `src/`; hosted as a Render static
  site. `src/net/` provides the online HTTP and nudge-WebSocket client.
- **Rules engine:** pure TypeScript in `src/engine/`, imported by both client
  and Worker. This directory is certified and locked.
- **AI:** browser Web Workers and the tier implementations in `src/ai/`.
- **Online authority:** the Cloudflare Worker in `worker/`. A SQLite-backed
  Durable Object owns each live game; D1 stores the queryable archive, stats,
  leaderboards, and local-vs-AI reports.
- **Identity:** VGames Identity is a separate Worker. The client obtains
  tokens from it and the game Worker introspects those tokens.
- **Hosting:** Render serves the static client and provides same-origin
  `/api/*` and `/id-api/*` proxy fallbacks.

## Required Invariants

- Do not edit `src/engine/**` without explicit certified-engine approval.
- Opponent hand, deck order, and individual bonus values must never leave the
  game Durable Object. `worker/src/do/view.ts` is an allowlist boundary.
- Fair AI tiers must not change their decision when only hidden information
  changes; the pinned-iteration fairness tests enforce this.
- Online moves are server-authoritative and idempotent.
- A game is one deal/round; a match is the best-of-N sitting. User-facing
  stats use games first and matches as secondary context.
- Stats and profile writes require an authenticated account. Display-name
  changes use `POST /stats/profile` and write to the Worker's D1 player row.

## Legacy compatibility and retirement gate

The updated client uses the Worker for profile changes. The Node/Socket.IO
server, its dependencies, tests, Supabase integration, and Render definition
remain available for older deployed clients. Repository inspection alone does
not prove production traffic has stopped using them. Retire them only after
Worker-first deployment, client smoke tests, and observed legacy traffic and
dependency checks. Keep the Render static site.

## Verification Gates

```bash
npm run test
npm run build
npm run test:all
```

The combined gate runs the root, legacy-server, and `worker` tests. Do not hardcode
test counts here; use each command's summary as the source of truth.

## Operations

- A normal push rebuilds the Render static site but does not necessarily apply
  Blueprint route/header changes. When `render.yaml` changes, manually sync
  the Blueprint in Render and verify `/api/*`, `/id-api/*`, and cache headers.
- Worker deployment and D1 migration commands are documented in
  [`../worker/DEPLOY.md`](../worker/DEPLOY.md).
- The Worker's `IDENTITY` service binding is preferred for token introspection;
  its public URL remains the fallback.

## Pointers

- [Current handoff](handoff.md)
- [Live backlog](BACKLOG.md)
- [Testing](engineering/testing.md)
- [Release checklist](engineering/release-checklist.md)
- [Render operations](operations/render-deployment.md)
- [Historical online rebuild record](superpowers/notes/2026-07-18-overnight-online-rebuild.md)

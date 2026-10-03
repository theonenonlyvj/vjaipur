# VJaipur

VJaipur is a public React/TypeScript implementation of Jaipur. It supports
local pass-and-play, six AI difficulty tiers, server-authoritative online
rooms, account-backed stats, leaderboards, and local play analysis.

## Architecture

- The Vite/React client lives in `src/` and is hosted as a Render static site.
- The rules engine lives in `src/engine/` and is shared by client and Worker.
- The Cloudflare Worker in `worker/` owns online games through Durable Objects
  and stores archives and stats in D1.
- VGames Identity issues and introspects account tokens.
- Render rewrites `/api/*` and `/id-api/*` to the two Workers so clients can
  fall back to same-origin requests.

The updated client uses the Worker for profile changes. The Node/Socket.IO
server, its dependencies, tests, Supabase integration, and Render definition
remain available for older deployed clients. Repository inspection alone does
not prove production traffic has stopped using them. Retire them only after
Worker-first deployment, client smoke tests, and observed legacy traffic and
dependency checks. Keep the Render static site.

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Run the Worker locally in a second shell:

```bash
cd worker
npm install
npm run dev
```

## Verification

```bash
npm run test       # client, engine, and UI
npm run build      # TypeScript and production client build
npm run test:all   # root suite, then Worker suite
```

## Documentation

- [`docs/handoff/START_HERE.md`](docs/handoff/START_HERE.md): orientation
- [`docs/STATE.md`](docs/STATE.md): architecture and invariants
- [`docs/BACKLOG.md`](docs/BACKLOG.md): open work
- [`docs/engineering/testing.md`](docs/engineering/testing.md): test gates
- [`docs/operations/render-deployment.md`](docs/operations/render-deployment.md): static-site deployment
- [`worker/DEPLOY.md`](worker/DEPLOY.md): Worker and D1 operations

Historical specs and implementation notes are retained under
`docs/superpowers/`; current code and the documents above take precedence.

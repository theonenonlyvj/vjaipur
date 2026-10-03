# VJaipur Agent Guide

VJaipur is a public TypeScript/React implementation of Jaipur with local play,
AI opponents, server-authoritative online play, stats, and leaderboards.

Follow any workspace-level `AGENTS.md` discovered in parent directories first.
These project-local rules add the app-specific constraints below.

## Project Boundary

- Run package-manager commands from this repository root (or `worker/` where a
  worker command explicitly requires it).
- Do not add remotes, push, deploy, rotate secrets, or mutate cloud resources
  without explicit authorization.
- Do not commit unless explicitly asked.
- Keep public files free of personal data, secrets, machine-specific paths,
  private operational records, and tool or model attribution.

## Protected Code

`src/engine/**` is certified and locked. It is shared by the browser client and
the Cloudflare Worker. Do not edit it without explicit engine-change approval.
Keep the fairness and redaction tests green when changing AI or online play.

## Architecture

- `src/`: Vite/React client, local play, AI, and Worker API client.
- `worker/`: Cloudflare Worker, Durable Object game authority, and D1-backed
  stats/archive APIs.
- Identity is provided by the separately deployed VGames Identity Worker.
- Render hosts the static client and same-origin API proxy routes.

The updated client uses the Worker for profile changes. The Node/Socket.IO
server, its dependencies, tests, Supabase integration, and Render definition
remain available for older deployed clients. Repository inspection alone does
not prove production traffic has stopped using them. Retire them only after
Worker-first deployment, client smoke tests, and observed legacy traffic and
dependency checks. Keep the Render static site.

## Verification

```bash
npm run test
npm run build
npm run test:all
```

`npm run test:all` runs the root suite followed by the Worker suite. Start at
`docs/handoff/START_HERE.md` after a context reset.

## Generated And Local Files

Do not stage generated or local artifacts unless the task explicitly requires
them, including `dist/`, `node_modules/`, `.superpowers/`, and `.DS_Store`.

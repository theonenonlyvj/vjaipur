# VJaipur Handoff

Start with [`handoff/START_HERE.md`](handoff/START_HERE.md). The current
architecture is in [`STATE.md`](STATE.md), and open work is in
[`BACKLOG.md`](BACKLOG.md).

## Current Runtime

The React client uses the Cloudflare Worker for online play, stats, and profile
updates. Durable Objects own live game state, D1 stores archives/statistics,
and VGames Identity owns authentication. Render hosts the static client and
same-origin proxy routes.

The updated client uses the Worker for profile changes. The Node/Socket.IO
server, its dependencies, tests, Supabase integration, and Render definition
remain available for older deployed clients. Repository inspection alone does
not prove production traffic has stopped using them. Retire them only after
Worker-first deployment, client smoke tests, and observed legacy traffic and
dependency checks. Keep the Render static site.

## Operational follow-through

- Deploy and smoke-test the Worker before pushing the new client.
- Verify the live client and same-origin API/identity proxy routes.
- Legacy Render/Supabase retirement remains blocked on runtime evidence.
- Sync Render Blueprint changes only when configuration actually changes.

## Guardrails

- `src/engine/**` is certified and locked.
- Do not expose secrets, account records, or raw production match data.
- Do not treat historical `docs/superpowers/` checklists as current work.
- Run `npm run test:all` and `npm run build` before release claims.

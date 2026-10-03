# VJaipur Worker Operations

The Cloudflare Worker is the server-authoritative online runtime. Durable
Objects own live games and D1 stores archives, players, stats, and analysis.

## Local Verification

```bash
cd worker
npm install
npm test
```

From the repository root, `npm run test:all` runs both root and Worker suites.

## D1 Migrations

```bash
cd worker
npx wrangler d1 migrations apply vjaipur --remote
```

Review every migration before applying it. Afterward, use sanitized read-only
queries to confirm expected tables/columns; do not print account records.

## Deployment

```bash
cd worker
npx wrangler deploy
```

Production requires the D1 binding, `GAME_DO`, the `IDENTITY` service binding,
and an exact `CLIENT_ORIGIN` secret for the Render static-site origin. Public
endpoint URLs live in configuration; credentials do not.

After deploy, smoke-test token introspection, create/join, legal moves,
redaction, idempotent replay, profile rename, stats, and resume behavior before
changing any external legacy service.

## Historical Import Tool

`scripts/migrate-stats.mjs` is retained only for reproducible one-way imports
from an exported legacy Supabase dataset into D1 SQL. Neither the Worker nor
the client imports it. It does not justify keeping the old service online.

## External Retirement Boundary

The updated client uses the Worker for profile changes. The Node/Socket.IO
server, its dependencies, tests, Supabase integration, and Render definition
remain available for older deployed clients. Repository inspection alone does
not prove production traffic has stopped using them. Retire them only after
Worker-first deployment, client smoke tests, and observed legacy traffic and
dependency checks. Keep the Render static site.

# Legacy Supabase schema

The retained compatibility server in `server/db.ts` uses the legacy `players`
and `matches` tables. Current Worker traffic uses D1; older deployed clients
may still reach the legacy server. Never commit credentials or raw exports.

`worker/scripts/migrate-stats.mjs` converts exported legacy match data into D1
SQL offline. It does not authorize applying SQL or deleting the source store.

The updated client uses the Worker for profile changes. The Node/Socket.IO
server, its dependencies, tests, Supabase integration, and Render definition
remain available for older deployed clients. Repository inspection alone does
not prove production traffic has stopped using them. Retire them only after
Worker-first deployment, client smoke tests, and observed legacy traffic and
dependency checks. Keep the Render static site.

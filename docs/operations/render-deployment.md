# Render Deployment

## Services

`render.yaml` defines two services:

- `vjaipur-server`: Node web service for Socket.IO and Supabase-backed data.
- `vjaipur-client`: static Vite client.

## Required Environment Variables

Server service:

- `NODE_ENV=production`
- `CLIENT_ORIGIN`: exact allowed client origin.
- `SUPABASE_URL`: Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only service role key.

Client service:

- `VITE_SERVER_URL`: public URL of `vjaipur-server`.

## Important Boundaries

- Do not put `SUPABASE_SERVICE_ROLE_KEY` on the static client service.
- Do not expose service-role keys in screenshots, logs, browser bundles, or docs.
- Rotate the service-role key if it is ever exposed.

## Supabase Pause Failure Mode

If the Supabase project is paused, account restore, stats sync, and global
leaderboard can fail even when the Render server itself is healthy.

Symptoms:

- Global leaderboard shows "Could not load leaderboard."
- Restore/login fails.
- Server logs show Supabase fetch/query failures.

Recovery:

1. Resume the Supabase project.
2. Rotate exposed keys if needed.
3. Update Render server env vars if keys changed.
4. Restart `vjaipur-server`.
5. Test `/health`, then account restore and leaderboard.

## Deployment Risk

The current production server start command uses `npx tsx server/index.ts`.
This is convenient but fragile for production because it relies on TypeScript
runtime tooling. A stabilization task should either precompile the server or
make the runtime dependency explicit.

## Pre-Deploy Checks

Run locally:

```bash
npm run build
npm run test
npm run test:server
```

Known current state: these test gates are not green yet. See
`docs/engineering/testing.md`.

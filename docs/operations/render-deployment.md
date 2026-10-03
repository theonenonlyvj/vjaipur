# Render Deployment

`render.yaml` retains the `vjaipur-server` compatibility service and the
`vjaipur-client` static Vite site. The static site defines ordered same-origin
proxy routes:

- `/api/*` → the VJaipur game Worker
- `/id-api/*` → VGames Identity
- `/*` → `/index.html` for SPA navigation

The API routes must remain above the SPA catch-all. Cache headers keep
`index.html` revalidated while allowing hashed assets to be immutable.

## Client Environment

- `VITE_VJAIPUR_WORKER_URL`: game Worker base URL.
- `VITE_VGAMES_URL`: VGames Identity base URL.

These are public endpoints, not credentials. Never add Worker secrets or
production account data to the static site's environment.

## Legacy server environment

The compatibility server retains `npm run server:start`. Keep `VGAMES_URL`
pointing at VGames Identity; `SUPABASE_URL` and the server-only
`SUPABASE_SERVICE_ROLE_KEY` configure its legacy store. `CLIENT_ORIGIN`
limits browser origins, and `PORT` configures its listener. Never expose the
service-role key in client variables or commit its value. See `.env.example`.

## Deployment Checks

```bash
npm run test:all
npm run build
```

After deployment, verify the served bundle changed, then smoke-test online
create/join, authenticated profile rename, stats, and both same-origin proxy
paths.

## Blueprint Sync Required

A normal Render auto-deploy rebuilds the static site but may not apply changes
to Blueprint service definitions, routes, or headers. The legacy web service remains in `render.yaml` until its retirement gate is met.
Do not remove it merely because the new client no longer imports Socket.IO.

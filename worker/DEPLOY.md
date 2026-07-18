# vjaipur-worker — deploy + cutover runbook (2026-07-18)

Server-authoritative online rebuild. Rollback anchor = tag
`checkpoint-2026-07-18-pre-online-worker` (current main tip before the online
commits). Rollback = `git push origin checkpoint-2026-07-18-pre-online-worker^{}:main --force-with-lease`
(client reverts to the Socket.IO relay, which still runs on Render).

## Preconditions
- Worker green: `cd worker && npm test` (140+). Client green: root `npm run test`.
- wrangler authed on the theonenonlyvj Cloudflare account (`wrangler whoami`).
- vgames-identity is live and its `CLIENT_ORIGIN` allowlist already includes
  `https://vjaipur-game.onrender.com` (it does, from the P1 cutover) — needed
  because the client calls vgames-identity DIRECTLY for auth/quick.

## A. Deploy the worker + D1 (autonomous — no live-user impact yet)
1. `cd worker && npx wrangler d1 create vjaipur` → copy the printed `database_id`.
2. Replace `PLACEHOLDER_REPLACE_AT_DEPLOY` in `worker/wrangler.toml` with it.
3. `npx wrangler d1 migrations apply vjaipur --remote` (applies `migrations/0001_init.sql`).
   (If wrangler wants a migrations-table bootstrap, `wrangler d1 execute vjaipur --remote --file=migrations/0001_init.sql` is the fallback.)
4. `npx wrangler secret put CLIENT_ORIGIN` → `https://vjaipur-game.onrender.com`
   (pins CORS to the client origin; server-to-server introspect is exempt).
5. `npx wrangler deploy` → `https://vjaipur-worker.theonenonlyvj.workers.dev`.
6. **Live e2e** (browser UA — Cloudflare WAF 403s python-urllib): quick-auth two
   ghost accounts against vgames-identity → POST /games → resolve → join (deals)
   → play a scripted round → assert redaction (opp hand absent) + idempotent
   replay + a stats row after match_over. Script lives in scratchpad.

Deploying the worker does NOT touch live users — the live client still talks to
the old Render relay until step C.

## B. Stats migration (Supabase → the new D1) — needs Vijay's Supabase key
Old match history (~39 rows incl. Vijay + Sureka) lives in Supabase. The new
client reads history/leaderboard from the worker's D1, which starts EMPTY. Port
it so cross-device history isn't blank on cutover:
1. `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node worker/scripts/migrate-stats.mjs --live`
   → writes `worker/scripts/out/d1-matches.sql` + `classification-report.md`
   (opponent_account_id NULL for all; ISO→epoch-ms; source=client_reported).
2. Review the report (count, per-tier tally, skipped rows).
3. `npx wrangler d1 execute vjaipur --remote --file=worker/scripts/out/d1-matches.sql`
4. Spot-check: Vijay's + Sureka's totals in D1 match their in-app stats.
   (Supabase is left UNTOUCHED — rollback = ignore the D1 rows.)

## C. Client cutover — GATED (needs the Render dashboard, then a push)
1. **Vijay sets in Render** (static site `vjaipur-game`): env var
   `VITE_VJAIPUR_WORKER_URL = https://vjaipur-worker.theonenonlyvj.workers.dev`.
   (Vite bakes env at build time — MUST be set before the rebuild, or the
   client defaults to localhost and online breaks.)
2. Push `main` → Render auto-rebuilds the static client (and the unchanged Node
   backend, which keeps running for stale tabs). 
3. Verify the LIVE bundle: `curl https://vjaipur-game.onrender.com/` → grep the
   bundle for the worker URL (not localhost); create+join a real game between
   two devices; confirm never-forfeit (background a tab → AI covers, foreground
   → reclaim), stats land, redaction holds.

## Notes
- In-flight OLD-relay games at the cutover instant are lost (acceptable at
  ~10-user scale). New games route to the worker.
- The old Render Node backend + Supabase can be decommissioned in a later pass
  once no stale clients remain.
- Quick-match + veto are deferred (fast-follow); Lobby is create/join-by-code.

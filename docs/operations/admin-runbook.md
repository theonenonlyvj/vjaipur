# Admin Runbook

## Common Incidents

### Supabase Project Paused

Impact:

- Account restore fails.
- Stats sync fails.
- Global leaderboard fails.

Action:

1. Resume the Supabase project in Supabase Studio.
2. Confirm the project URL resolves.
3. Restart the Render server.
4. Verify leaderboard and restore flows.

### Service Role Key Exposed

Impact:

- Anyone with the key can bypass row-level policies through server-side API
  access.

Action:

1. Rotate the service-role key in Supabase.
2. Update `SUPABASE_SERVICE_ROLE_KEY` on `vjaipur-server`.
3. Restart/redeploy the server.
4. Search logs/screenshots/docs for the old key and remove visible copies.

### Online Game Incorrectly Forfeits

Impact:

- Players can lose a match while both believe they are active.

Action:

1. Capture approximate time, room code if known, and both players' connection
   context.
2. Check server logs for disconnect/reconnect events.
3. Do not assume a timeout tweak is enough. The online subsystem needs session
   tokens, heartbeats, and server-side state ownership.

## Account Model Notes

The current model is not a complete production auth system. It was built for
frictionless play and stat recovery.

Do:

- Keep anonymous play available.
- Treat recovery/account security as optional.
- Require proof of current guest secret before securing a guest account.
- Avoid printing account secrets in logs.

Do not:

- Require a password to open or play the site.
- Use short friend codes as proof of account ownership.
- Return stored passwords/secrets unless a migration explicitly requires it.

## Useful Commands

```bash
npm run build
npm run test
npm run test:server
npm run test:all
```

## Data Checks

Use read-only Supabase checks when diagnosing production data. Print counts and
sanitized error codes only. Do not print service-role keys or raw secrets.

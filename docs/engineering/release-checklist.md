# Release Checklist

## Required Verification

- [ ] `npm run build`
- [ ] `npm run test`
- [ ] `npm run test:server`
- [ ] Manual smoke: open app, start vs AI game, make legal moves, finish round.
- [ ] Manual smoke: open Hall of Records, load Global leaderboard.
- [ ] Manual smoke: restore or sync an account using non-production test data.
- [ ] Manual smoke: online game create/join path.

## Security And Privacy

- [ ] No service-role key in screenshots, docs, logs, commits, or client bundle.
- [ ] Supabase service-role key is server-only.
- [ ] Render server env has `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- [ ] Render client env has only `VITE_SERVER_URL`.
- [ ] Auth/account logs are redacted.

## Product Expectations

- [ ] A new visitor can play without account setup.
- [ ] Account recovery is optional and clearly explained.
- [ ] Online disconnect policy shown in UI matches server behavior.
- [ ] Leaderboard limitations are documented if results remain client-submitted.

## Assets

- [ ] Zero-byte sound placeholders are replaced or sound UI is hidden.
- [ ] External runtime asset dependencies are documented or vendored.
- [ ] OG image and canonical URL are correct.

## Operations

- [ ] Supabase project is active.
- [ ] Supabase key rotation runbook is current.
- [ ] Render services are healthy after deploy.
- [ ] Rollback path is known.

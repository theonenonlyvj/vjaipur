# Release Checklist

## Automated Gates

- [ ] `npm run test`
- [ ] `npm run build`
- [ ] `npm run test:all`

## Manual Smoke Tests

- [ ] Start and finish a local game against an AI tier.
- [ ] Create and join an online room from two sessions.
- [ ] Rename an authenticated profile and confirm it survives a reload.
- [ ] Load history, leaderboard, and style views.
- [ ] Confirm reconnect/resume and same-origin API fallback behavior.

## Security And Privacy

- [ ] No secrets, account identifiers, production records, personal data, or
      machine-specific paths appear in tracked files or browser bundles.
- [ ] Opponent hidden state remains redacted from Worker responses and D1 move
      payloads.
- [ ] Anonymous play remains available; account recovery is optional.

## Operations

- [ ] D1 migrations are applied and verified with sanitized read-only checks.
- [ ] Worker and static site health are verified after deployment.
- [ ] Render Blueprint changes are manually synced when `render.yaml` changes.
- [ ] Rollback points and owners are known before external service retirement.

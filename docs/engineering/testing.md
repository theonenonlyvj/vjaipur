# Testing And Verification

## Commands

```bash
npm run build
npm run test
npm run test:server
npm run test:all
```

## Current Fresh Results

As of 2026-07-09:

- `npm run build`: passed.
- `npm run test`: 1 failed, 254 passed.
- `npm run test:server`: 6 failed, 17 passed.

## Known Failing Areas

### Disconnect Timeout

The UI component, UI test, server timeout, and server test disagree about the
forfeit grace period.

Current observed values:

- UI component starts at 60 seconds.
- UI test expects 180 seconds.
- Server uses 180 seconds.
- Server test advances 60 seconds.

Resolution: define one reconnect grace constant and use it consistently.

### Server DB Tests

`tests/server/db.test.ts` mocks an older Supabase chain:

- Current code calls `.limit(1)`.
- Tests still seed `.single()` results.
- `getPlayerMatches` orders by `timestamp`, while the test expects
  `created_at`.

Resolution: update the fake Supabase query builder and expectations to match
current code.

## Warning Noise

Passing UI tests emit:

- React ref warnings from animated `CardView` with Framer Motion `popLayout`.
- React Router future-flag warnings.

Resolution: use `forwardRef` for animated cards and consciously configure or
accept Router future flags.

## Slow Tests

Fair Bot tests dominate runtime because they call production search budgets.

Resolution: inject test budgets or depth caps for normal tests, and keep any
expensive search test as a separate smoke test.

## Release Gate

Do not claim release readiness until:

```bash
npm run build
npm run test
npm run test:server
```

all exit with status 0.

# Testing And Verification

## Commands

```bash
npm run build
npm run test
npm run test:server
npm run test:all
```

## Current Fresh Results

Pass/fail counts drift too fast to hardcode here reliably (2026-08-03: this
line was still reading "1 failed, 254 passed" from 2026-07-09 long after the
real suite had grown past 750 client tests). Run the commands below and read
their own summary line — that output is always the source of truth, not this
doc:

- Client/engine/UI: `npm run test` (from the project root).
- Worker: `cd worker && npm test`.
- Legacy server (see "Server DB Tests" below): `npm run test:server`.

tsconfig.json's `include` is `["src", "tests"]` — it does not cover
`server/`, so `npm run build`'s `tsc` step never typechecks the legacy
server; `npm run test:server` (vitest, not tsc) is the only gate on that
code.

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

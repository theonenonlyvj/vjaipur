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

*(2026-08-03: this section previously described a Disconnect Timeout
mismatch and Server DB mock drift from the 2026-07-09 audit. Neither
reproduces today — all suites, including the legacy server's 48 tests, pass
green — and the disconnect model itself was replaced by the 2026-07-18
server-authoritative rebuild (no auto-forfeit; pause/claim-win instead). No
known failing areas at present; the one recurring non-failure is the heavy
AI wall-clock tests flaking under full-suite CPU contention — always green
in isolation, documented in docs/STATE.md.)*

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

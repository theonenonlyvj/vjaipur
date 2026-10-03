# Testing And Verification

## Required Commands

```bash
npm run test
npm run build
npm run test:all
```

- `npm run test` runs client, engine, UI, and root tooling tests.
- `npm run build` typechecks the client/tests and builds the Vite bundle.
- `npm run test:all` runs the root suite followed by `worker` tests.

The Worker has its own dependency tree. Install it with `npm install` from
`worker/` before running the combined gate in a fresh checkout.

## Focused Commands

```bash
npm test -- tests/net/online.test.ts tests/ui/statsStore.test.ts
cd worker && npm test -- test/stats.test.ts
```

Passing UI tests may emit React Router future-flag warnings. Search-budget
tests can be sensitive to heavy machine contention; a failure must reproduce
in isolation before it is classified as a product regression.

Do not record fixed test counts here. Command output is the source of truth.

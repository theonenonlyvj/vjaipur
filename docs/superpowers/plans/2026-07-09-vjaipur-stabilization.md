# VJaipur Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize VJaipur before Hard II polish by fixing test drift, account safety, online architecture, deployment reliability, and documentation.

**Architecture:** Keep normal play account-free. Split stabilization into independently reviewable tracks: documentation, test contract cleanup, account safety, online redesign, deployment hardening, and later gameplay polish. Avoid full auth or server-authoritative multiplayer rewrites until their specs are reviewed.

**Tech Stack:** React 18, Vite, TypeScript, Zustand, Socket.IO, Express, Supabase, Vitest.

## Global Constraints

- Do not require a password or account to use the site.
- Do not print or commit Supabase service-role keys.
- Do not deploy, push, rotate keys, or mutate production cloud resources without explicit instruction.
- Treat historical unchecked `docs/superpowers/` boxes as historical unless corroborated by current code or tests.
- Hard II final polish waits until stabilization gates are green.

---

### Task 1: Documentation Baseline

**Files:**
- Create or update: `README.md`
- Create or update: `AGENTS.md`
- Create or update: `docs/status.md`
- Create or update: `docs/product/onboarding.md`
- Create or update: `docs/assets.md`
- Create or update: `docs/operations/render-deployment.md`
- Create or update: `docs/operations/admin-runbook.md`
- Create or update: `docs/operations/supabase-schema.md`
- Create or update: `docs/engineering/testing.md`
- Create or update: `docs/engineering/release-checklist.md`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: Current repo audit findings.
- Produces: Authoritative docs for future code tasks.

- [ ] **Step 1: Verify docs are present**

Run:

```bash
find . -maxdepth 3 -type f \
  \( -name 'README.md' -o -path './docs/*' -o -name 'AGENTS.md' \) \
  | sort
```

Expected: the files listed above are present.

- [ ] **Step 2: Verify no secrets appear in docs**

Run:

```bash
rg -n "$(printf 'sb_%s' 'secret_')|$(printf 'ey%s' 'J')" README.md AGENTS.md docs .env.example
```

Expected: no service-role key values are printed. Variable names are acceptable.

- [ ] **Step 3: Review `.gitignore` coverage**

Run:

```bash
sed -n '1,120p' .gitignore
```

Expected: generated files, env files, and local session artifacts are ignored.

### Task 2: Reconnect Timeout Contract

**Files:**
- Modify: `src/shared/protocol.ts` or create `src/shared/config.ts`
- Modify: `src/components/DisconnectBanner.tsx`
- Modify: `server/roomManager.ts`
- Modify: `tests/ui/DisconnectBanner.test.tsx`
- Modify: `tests/server/roomManager.test.ts`

**Interfaces:**
- Produces: `RECONNECT_GRACE_SECONDS` and `RECONNECT_GRACE_MS`.
- Consumes: constants in UI, server, and tests.

- [ ] **Step 1: Add shared reconnect constants**

Preferred shape:

```ts
export const RECONNECT_GRACE_SECONDS = 180
export const RECONNECT_GRACE_MS = RECONNECT_GRACE_SECONDS * 1000
```

- [ ] **Step 2: Use the constants in the UI**

Replace local hard-coded `60` in `DisconnectBanner`.

- [ ] **Step 3: Use the constants in the server**

Replace local hard-coded `180_000` in `RoomManager.startDisconnectTimer`.

- [ ] **Step 4: Update tests**

UI test should assert `180s`. Server test should advance
`RECONNECT_GRACE_MS`.

- [ ] **Step 5: Verify**

Run:

```bash
npm run test -- tests/ui/DisconnectBanner.test.tsx
npm run test:server -- tests/server/roomManager.test.ts
```

Expected: both targeted suites pass.

### Task 3: Server DB Test Cleanup

**Files:**
- Modify: `tests/server/db.test.ts`

**Interfaces:**
- Consumes: current query shape in `server/db.ts`.
- Produces: tests that fail only on real DB wrapper regressions.

- [ ] **Step 1: Update the Supabase fake**

The fake query builder must include `limit`, and terminal methods should resolve
the shapes current code reads:

```ts
limit: vi.fn().mockReturnThis()
```

Tests for `getPlayerByCode` and `getPlayerByUsername` should mock `limit` to
resolve `{ data: [row], error: null }` or `{ data: [], error: null }`.

- [ ] **Step 2: Update stale expectations**

Use current behavior:

- `getPlayerMatches` orders by `timestamp`.
- `updatePlayerToSecured` updates existing players by `id`.

- [ ] **Step 3: Verify**

Run:

```bash
npm run test:server -- tests/server/db.test.ts
```

Expected: DB tests pass.

### Task 4: Minimal Account Safety Without Password Wall

**Files:**
- Modify: `src/shared/protocol.ts`
- Modify: `src/store/statsStore.ts`
- Modify: `server/index.ts`
- Modify: `server/db.ts`
- Modify or add: account-related tests.

**Interfaces:**
- `SecureAccountPayload` should include the current guest secret.
- Server must verify existing `friendCode` plus current secret before updating.

- [ ] **Step 1: Add current secret to secure-account payload**

Preferred shape:

```ts
export interface SecureAccountPayload {
  friendCode: string
  secretKey: string
  username: string
  password: string
}
```

- [ ] **Step 2: Send current secret from the client**

`statsStore.secureAccount` should call:

```ts
socketService.secureAccount({ friendCode, secretKey, username, password })
```

- [ ] **Step 3: Verify current guest before securing**

Server must reject if the current `friendCode` row does not exist or the
provided current secret does not match.

- [ ] **Step 4: Keep play frictionless**

Do not add any account wall to Home, Lobby, AI, Local, or Online play.

- [ ] **Step 5: Add tests**

Add server tests for:

- securing succeeds with correct current secret.
- securing fails with wrong current secret.
- display-name changes do not mark a guest as secured.

- [ ] **Step 6: Verify**

Run:

```bash
npm run test
npm run test:server
```

Expected: all tests pass after Tasks 2 and 3 are complete.

### Task 5: Online Multiplayer Redesign Spec

**Files:**
- Create: `docs/superpowers/specs/YYYY-MM-DD-vjaipur-online-redesign-design.md`

**Interfaces:**
- Consumes: current online reliability failures and product requirement that
  online play should not force false forfeits.
- Produces: reviewed design for later implementation.

- [ ] **Step 1: Write the online redesign spec**

Spec must cover:

- room session tokens.
- heartbeat/ack model.
- reconnect grace policy.
- server-owned room state.
- action sequence numbers.
- legal action validation strategy.
- migration path from current rooms.

- [ ] **Step 2: Explicitly reject tiny timeout-only fixes**

The spec should state that timeout constants alone are not enough because real
matches have forced forfeits while both players believed they were active.

- [ ] **Step 3: User review**

Ask Vijay to review the spec before implementation.

### Task 6: Deployment Hardening

**Files:**
- Modify: `render.yaml`
- Modify: `server/db.ts`
- Modify: `server/index.ts`
- Modify: `package.json`
- Add optional: `tsconfig.server.json`

**Interfaces:**
- Server should fail fast or report readiness clearly when required env is
  missing.

- [ ] **Step 1: Document required Render env vars in `render.yaml`**

Add sync-false server env entries for:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

- [ ] **Step 2: Add production env validation**

At server startup, validate required server env vars without printing values.

- [ ] **Step 3: Add DB readiness route**

Keep `/health` lightweight. Add a separate readiness endpoint that checks
Supabase connectivity and returns sanitized status.

- [ ] **Step 4: Decide server runtime strategy**

Choose one:

- precompile server TypeScript for production.
- keep `tsx` as explicit runtime dependency.

- [ ] **Step 5: Verify**

Run:

```bash
npm run build
npm run test:server
```

Expected: build and server tests pass.

### Task 7: Test Warning And Runtime Noise Cleanup

**Files:**
- Modify: `src/components/Card.tsx`
- Modify: route-related tests if future flags are adopted.

**Interfaces:**
- `CardView` should forward refs if used inside Framer Motion `popLayout`.

- [ ] **Step 1: Forward refs through `CardView`**

Use `React.forwardRef` or remove `popLayout` from wrappers.

- [ ] **Step 2: Re-run affected UI tests**

Run:

```bash
npm run test -- tests/ui/MarketRow.test.tsx tests/ui/GameScreen.test.tsx
```

Expected: tests pass without React ref warnings.

### Task 8: Asset And Audio Cleanup

**Files:**
- Modify: `public/sounds/*` or code that exposes sound controls.
- Modify: `docs/assets.md`

**Interfaces:**
- Sound UI should not imply working audio if files are placeholders.

- [ ] **Step 1: Decide audio direction**

Choose one:

- add licensed audio files.
- hide/remove sound affordances until audio exists.

- [ ] **Step 2: Document asset provenance**

Update `docs/assets.md` with source and license for every shipped asset.

- [ ] **Step 3: Verify**

Run:

```bash
npm run build
```

Expected: build passes and no zero-byte sounds ship unnoticed.

### Task 9: Hard II Final Polish

**Files:**
- Modify: `src/ai/hardAi2.ts`
- Modify or add: Hard II tests.
- Update: `.superpowers/todo-ai.md` or move its live task into `docs/status.md`.

**Interfaces:**
- Consumes: stabilized test and deployment baseline.
- Produces: balanced Hard II strategic-aggression behavior.

- [ ] **Step 1: Wait for stabilization gates**

Do not start until:

```bash
npm run build
npm run test
npm run test:server
```

all pass.

- [ ] **Step 2: Review weights**

Evaluate deck heat, hate-drafting, camel starvation, and round-end sniping
weights in `hardAi2.ts`.

- [ ] **Step 3: Add behavioral tests**

Add tests that prove Hard II chooses tactically aggressive moves in constructed
states without making brittle exact-move assertions where multiple legal moves
are equivalent.

- [ ] **Step 4: Verify**

Run:

```bash
npm run test -- tests/ui/hardAi.test.ts
npm run build
```

Expected: targeted tests and build pass.

## Execution Options

After this documentation pass is reviewed:

1. **Subagent-driven execution**: one fresh worker per task, with review between
   tasks.
2. **Inline execution**: complete tasks in this session with checkpoints.

Recommended order: Tasks 2 and 3 first to restore test trust, then Task 4 for
minimal account safety, then Task 5 for the online redesign spec.

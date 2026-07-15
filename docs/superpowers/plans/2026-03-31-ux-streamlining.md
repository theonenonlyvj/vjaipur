# UX Streamlining & User-Password Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform onboarding into a frictionless "play-first" model. Replace clunky auto-generated secret keys with a user-chosen Password system. Move account management to a non-intrusive overlay.

**Architecture:** 
- New players get a default `Guest_XXXX` name.
- Users can "Secure" their account by picking a unique Username and Password.
- Match history is synced via Username/Password instead of FriendCode/SecretKey for secured accounts.
- Persistent bottom "Stats Strip" on the home screen.

**Tech Stack:** React, Zustand, Express, Supabase (PostgreSQL).

---

### Task 1: Update Database Schema & Server Logic

**Files:**
- Modify: `server/db.ts`
- Modify: `server/index.ts`
- Modify: `src/shared/protocol.ts`

- [ ] **Step 1: Update protocol for Username/Password restoration**
Update `RestoreAccountPayload` to use `username` and `password` instead of `friendCode` and `secretKey`.

- [ ] **Step 2: Update `db.ts` for password support**
Add `getPlayerByUsername(username)` and `updatePlayerToSecured(friendCode, username, password)`. Note: For this MVP, `secret_key` field in DB will repurposed to store the password.

- [ ] **Step 3: Update `RESTORE_ACCOUNT` and `SYNC_MATCH` in `index.ts`**
Ensure `RESTORE_ACCOUNT` validates username/password. Ensure `SYNC_MATCH` works for both guest (friendCode match) and secured (username match) accounts.

- [ ] **Step 4: Commit**
```bash
git add src/shared/protocol.ts server/db.ts server/index.ts
git commit -m "feat: implement server-side support for username/password identity"
```

---

### Task 2: Implement "Guest" Defaults in Stats Store

**Files:**
- Modify: `src/store/statsStore.ts`

- [ ] **Step 1: Update `ensureAccount` logic**
If no `displayName` is set, generate `Guest_XXXX` using the last 4 digits of the `friendCode`.

- [ ] **Step 2: Add `secureAccount(username, password)` action**
This will call the server to update the account status and then update local state.

- [ ] **Step 3: Update `restoreAccount` to support username/password**
Update the flow to call the new server event and handle the response.

- [ ] **Step 4: Commit**
```bash
git add src/store/statsStore.ts
git commit -m "feat: implement guest defaults and account securing in statsStore"
```

---

### Task 3: UI - Profile Overlay Component

**Files:**
- Create: `src/components/ProfileOverlay.tsx`
- Modify: `src/components/ProfileHeader.tsx` (to be repurposed or deleted)

- [ ] **Step 1: Build the Profile Overlay**
A modal/overlay that shows current status (Guest vs Secured). Provides inputs for "Secure Account" (Username + Password) or "Restore Account".

- [ ] **Step 2: Replace ProfileHeader with ProfileIcon**
Create a simple top-right icon in `HomeScreen.tsx` that triggers the `ProfileOverlay`.

- [ ] **Step 3: Commit**
```bash
git add src/components/ProfileOverlay.tsx src/screens/HomeScreen.tsx
git commit -m "ui: implement profile management overlay and top-right entry point"
```

---

### Task 4: UI - Home Screen "Stats Strip"

**Files:**
- Create: `src/components/StatsStrip.tsx`
- Modify: `src/screens/HomeScreen.tsx`

- [ ] **Step 1: Create StatsStrip component**
A minimal horizontal bar for the bottom of the screen. Displays `Record: W-L` and `Total Delta: +/- Δ`. Clicking it opens the existing `StatsDashboard`.

- [ ] **Step 2: Integrate StatsStrip into HomeScreen**
Remove the old large `ProfileHeader` from the main layout. Position `StatsStrip` at the bottom.

- [ ] **Step 3: Commit**
```bash
git add src/components/StatsStrip.tsx src/screens/HomeScreen.tsx
git commit -m "ui: add persistent bottom stats strip to home screen"
```

---

### Task 5: Frictionless Onboarding Polish

**Files:**
- Modify: `src/screens/HomeScreen.tsx`
- Modify: `src/store/gameStore.ts`

- [ ] **Step 1: Remove "The Wall"**
Ensure all "Play" buttons are active immediately. If `playerName` is empty, it uses the `statsStore.displayName` (Guest_XXXX).

- [ ] **Step 2: Remove redundant name check in HomeScreen**
Remove the `handleClaimName` logic from the main Home screen flow.

- [ ] **Step 3: Final UAT & Test Run**
Verify: 1. Launch app -> Play immediately. 2. Secure account with password. 3. Clear cache -> Restore via username/password.

- [ ] **Step 4: Commit**
```bash
git add src/screens/HomeScreen.tsx src/store/gameStore.ts
git commit -m "feat: finalize frictionless onboarding and identity sync"
```

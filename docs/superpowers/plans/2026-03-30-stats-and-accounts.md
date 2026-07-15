# Stats & Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement persistent player identity (Friend Codes) and match statistics tracking (Win/Loss/Δ) against AI and human rivals using a hybrid LocalStorage + Supabase architecture.

**Architecture:** A new `statsStore` handles local persistence and UI state. The Express server acts as a bridge to Supabase, recording match results and allowing players to restore history via their unique account string (Code + Secret).

**Tech Stack:** React, Zustand, Express, Socket.io, Supabase, PostgreSQL.

---

### Task 1: Setup Backend Database Layer

**Files:**
- Create: `server/db.ts`
- Modify: `package.json`

- [ ] **Step 1: Install Supabase client**
Run: `npm install @supabase/supabase-js`

- [ ] **Step 2: Create database wrapper**
```typescript
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
export const supabase = createClient(supabaseUrl, supabaseKey)

export interface Player {
  id: string
  friend_code: string
  display_name: string | null
  secret_key: string
}

export interface Match {
  player_id: string
  opponent_type: string
  opponent_id: string | null
  player_score: number
  opponent_score: number
  won: boolean
}

export async function createPlayer(friendCode: string, secretKey: string, displayName?: string) {
  const { data, error } = await supabase
    .from('players')
    .insert([{ friend_code: friendCode, secret_key: secretKey, display_name: displayName }])
    .select()
    .single()
  if (error) throw error
  return data
}

export async function recordMatch(match: Match) {
  const { error } = await supabase.from('matches').insert([match])
  if (error) throw error
}

export async function getPlayerByCode(friendCode: string) {
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .eq('friend_code', friendCode)
    .single()
  if (error && error.code !== 'PGRST116') throw error
  return data
}
```

- [ ] **Step 3: Commit**
```bash
git add package.json server/db.ts
git commit -m "feat: setup backend database layer with Supabase"
```

---

### Task 2: Define Shared Protocol & Backend Events

**Files:**
- Modify: `src/shared/protocol.ts`
- Modify: `server/index.ts`

- [ ] **Step 1: Update protocol types**
Add `SYNC_MATCH` and `GET_PLAYER_STATS` events to `EVENTS` and define their payloads in `src/shared/protocol.ts`.

- [ ] **Step 2: Implement server event handlers**
Update `server/index.ts` to handle `SYNC_MATCH` (writing to DB) and `RESTORE_ACCOUNT` (fetching history from DB).

- [ ] **Step 3: Commit**
```bash
git add src/shared/protocol.ts server/index.ts
git commit -m "feat: add stats sync events to socket protocol and server"
```

---

### Task 3: Implement Frontend Stats Store

**Files:**
- Create: `src/store/statsStore.ts`

- [ ] **Step 1: Create Zustand store for stats**
Implement `useStatsStore` with persistence to `localStorage`. It should store `friendCode`, `secretKey`, `matches` (history), and `aggregates` (calculated win rates and deltas).

- [ ] **Step 2: Implement Friend Code generation**
Add a utility to generate a code like `VJ-XXXX` if one doesn't exist.

- [ ] **Step 3: Commit**
```bash
git add src/store/statsStore.ts
git commit -m "feat: implement frontend stats store with local persistence"
```

---

### Task 4: UI - Profile Header & Friend Code Display

**Files:**
- Modify: `src/screens/HomeScreen.tsx`
- Modify: `src/screens/LobbyScreen.tsx`

- [ ] **Step 1: Show Friend Code on Home Screen**
Add a small profile section showing the player's name and Friend Code.

- [ ] **Step 2: Add "Link Account" button**
Allow users to enter an existing Code + Secret to restore their stats on a new device.

- [ ] **Step 3: Commit**
```bash
git add src/screens/HomeScreen.tsx src/screens/LobbyScreen.tsx
git commit -m "ui: display friend code and add account linking"
```

---

### Task 5: UI - Stats Dashboard Component

**Files:**
- Create: `src/components/StatsDashboard.tsx`
- Modify: `src/screens/HomeScreen.tsx`

- [ ] **Step 1: Build the Dashboard layout**
Create a table for AI difficulty records and a list for Online rivals as seen in the mockups.

- [ ] **Step 2: Integrate into Home Screen**
Add a "View Stats" button that opens the dashboard overlay.

- [ ] **Step 3: Commit**
```bash
git add src/components/StatsDashboard.tsx src/screens/HomeScreen.tsx
git commit -m "ui: implement stats dashboard overlay"
```

---

### Task 6: Hooking it All Up (Game End Flow)

**Files:**
- Modify: `src/store/gameStore.ts`
- Modify: `src/screens/GameOverScreen.tsx`

- [ ] **Step 1: Update recordResult in gameStore**
When a game reaches `game-over`, call `statsStore.addMatch()` and trigger the backend sync via `socketService`.

- [ ] **Step 2: Show Δ in GameOverScreen**
Display how this match affected the all-time delta against this specific opponent.

- [ ] **Step 3: Commit**
```bash
git add src/store/gameStore.ts src/screens/GameOverScreen.tsx
git commit -m "feat: record results and display delta on game over"
```

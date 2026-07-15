# Stats & Accounts System Design

**Date:** 2026-03-30
**Status:** Draft
**Topic:** Persistent statistic tracking and player identity for vJaipur.

## 1. Objective
Enable players to track their performance over time, specifically focusing on win/loss records and score differentials (Δ) against both AI models and human rivals. Ensure data is persistent across updates and browser sessions by using a hybrid LocalStorage + Cloud (Supabase) approach.

## 2. Requirements
- **Identity:** Persistent identity using "Friend Codes" (e.g., `VJ-8822`).
- **AI Tracking:** Detailed records for all 5 AI models (Easy, Medium, Hard, Hard2, Hard3).
- **Human Rivalries:** Track records against specific opponents identified by their Friend Codes.
- **Metrics:** Win/Loss count, Win %, and "All-Time Δ" (Sum of player score - opponent score).
- **Persistence:** Stats must survive browser cache clears (via cloud backup) and project redeploys on Render.
- **Zero Friction:** No email/password registration. Automatic ID generation with manual "Sync" or "Link" options.

## 3. Architecture (Hybrid Sync)

### 3.1 Data Flow
1. **Frontend (Zustand):** Updates local state and `localStorage` immediately upon match completion.
2. **Backend (Express):** Receives match results from the client, validates the session, and writes to Supabase.
3. **Cloud (Supabase):** Serves as the permanent "Source of Truth" for historical data.

### 3.2 Database Schema (Supabase/Postgres)
```sql
CREATE TABLE players (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  friend_code TEXT UNIQUE NOT NULL, -- e.g. "VJ-1234"
  display_name TEXT,
  secret_key TEXT NOT NULL,         -- Generated locally, used to "claim" the account on new devices
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE matches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  player_id UUID REFERENCES players(id),
  opponent_type TEXT NOT NULL,      -- 'ai_easy', 'ai_medium', 'ai_hard', 'ai_hard2', 'ai_hard3', 'human'
  opponent_id TEXT,                 -- Friend code if human, NULL if AI
  player_score INTEGER NOT NULL,
  opponent_score INTEGER NOT NULL,
  won BOOLEAN NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

## 4. Components

### 4.1 Frontend (`src/store/statsStore.ts`)
A new store to manage the local statistics and sync state.
- `stats`: The calculated aggregates (Win/Loss, Δ).
- `history`: Recent match list.
- `playerId` / `friendCode`: Local identity.
- `sync()`: Function to push/pull from the server.

### 4.2 Backend (`server/db.ts`)
A thin wrapper around the Supabase client to handle queries.
- `recordMatch(playerId, matchData)`
- `getPlayerStats(playerId)`
- `linkFriend(playerId, friendCode)`

### 4.3 UI Additions
- **Profile Header:** Displays current Friend Code in the Home/Lobby screens.
- **Stats Dashboard:** A new screen (or overlay) showing the "AI Mastery" table and "Online Rivals" list.
- **Post-Game:** Update the Round/Game end screens to show the impact on the player's All-Time Δ.

## 5. Security & Privacy
- **Anonymous:** No personal data collected.
- **Secret Key:** A random string generated once and stored in LocalStorage. To "log in" on a new device, a user can copy-paste their "Account String" (Code + Secret). This prevents strangers from messing with your stats if they guess your Friend Code.

## 6. Future Add-ons (Out of Scope for MVP)
- Global Leaderboards.
- Match replay storage.
- Earned medals/badges.

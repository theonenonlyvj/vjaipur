# UX Streamlining & Identity Design (Revised)

**Date:** 2026-03-31
**Status:** Approved
**Topic:** Frictionless onboarding, non-intrusive stats, and user-password account restoration.

## 1. Objective
Transform the initial user experience from a mandatory registration "wall" to a "play-first" model. Enable persistent identity through automatic guest naming and secure cross-browser account restoration using a simple Username + Password combination.

## 2. Onboarding & Identity
- **Frictionless Entry:** All game modes (AI, Local, Online) are enabled immediately on first launch.
- **Automatic Naming:** New players are automatically assigned a name like `Guest_XXXX` (based on their unique Friend Code suffix).
- **Persistent Identity:** The `statsStore` maintains a local `friendCode` and `secretKey` (original system) for silent sync, but allows "Upgrading" to a full account.
- **Account Upgrading:** A user can "Secure" their account by choosing a unique **Username** and a **Password**. This replaces the auto-generated `displayName` and `secretKey` in the database.

## 3. UI/UX Changes
- **Home Screen:**
  - Remove mandatory name entry block. Immediate access to "Play VS AI", "Local", and "Online".
  - **Profile Icon** (Top-Right): Shows current name. Clicking opens the Profile Management overlay.
  - **Stats Strip** (Bottom): A minimal bar showing total Record (W-L) and Delta (+/- Δ). Clicking this expands the full `StatsDashboard`.
- **Profile Management Overlay:**
  - Option to set a unique **Username** and **Password** (if using a Guest account).
  - Option to **Restore Account** by entering an existing Username + Password.
  - Displays the `Friend Code` for reference.

## 4. Cross-Browser Restoration Logic
1. **Scenario:** User clears cache or moves to a new browser.
2. **Restoration Flow:**
   - User clicks the Profile Icon -> "Restore Account".
   - User enters their **Username** and **Password**.
   - **Frontend:** Calls `socketService.restoreAccount({ username, password })`.
   - **Server:** Validates password against the username in Supabase.
   - **Server:** Returns the associated match history, `friendCode`, and `secretKey`.
   - **Frontend:** Replaces local `statsStore` and `gameStore` data with the cloud record.
3. **Verification:** The user is now logged in as themselves on the new browser, and all future matches will sync to their existing history.

## 5. Technical Requirements
- **Server:** Update `RESTORE_ACCOUNT` and `SYNC_MATCH` handlers to support username/password lookup.
- **Store:** Update `statsStore.ts` to manage the transition from Guest -> Secured account.
- **UI:** Implement the Profile Icon, Profile Overlay, and Stats Strip components.
- **Migration:** Ensure existing users (like `theonenonlyvj`) can set their password to "claim" their existing `VJ-7064` stats.

## 6. Security
Since the data is low-sensitivity (game stats), we will store passwords as plain-text or simple hashes for simplicity in this prototype. The main goal is uniqueness and ease of restoration.

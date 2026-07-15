# UI Refresh & Premium Visuals System Design (Revised)

**Date:** 2026-03-31
**Status:** Approved
**Topic:** Premium asset overhaul (Cards, Tokens, Board) and UX refinements (Scoring, Board Review, Camel Selection, Camel Stack).

## 1. Objective
Complete visual and UX transformation of vJaipur to a "Premium Edition." Enhance end-game transparency, tactile feel of assets, and overall atmospheric polish while strictly maintaining the proven game board layout.

## 2. Visual Overhaul (Premium Assets)

### 2.1 Premium Cards
- **Aesthetic:** "Linen texture" ($50-feel) with rich color-first backgrounds and high-fidelity icons.
- **Design:** Linear gradients (135deg) matching the good's color, 0.25 opacity linen texture overlay, 1.5px semi-transparent borders.
- **Typography:** Bold, uppercase labels (e.g., "DIAMOND") centered below icons. 14px font size for labels.
- **Icons:** Use high-fidelity SVGs (OpenMoji) for all types (⚔️ Silver, 👘 Cloth, 👢 Leather, 🥦 Spice, etc).
- **Selection:** 3px white border, 10px lift (Y-axis), and 30px shadow glow.

### 2.2 Tactile Tokens
- **Goods Tokens:** Glossy, physical-looking coins with radial gradients, "Shine" highlights, and centered 22px value text.
- **Elite Bonus Tokens:** Obsidian & Gold circular coins with custom geometric star patterns (Triangle, 2x2, 2-over-3).
- **Transparency:** Explicit "×N" stack counts (12px) for all goods and bonus piles. Labels (e.g. "DIAMOND") are small gray (8px) text above the coins.

### 2.3 Atmospheric Board
- **Background:** Radial gradient (Mahogany to Charcoal) simulating a high-end gaming table.
- **Glassmorphism:** Subtle blur and transparency on UI containers (Token Rail, Opponent Strip, Status Bar).
- **Font:** Global integration of 'Iosevka Charon' monospace font.

## 3. UX Improvements

### 3.1 Final Play Context
- **Feature:** Persist `lastMoveDescription` into end-game screens with a "The Final Play" floating badge.
- **Persistence:** Clear description only on *new game* start.

### 3.2 Snazzy Scoring Summary
- **Layout:** Card-based summary in `RoundEndScreen` and `GameOverScreen`.
- **Breakdown:** Explicitly show counts and point totals for Goods, Bonuses, and Camels (including specific count of camels held).
- **Winner Ribbon:** Prominent "WINNER" badge on the victorious player's card.

### 3.3 Frozen Board Review
- **Feature:** "View Board" toggle on end-game screens.
- **Behavior:** Hide summary and show a frozen, read-only version of the `GameScreen` at the moment of completion.

### 3.4 Camel Stack in Hand
- **Feature:** Represent the player's herd as a physical "Stack" card at the end of the `HandRow`.
- **Visual:** Offset background cards to simulate a stack, with a prominent "xN" count badge.
- **Interaction:** Clicking the stack selects/deselects camels for exchange, one by one.
- **Constraint:** Visually separated from goods cards to ensure the 7-card hand limit remains clear.

### 3.5 Match Length Selector
- **Feature:** Option to select 1, 3, or 5 game matches on the Home Screen.
- **Logic:** Winning seals needed = `Math.floor(matchLength / 2) + 1`.

## 4. Technical Requirements
- Update `CardView`, `TokenRail`, `HandRow`, and `GameScreen` components.
- Implement `ScoreCard` and `BoardSnapshot` sub-components.
- Update `GameStore` to manage `matchLength` and `lastMoveDescription` persistence.

# Tutorial Redesign — Design Spec

**Date:** 2026-04-02
**Status:** Approved

## Summary

Reimagine the Jaipur tutorial to cover scoring, strategy, and game concepts — not just basic actions. Two deliverables:

1. **In-game guided walkthrough** — split into two chapters (Basics + Scoring & Strategy), with an opt-out point between chapters.
2. **Rules reference screen** — standalone tabbed screen accessible from "How to Play" on HomeScreen, with a "Start Tutorial" button inside it.

## Part 1: In-Game Tutorial

### Structure

Two chapters, 14 total steps. Chapter 2 is optional — after Chapter 1 the player is prompted to continue or skip.

### Chapter Transition

Between chapters, the overlay shows:

> **"Chapter 1 complete!"**
> Continue to Scoring & Strategy?
> [Continue] [Skip — Start Playing]

"Skip" calls `onDone()` and ends the tutorial. "Continue" advances to step 7.

### Chapter 1: Basics (6 steps)

| Step | Title | Body | Trigger |
|---|---|---|---|
| 1 | Welcome to Jaipur! | You're a trader competing for the Maharaja's favor. Earn more rupees than your opponent to win. | button |
| 2 | The Market | The 5 cards in the center are the market. On your turn: take 1 good, take all camels, or exchange cards. | button |
| 3 | Your Hand | Goods go to your hand (max 7). Camels go to your herd — they help with exchanges but can't be sold. | button |
| 4 | Take a Card | It's your turn! Tap any non-camel card in the market to take it. | took-card |
| 5 | Sell Goods | Now try selling! Tap cards in your hand to select them, then hit Sell. | sold |
| 6 | Exchanges | You can swap 2+ market cards for cards in your hand (plus camels). Select 2+ market cards to try it. | button |

### Chapter 2: Scoring & Strategy (8 steps)

| Step | Title | Body | Trigger |
|---|---|---|---|
| 7 | Token Values | First to sell gets the best price — values drop as tokens are claimed. *(Render token matrix table below body text.)* Selling diamonds first earns 7 per token. Selling last earns 5. Race to sell! | button |
| 8 | Precious Goods | Diamonds, gold, and silver are "precious" — worth more, but you must sell at least 2 at a time. Common goods (cloth, spice, leather) can be sold one at a time. | button |
| 9 | Bonus Tokens | Sell 3+ cards at once to earn a bonus token. These are shuffled face-down — you won't know the exact value until you earn one. Sell 3 → worth 1-3 pts, sell 4 → worth 4-6 pts, sell 5+ → worth 8-10 pts. Big bulk sales are game-changers! | button |
| 10 | Camels Are Powerful | Don't overlook camels! They don't count against your 7-card hand limit, so they're free resources. Use them in exchanges to grab goods without giving any up. A large herd also earns 5 bonus rupees at round end. Taking all camels from the market also refreshes it with new cards — sometimes that's the real play. | button |
| 11 | Controlling the Endgame | The round ends when 3 token piles are empty or the deck runs out. If you're ahead, force the round to end quickly by selling to deplete piles. If you're behind, slow down — exchange and accumulate to set up big scoring turns. Keep an eye on the deck count at the top of the screen and the token piles! | button |
| 12 | Seals of Excellence | The player with more rupees wins a Seal. In best-of-3, first to 2 seals wins. Ties are broken by most bonus tokens, then most goods tokens. | button |
| 13 | Read Your Opponent | You can see every card your opponent takes from the market. Track what's in their hand, watch their herd grow, and anticipate their next sell. The best traders are mind readers! | button |
| 14 | You're Ready! | Sell premium goods early, sell in bulk for bonuses, and watch the token piles. Good luck! | button |

### Token Matrix (rendered in Step 7)

Compact table inside the overlay:

| Good | Tokens (left → right) |
|---|---|
| Diamond | 7, 7, 5, 5, 5 |
| Gold | 6, 6, 5, 5, 5 |
| Silver | 5, 5, 5, 5, 5 |
| Cloth | 5, 3, 3, 2, 2, 1, 1 |
| Spice | 5, 3, 3, 2, 2, 1, 1 |
| Leather | 4, 3, 2, 1, 1, 1, 1, 1, 1 |

Styled with each good name using its card gradient/color for visual association.

### Step Data Model

```typescript
interface Step {
  title: string
  body: string
  trigger: 'button' | 'took-card' | 'sold'
  chapter: 1 | 2
  showTokenMatrix?: boolean  // true only for step 7
}
```

### Overlay Behavior

- **Button-triggered steps:** Modal overlay at bottom (existing behavior).
- **Action-triggered steps (took-card, sold):** Compact top banner hint (existing behavior).
- **Progress indicator:** Shows "Chapter N · step X / Y" instead of flat "Tutorial · X / 8".
- **Chapter transition:** After step 6 completes, overlay shows the chapter transition prompt instead of advancing to step 7.
- **Final step (14):** Shows "Play!" button instead of "Next".

## Part 2: Rules Reference Screen

### Route & Navigation

- New route: `/rules`
- New file: `src/screens/RulesScreen.tsx`
- **HomeScreen "How to Play" button** navigates to `/rules` (instead of directly launching the tutorial).
- **"Start Tutorial" button** at the bottom of the rules screen launches the in-game tutorial (same behavior: set difficulty easy, startTutorial, startGame vs-ai, navigate to /game).

### Layout

- **Tab bar** at the top: 3 tabs — Gameplay, Scoring, Strategy
- **Scrollable content** below the tabs
- **"Start Tutorial" button** fixed at bottom
- **Back button** (or "← Back") in top-left to return to HomeScreen

### Tab 1: Gameplay

**Your Turn**
On your turn you can do one of three things: take 1 good card from the market, take all camel cards from the market, or exchange 2+ cards between the market and your hand.

**The Market**
5 cards sit in the center. When you take cards, the market is replenished from the deck.

**Hand Limit**
You can hold a maximum of 7 goods cards. Camels go to your herd and don't count toward this limit.

**Exchanges**
Swap 2 or more market cards for cards in your hand plus camels from your herd. The number given must equal the number taken.

**Round End**
The round ends when 3 token piles are empty or the deck runs out. The deck count is visible at the top of the screen.

### Tab 2: Scoring

**Token Values**
Each good has a stack of tokens with decreasing values. First to sell gets the best price.

*(Same token matrix table as in the tutorial)*

**Precious Goods**
Diamonds, gold, and silver are worth more but must be sold 2 or more at a time. Common goods (cloth, spice, leather) can be sold 1 at a time.

**Bonus Tokens**
Sell 3 or more matching cards at once to earn a bonus token. Bonus tokens are shuffled face-down — you won't know the exact value until you earn one. Sell 3 → worth 1-3 pts. Sell 4 → worth 4-6 pts. Sell 5+ → worth 8-10 pts.

**Camel Bonus**
The player with the most camels at round end earns 5 bonus rupees.

**Seals of Excellence**
The player with more total rupees wins a Seal. In best-of-3, first to 2 seals wins the match. Ties are broken by: most bonus tokens, then most goods tokens.

### Tab 3: Strategy

**Sell Early**
Token values decrease as they're claimed. First seller gets the best price — especially for precious goods.

**Sell in Bulk**
Bonus tokens for 3+ card sales are massive point swings. A single 5-card sell can earn 8-10 extra points on top of the token values.

**Camels Are Powerful**
Don't overlook camels. They don't count against your hand limit, they fuel exchanges without giving up goods, taking them refreshes the market with new cards, and the largest herd earns 5 bonus rupees at round end.

**Control the Pace**
If you're ahead, deplete token piles to end the round fast. If you're behind, slow down — exchange and accumulate to set up big scoring turns. Watch the deck count and token piles closely.

**Read Your Opponent**
Every card your opponent takes from the market is visible to you. Track what's in their hand, watch their herd grow, and anticipate their next sell. The best traders are mind readers!

### Styling

- Dark theme consistent with existing screens.
- Active tab: gold accent (`#f0c030`) with underline.
- Inactive tabs: muted (`#666`).
- Section headers: gold text, uppercase, small letter-spacing.
- Body text: `#ccc`, 14px.
- Token matrix: good names colored with their card accent colors (diamond red, gold yellow, silver gray, etc.).
- "Start Tutorial" button: same style as HomeScreen primary buttons.

## Files Changed

| File | Change |
|---|---|
| `src/components/TutorialOverlay.tsx` | Rewrite STEPS array with 14 steps + chapter field. Add chapter transition screen. Add token matrix rendering. Update progress indicator. |
| `src/screens/RulesScreen.tsx` | **New.** Tabbed rules reference screen with 3 tabs. |
| `src/screens/HomeScreen.tsx` | "How to Play" button navigates to `/rules` instead of launching tutorial directly. Remove `handleTutorial` function. |
| `src/App.tsx` | Add `/rules` route pointing to `RulesScreen` (between `/` and `/lobby`). |

## Out of Scope

- No changes to game engine, AI, or scoring logic.
- No changes to GameScreen, ActionBar, or other gameplay components.
- No animated illustrations or videos — text + the token matrix table only.

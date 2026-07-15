# Hard IV AI — Design Spec

**Date:** 2026-04-02
**Status:** Approved

## Summary

Hard IV is the strongest AI tier. It builds on Hard III's alpha-beta minimax with two major additions: an endgame solver that searches to completion (no depth limit) when the round is nearly over, and an improved evaluation function with 4 new/upgraded factors. Perfect information (reads opponent hand and deck order, same as Hard III).

## Architecture

- **Separate file:** `src/ai/hardAi4.ts` — standalone, copies Hard III's alpha-beta skeleton and diverges with new eval + endgame solver. Not shared with Hard III to allow independent tuning.
- **Web Worker:** `src/ai/aiWorker4.ts` — same pattern as `aiWorker3.ts`.
- **Worker bridge timeout:** 15s via `getWorkerBridge4()`.

## Endgame Solver

### Trigger Condition

```
(1 pile depleted AND any second pile ≤ 2 tokens) OR deck ≤ 10
```

When this condition is true for the current game state, `pickHard4Action` switches from depth-limited iterative deepening to **unlimited-depth alpha-beta**. The search continues all the way to `phase === 'round-end'` with no depth cutoff.

### Time Budget

- **Normal play (no endgame trigger):** 7s, iterative deepening depth 2→6 (same as Hard III).
- **Endgame solving:** Up to 12s (within the 15s worker timeout). Iterative deepening with no depth cap — depth 2, 3, 4, ... until time runs out or the full game tree is solved.

### Fallback

If the deadline is hit before solving completes, the best move from the deepest fully completed depth is used. The solver is opportunistic — it improves Hard III's play even when it can't fully solve.

### Round-End Scoring

When the solver reaches `phase === 'round-end'`, it calls `scoreRound()` for the exact result:
- `sealAwardedTo === myIndex` → +10,000
- `sealAwardedTo === null` → 0
- `sealAwardedTo === opponent` → -10,000

No heuristic estimation needed at terminal nodes.

## Improved Evaluation Function

Hard IV starts with Hard III's 6 factors and adds/improves 4:

### Factor 7: Token Depletion Cascade (Round-Ending Sell Detection)

For each good the AI could sell, check how many piles would have 0 tokens remaining afterward. If the sell would deplete the 3rd pile (ending the round):

- **AI is ahead on realized points** → bonus (+15). Ending the round locks the win.
- **AI is behind** → penalty (-15). Don't trigger the end.

"Ahead/behind" is determined by comparing realized token + bonus token totals for both players, plus the camel bonus (awarded to the player with more camels).

### Factor 8: Market-Context "Almost Sellable" Combos

Hard III gives a flat bonus for holding 1 precious card. Hard IV considers whether a matching card is reachable:

```
Have 1 diamond + diamond in market → strong value (can complete pair next turn)
Have 1 diamond + diamond in top 5 of deck → moderate value (will appear soon)
Have 1 diamond + no diamond in market or near deck → weak value
```

Specifically:
- Matching card in market: `topValue * 2.2` (up from Hard III's `topValue * 1.8`)
- Matching card in deck positions 0-4: `topValue * 1.4`
- No match reachable: `topValue * 0.5` (down from Hard III's `topValue * 0.8`)

### Factor 9: Nonlinear Camel Value

Hard III uses flat `0.6 * (myCamels - oppCamels)`. Hard IV computes the maximum camels the opponent can ever reach:

```
oppMaxCamels = opp.herd + camelsInMarket + camelsInDeck
```

Then applies a step function:

| Condition | Score |
|---|---|
| `myCamels > oppMaxCamels` (unassailable lead) | +5, stop taking camels |
| `myCamels > oppCamels` but opponent can catch up | +3 |
| Tied | 0 |
| Behind, opponent lead catchable | -3 |
| Behind, opponent lead unassailable | -5 |

Key insight: once the AI's camel count exceeds what the opponent could ever reach, it stops wasting turns on camels and focuses on goods.

### Factor 10: Sell Timing Pressure

When the opponent has enough cards to sell a good and the token pile is small, the top tokens are at risk:

```
If opponent can sell good X (oppCount >= minSell) AND pile[X].length <= 3:
  Add urgency bonus for selling X (+topValue * 1.5)
```

This creates pressure to sell before the opponent claims the best tokens — especially for precious goods where both players are racing.

## Hard III Factors Retained (1-6)

All 6 original factors carry forward unchanged:

1. Realized rupee differential (×2.0)
2. Actual bonus token values (×1.5)
3. Sellable goods with urgency (×2.5 when ≤2 tokens)
4. Market tempo — precious completing a pair
5. Camel herd advantage → **replaced by Factor 9**
6. Hand pressure (-4 at 6 cards, +3 when opponent pressured)

Note: Factor 5 (flat camel weight) is replaced by Factor 9 (nonlinear camel value). All other factors are inherited as-is.

## Files Changed

| File | Change |
|---|---|
| `src/ai/hardAi4.ts` | **New.** `evalPosition4()`, endgame trigger, unlimited-depth solver, `pickHard4Action()`. |
| `src/ai/aiWorker4.ts` | **New.** Web Worker wrapper calling `pickHard4Action`. |
| `tests/engine/hardAi4.test.ts` | **New.** Tests for endgame solving, round-ending sell detection, camel lockout, sell timing pressure. |
| `src/ai/workerBridge.ts` | Add `getWorkerBridge4()` singleton with 15s timeout. |
| `src/store/gameStore.ts` | Add `'hard4'` to `Difficulty` type, wire worker bridge for hard4. |
| `src/screens/HomeScreen.tsx` | Add Hard IV button. |

## Out of Scope

- No transposition table (Hard V).
- No multi-round / seals awareness (Hard V).
- No opponent modeling (Hard V).
- No imperfect information / determinization (Hard II rework).
- No UI changes beyond adding the Hard IV button.
- Status line stays "AI is thinking..." — no "thinking deeply" variant.

# Fair Bot AI v2 — Expectimax Redesign

**Date:** 2026-04-04
**Status:** Approved
**Supersedes:** 2026-04-02-fair-bot-design.md

## Summary

Complete redesign of the fair bot search. The bot never calls `applyAction` to simulate draws from the deck. Instead, it uses expectimax — branching on all possible card types at draw nodes, weighted by probability. The bot has zero exposure to hidden information.

## Core Principle

The bot never sees information a human player couldn't see. No reading the deck. No reading unknown opponent cards. No simulating with hidden state. Every decision is based on visible state + probability math over unknowns.

## What Changed from v1

| v1 | v2 |
|---|---|
| Alpha-beta with `applyAction` drawing real `deck[0]` | Expectimax — construct possible states at draw nodes |
| Eval discounts drawn cards by probability | Eval never sees drawn cards — they don't exist |
| Search tree shaped by actual deck order | Search tree shaped only by probability distribution |
| Depth-1 when opponent hand unknown | Full expectimax at all times, opponent actions probability-weighted |

## What Stays the Same from v1

- `OpponentTracker` (knownInHand, unknownInHand, computeUnaccounted, opponentEffective)
- Eval factors 1-3, 5-7, 9 (realized pts, bonus tokens, sellable goods, camels, hand pressure, depletion cascade, sell timing)
- Worker, worker bridge, game store tracking
- HomeScreen button

## Search Architecture

### Node Types

**1. Bot's turn — sell action**
Deterministic. No draw occurs. Apply the sell (can use `applyAction` — sells don't draw from deck). Recurse to next node.

**2. Bot's turn — take / exchange / take camels**
A draw occurs. Do NOT call `applyAction`. Instead:
- Compute the result of the take/exchange manually (remove card from market, add to hand, etc.)
- The empty market slot triggers a **chance node**: branch into each possible card type weighted by `P(type) = unaccountedInDeck[type] / totalInDeck`
- For each type with P > 0, construct a market state with that type filling the slot
- Recurse with the weighted score: `sum(P(type) × score(state_with_type))`
- Skip types with 0 probability

**3. Opponent's turn — sell with known cards**
The opponent's `knownInHand` cards are certain. If they have `knownCount(good) >= minSell`, they CAN sell. This is a concrete branch — apply the sell, recurse.

**4. Opponent's turn — sell with unknown cards**
Use hypergeometric probability to determine if the opponent can sell type X:
```
needed = minSell - knownCount(X)
P(unknowns contain >= needed of type X) = 1 - C(totalUnaccounted - unaccounted[X], unknownInHand) / C(totalUnaccounted, unknownInHand)
```
If P > 0.1 (threshold to avoid noise), include as a branch weighted by P. Apply the sell assuming they sell `knownCount + needed` cards.

**5. Opponent's turn — take from market**
Market is visible — concrete actions. But the draw after taking triggers a chance node (same as #2). Apply the take, then branch on possible replacement types.

**6. Opponent's turn — exchange**
Only consider exchanges using known cards + camels from herd. Exchanges involving unknown cards are too combinatorial to enumerate — skip them. This is a simplification but exchanges with unknown cards are rare (opponent usually exchanges cards they took from market = known).

### Chance Nodes

A chance node replaces the `applyAction` deck draw. It branches on card types, not individual cards:

```typescript
// At a chance node (market slot needs filling):
const unaccountedInDeck = computeUnaccountedInDeck()  // excluding opponent unknown hand
const totalInDeck = sum(unaccountedInDeck)
let expectedScore = 0

for (const type of ALL_CARD_TYPES) {
  if (unaccountedInDeck[type] === 0) continue
  const prob = unaccountedInDeck[type] / totalInDeck
  const stateWithType = constructMarketState(state, slotIndex, type)
  expectedScore += prob * recurse(stateWithType)
}
return expectedScore
```

Maximum branching: 7 types. In practice: 3-5 types have nonzero probability. Late game: 1-2 types.

### Sell-Only Chains

Sequences of sells (by either player) involve no draws and no unknowns. These can be searched to arbitrary depth with standard minimax. This is where the bot reasons deeply about sell timing, depletion cascades, and round-ending decisions.

### Depth Control

- Sell actions: no depth penalty (deterministic, fast)
- Chance nodes (draws): each adds branching × ~4-5. Limit to 2-3 chance nodes max in any path
- Total effective depth: comparable to depth 4-6 but with honest branching
- Time budget: 7s normal, 12s endgame, 15s worker timeout

### Endgame Solver

Same trigger: `(1 pile depleted AND any second pile ≤ 2 tokens) OR deck ≤ 10`

No `unknownInHand === 0` requirement — expectimax handles unknowns naturally. When triggered, search deeper with 12s budget. Late game has fewer unaccounted cards, so chance nodes have fewer branches and search goes deeper naturally.

## Evaluation Function

### Factors (unchanged from v1, simplified)

1. **Realized rupee differential** (×2.0) — exact token values, both visible
2. **Bonus token differential** (×1.5) — own exact, opponent by tier midpoint (3→2, 4→5, 5→9)
3. **Sellable goods with urgency** — own hand exact, opponent via `opponentEffective`
4. **Market tempo** — only score visible market cards (all cards in market at eval time are real since we construct states explicitly)
5. **Nonlinear camel value** — `oppMaxCamels = opp.herd + camelsInMarket + unaccountedCamels` (all unaccounted camels are in deck)
6. **Hand pressure** — hand sizes are visible
7. **Token depletion cascade** — round-ending sell detection
8. **Market-context almost sellable** — visible market cards only
9. **Sell timing pressure** — opponent effective holdings

### Key Change: No `realMarketIds`

v2 doesn't need `realMarketIds` because market states are constructed explicitly at chance nodes. Every card in the market at eval time is either the original visible card or one we placed via probability branching. The eval scores everything at face value.

## Hypergeometric Helper

```typescript
// Probability that drawing `draws` cards from a pool of `total` contains
// at least `needed` of a type that has `available` copies in the pool.
function hypergeoProbAtLeast(available: number, total: number, draws: number, needed: number): number {
  if (needed <= 0) return 1
  if (available < needed || draws < needed) return 0
  // P(at least needed) = 1 - P(fewer than needed)
  // P(fewer than needed) = sum over k=0..needed-1 of C(available,k)*C(total-available, draws-k)/C(total,draws)
  // For our use case, needed is typically 1 or 2, so this is fast.
  let pFewer = 0
  for (let k = 0; k < needed; k++) {
    pFewer += combinations(available, k) * combinations(total - available, draws - k) / combinations(total, draws)
  }
  return 1 - pFewer
}

function combinations(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  if (k === 0 || k === n) return 1
  let result = 1
  for (let i = 0; i < k; i++) {
    result = result * (n - i) / (i + 1)
  }
  return result
}
```

## Constructing States Without applyAction

For take actions, instead of calling `applyAction` (which draws from deck), the bot constructs the resulting state manually:

**TAKE_SINGLE:**
- Remove card from market at `marketIndex`
- Add card to active player's hand
- Market slot is empty → triggers chance node

**TAKE_CAMELS:**
- Remove all camels from market
- Add camel count to active player's herd
- Multiple empty market slots → multiple chance node draws (one per slot)

**TAKE_EXCHANGE:**
- Remove cards at `marketIndices` from market
- Add them to active player's hand
- Remove cards at `handIndices` from active player's hand (or decrement herd for -1 entries)
- Add given cards to market
- Remaining empty slots → chance nodes

**SELL:**
- Can use `applyAction` directly — sells never draw from deck

For sell actions, `applyAction` is safe because sells:
- Remove cards from hand
- Take tokens from the pile
- Award bonus tokens
- Check round end (3 piles depleted)
- Never touch the deck or market

## Files Changed

| File | Change |
|---|---|
| `src/ai/fairBot.ts` | **Rewrite.** Replace alpha-beta with expectimax. Add hypergeometric helper. Add state construction for takes. Keep OpponentTracker, eval factors. |
| `tests/engine/fairBot.test.ts` | **Update.** Add tests for hypergeometric, chance nodes, expectimax decisions. |
| `src/ai/fairBotWorker.ts` | No change. |
| `src/ai/workerBridge.ts` | No change. |
| `src/store/gameStore.ts` | No change. |
| `src/screens/HomeScreen.tsx` | No change. |

## Out of Scope

- Opponent behavioral modeling (future)
- Transposition table (future)
- Multi-round awareness (future)

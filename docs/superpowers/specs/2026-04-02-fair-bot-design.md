# Fair Bot AI — Design Spec

**Date:** 2026-04-02
**Status:** Approved

## Summary

A strong AI that plays with only human-available information — no reading the opponent's hand or deck order. Uses probability-weighted evaluation based on card elimination tracking, with adaptive search depth that increases as information becomes more complete during the game.

## Philosophy

The fair bot never cheats. It knows:
- Its own hand (exact)
- Cards it saw the opponent take from market (tracked)
- Market (visible)
- Token piles (visible values and counts)
- Own bonus token values
- Opponent bonus token count per tier (not exact values)
- Both herd sizes (visible)
- Deck count (visible)
- Discard pile (inferrable — all sold/exchanged cards are visible)

It does NOT know:
- Opponent's initial 5-card deal
- Deck order
- Opponent's exact bonus token values

## Information Tracking

### Opponent Hand Tracking

The bot maintains two data structures:

```typescript
knownInHand: Card[]     // cards we saw opponent take from market, still in their hand
unknownInHand: number   // count of initial-deal cards still in opponent's hand
// invariant: knownInHand.length + unknownInHand === opp.hand.length
```

**Initialization (round start):**
```
knownInHand = []
unknownInHand = opp.hand.length  // 0-5 depending on camels in initial deal
```

Note: opponent's initial deal is 5 cards, but camels go straight to the herd. So `opp.hand.length` at game start reflects only the goods they were dealt. The bot sees the opponent's herd count (visible) but those initial camels are accounted for separately.

**Updates per opponent action:**

| Action | Update |
|---|---|
| Opponent takes card from market | Add card to `knownInHand` |
| Opponent sells cards | For each sold card: if in `knownInHand` → remove; else → decrement `unknownInHand` |
| Opponent exchanges (cards leaving hand) | For each card given to market: if in `knownInHand` → remove; else → decrement `unknownInHand` |
| Opponent exchanges (cards entering hand) | Add each taken market card to `knownInHand` |
| Opponent takes camels | No hand change. Herd increases (visible). |

### Unaccounted Cards

Computed by elimination at any point:

```
unaccountedCards = allCards(55)
  - myHand
  - myCamels (type: camel)
  - market
  - knownInOpponentHand
  - opponentKnownCamels (herd, type: camel)
  - discard (sold/exchanged cards, visible)

// Broken down by type:
unaccounted: Record<CardType, number>
totalUnaccounted = sum of all unaccounted
```

These unaccounted cards are distributed across two hidden locations:

```
unknownInHand cards → in opponent's hand
deckSize cards → in the deck
// invariant: totalUnaccounted === unknownInHand + deckSize
```

## Probability Model

### Opponent Hand Probabilities

For each good type, the expected count in the opponent's unknown hand slots:

```
expectedInOpponentHand(good) = unaccounted[good] * (unknownInHand / totalUnaccounted)
```

Total effective opponent holding of a good:

```
opponentEffective(good) = knownCount(good, knownInHand) + expectedInOpponentHand(good)
```

When `unknownInHand === 0`, the expected term is 0 for all goods — the opponent's hand is fully known and the formula collapses to exact counts.

### Deck Probabilities

When `unknownInHand === 0`, all unaccounted cards are in the deck:
```
P(next card is good) = unaccounted[good] / deckSize
```

When `unknownInHand > 0`, unaccounted cards are split between hand and deck:
```
expectedInDeck(good) = unaccounted[good] * (deckSize / totalUnaccounted)
P(next card is good) = expectedInDeck(good) / deckSize
```

### Market Replenishment

When the search simulates a take action, the market replenishes with an unknown card. The eval weights the resulting position by the probability of each card type appearing, rather than placing a specific card.

## Search

### Algorithm

Alpha-beta minimax (same skeleton as Hard III/IV) with probability-weighted evaluation.

### Adaptive Depth

```
if unknownInHand > 0:
  // Partial information — shallower search
  Iterative deepening depth 2→4
  Both opponent hand and deck are probabilistic in eval
else:
  // Opponent hand fully known — deeper search
  Iterative deepening depth 2→6
  Only deck order is probabilistic in eval
```

### Endgame Solver

Uses the same trigger as Hard IV:

```
(1 pile depleted AND any second pile ≤ 2 tokens) OR deck ≤ 10
```

Only activates when `unknownInHand === 0` (opponent hand fully known). When triggered, searches to unlimited depth (no depth cap) with up to 12s budget.

When `unknownInHand > 0` and endgame trigger fires, the bot uses depth 2-4 search — it can't fully solve with probabilistic hand info.

### Time Budget

- Normal play: 7s
- Endgame solving (unknownInHand === 0): 12s
- Worker bridge timeout: 15s

### Move Ordering

Same priority as Hard III/IV: sells (precious first) > precious takes completing a pair > other takes > exchanges > camels. Uses `opponentEffective` counts instead of exact opponent counts for ordering decisions.

## Evaluation Function

Same improved factors as Hard IV, but using probability-weighted opponent holdings:

### Factors from Hard IV (adapted)

1. **Realized rupee differential** (×2.0) — unchanged, uses exact token values
2. **Actual bonus token values** (×1.5) — own bonuses exact, opponent bonuses estimated by tier midpoint (tier 3 → 2, tier 4 → 5, tier 5 → 9)
3. **Sellable goods with urgency** — uses `opponentEffective(good)` instead of exact `goodCount(opp.hand, good)`
4. **Market tempo** — unchanged, market is visible
5. **Nonlinear camel value** — `oppMaxCamels` uses `opp.herd + camelsInMarket + expectedCamelsInDeck` instead of exact deck count
6. **Hand pressure** — unchanged, hand sizes are visible
7. **Token depletion cascade** — uses expected opponent holdings to estimate if opponent could trigger a round-ending sell
8. **Market-context "almost sellable"** — for own hand, same as Hard IV. For opponent threat assessment, uses `opponentEffective`
9. **Sell timing pressure** — uses `opponentEffective(good) >= minSell` as a probability-weighted threshold

### Opponent Bonus Token Estimation

The bot knows the opponent earned a tier-3 bonus but not whether it's worth 1, 2, or 3. Uses tier midpoint:
- Tier 3: estimate 2 pts
- Tier 4: estimate 5 pts
- Tier 5: estimate 9 pts

## Architecture

### Files

| File | Change |
|---|---|
| `src/ai/fairBot.ts` | **New.** Probability tracking, probability-weighted eval, adaptive search, endgame solver, `pickFairBotAction()`. |
| `src/ai/fairBotWorker.ts` | **New.** Web Worker wrapper calling `pickFairBotAction`. |
| `tests/engine/fairBot.test.ts` | **New.** Tests for probability tracking, eval with partial info, endgame solving, known-hand transition. |
| `src/ai/workerBridge.ts` | Add `getFairBotWorkerBridge()` singleton with 15s timeout. |
| `src/store/gameStore.ts` | Add `'fair'` to `Difficulty` type, wire worker bridge. Add opponent hand tracking state (`knownInHand`, `unknownInHand`) updated on each dispatch. |
| `src/screens/HomeScreen.tsx` | Add Fair Bot button. |

### Tracking State in Game Store

The `knownInHand` and `unknownInHand` tracking needs to update on every opponent action. This happens in the game store's `dispatch` function — after `applyAction` succeeds, inspect the action and update the tracking arrays.

The tracking state resets on `nextRound()` (new round = new deal = fresh unknowns).

## Game Progression

```
Early game (turns 1-5):
  unknownInHand = 2-5
  Bot searches depth 2-4
  Opponent holdings are probabilistic
  Deck composition partially uncertain

Mid game (turns 6-15):
  unknownInHand typically drops to 0
  Bot upgrades to depth 2-6
  Only deck order remains uncertain

Late game (turns 15+):
  Full depth search
  Endgame solver if trigger fires
  Deck is small → probability distribution is sharp
  Near-optimal play
```

## Future Enhancements (not in scope)

- **Behavioral probability adjustment:** Update hand probabilities based on opponent's action patterns (e.g., taking camels when market has gold suggests they can't sell what they have → likely holding precious goods). Noted for Hard V / opponent modeling.
- **Opponent bonus value Bayesian updating:** Track how many tokens the opponent took from each tier pile to narrow the range of their bonus values.

## Out of Scope

- No transposition table.
- No multi-round / seals awareness.
- No opponent behavioral modeling.
- No UI changes beyond adding the button.
- Status line stays "AI is thinking..." — no special variant.

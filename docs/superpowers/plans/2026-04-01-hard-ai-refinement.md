# Implementation Plan: Hard II "Strategic Aggression" Overhaul

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Hard II AI into a proactive, tactical opponent that manages the game clock, blocks opponent sets, starves the opponent of resources, and manages market draw risks.

**Architecture:** Update the `evalPositionFair` function in `src/ai/hardAi2.ts` with new heuristic modules. Add a probability-based "Deck Heat" calculator to penalize risky market flips.

**Tech Stack:** TypeScript, Game Engine Logic.

---

### Task 1: Deck Heat & Market Flip Logic

**Files:**
- Modify: `src/ai/hardAi2.ts`

- [ ] **Step 1: Implement `getDeckHeat` helper function**
Add a helper to calculate the probability of drawing high-value cards.
```typescript
function getDeckHeat(state: GameState, myIndex: 0 | 1): number {
  const me = state.players[myIndex]
  const knownIds = new Set<number>()
  me.hand.forEach(c => knownIds.add(c.id))
  state.market.forEach(c => knownIds.add(c.id))
  state.discard.forEach(c => knownIds.add(c.id))
  
  const oppIndex = myIndex === 0 ? 1 : 0
  state.revealedHands[oppIndex].forEach(id => knownIds.add(id))

  const allCards = createDeck()
  const unknownPool = allCards.filter(c => !knownIds.has(c.id))
  if (unknownPool.length === 0) return 0

  const preciousCount = unknownPool.filter(c => 
    c.type === 'diamond' || c.type === 'gold' || c.type === 'silver'
  ).length

  return preciousCount / unknownPool.length
}
```

- [ ] **Step 2: Update `evalPositionFair` to include draw risk**
Penalize states with empty market slots when deck heat is high.
```typescript
  // Inside evalPositionFair:
  const heat = getDeckHeat(state, myIndex)
  const drawRisk = (5 - state.market.length) * heat * 20
  score -= drawRisk
```

- [ ] **Step 3: Test and Commit**
```bash
git add src/ai/hardAi2.ts
git commit -m "ai: implement deck heat and market flip risk heuristics"
```

---

### Task 2: Defensive Valuation ("Hate-Drafting")

**Files:**
- Modify: `src/ai/hardAi2.ts`

- [ ] **Step 1: Implement Opponent Hand Tracking Heuristic**
Update `evalPositionFair` to penalize the AI if the opponent has sets building in their revealed hand.
```typescript
  // Inside evalPositionFair:
  const oppRevealed = state.revealedHands[oppIndex]
  const allCards = createDeck()
  const oppHandMap = new Map<string, number>()
  
  oppRevealed.forEach(id => {
    const card = allCards.find(c => c.id === id)
    if (card && card.type !== 'camel') {
      const type = card.type as string
      oppHandMap.set(type, (oppHandMap.get(type) ?? 0) + 1)
    }
  })

  for (const [type, count] of oppHandMap.entries()) {
    // If opponent has 2, it's a huge threat. If they have 1, it's a minor threat.
    const threatLevel = count === 2 ? 25 : count === 1 ? 8 : 30 // 3+ is already a finished set
    score -= threatLevel
  }
```

- [ ] **Step 2: Test and Commit**
```bash
git add src/ai/hardAi2.ts
git commit -m "ai: implement defensive valuation (hate-drafting) heuristic"
```

---

### Task 3: Round-End Sniping & Camel Starvation

**Files:**
- Modify: `src/ai/hardAi2.ts`

- [ ] **Step 1: Implement heuristics for clock management and camel control**
Update `evalPositionFair` to manage round ends and punish low-camel opponents.
```typescript
  // Inside evalPositionFair:
  
  // Camel Starvation
  if (opp.herd === 0) {
    score += me.herd * 3.0 // High value on AI having camels while opponent has none
  }

  // Round-End Sniping
  const emptyPiles = GOOD_ORDER.filter(g => state.tokens[g].length === 0).length
  const myRealScore = me.tokens.reduce((s, t) => s + t.value, 0)
  const oppRealScore = opp.tokens.reduce((s, t) => s + t.value, 0)

  if (myRealScore > oppRealScore + 5) {
    score += emptyPiles * 15 // AI likes empty piles when winning
  } else if (oppRealScore > myRealScore + 5) {
    score -= emptyPiles * 25 // AI avoids empty piles when losing
  }
```

- [ ] **Step 2: Test and Commit**
```bash
git add src/ai/hardAi2.ts
git commit -m "ai: implement round-end sniping and camel starvation heuristics"
```

---

### Task 4: Final Polish

**Files:**
- Modify: `src/ai/hardAi2.ts`

- [ ] **Step 1: Final review of weights**
Ensure all new heuristics are balanced and the AI plays fluidly.

- [ ] **Step 2: Final Verification**
Run: `npx tsc --noEmit && pnpm test`

- [ ] **Step 3: Commit**
```bash
git add src/ai/hardAi2.ts
git commit -m "ai: finalize Hard II strategic aggression overhaul"
```

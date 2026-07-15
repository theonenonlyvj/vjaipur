# UI Refresh & Premium Visuals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform vJaipur into a "Premium Edition" with high-fidelity assets, tactile tokens, and enhanced scoring transparency.

**Architecture:** Implement CSS-driven visual enhancements (linen textures, glassmorphism) and component-level logic for new UX features. Use Zustand for state persistence of match settings and move context.

**Tech Stack:** React, TypeScript, Framer Motion (for animations), Zustand (state).

---

### Task 1: Atmospheric Board & Global Typography

**Files:**
- Modify: `src/index.css`
- Modify: `src/screens/GameScreen.tsx`

- [ ] **Step 1: Apply global 'Iosevka Charon' and mahogany background**
Modify `src/index.css`:
```css
@import url('https://fonts.googleapis.com/css2?family=Iosevka+Charon:wght@400;700;900&display=swap');

:root {
  --mahogany: #2a1a08;
  --charcoal: #050505;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 0;
  font-family: 'Iosevka Charon', monospace;
  background: radial-gradient(circle at center, var(--mahogany) 0%, var(--charcoal) 100%);
  color: #f0e8d8;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}

button, input, select, textarea {
  font-family: inherit;
}
```

- [ ] **Step 2: Apply glassmorphism to GameScreen containers**
Modify `src/screens/GameScreen.tsx`:
Add a `glassStyle` constant and apply it to the main layout containers (TokenRail, StatusBars, etc.).
```tsx
const glassStyle: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.03)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  borderRadius: '16px',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
}
```

- [ ] **Step 3: Run verify**
Run: `npm run dev` (manual visual check)

- [ ] **Step 4: Commit**
```bash
git add src/index.css src/screens/GameScreen.tsx
git commit -m "style: apply global premium typography and atmospheric board background"
```

---

### Task 2: Premium Card Assets

**Files:**
- Modify: `src/components/Card.tsx`

- [ ] **Step 1: Implement linen texture and linear gradients**
Modify `src/components/Card.tsx` to use the new `BG` map and add the `linenOverlay` div.
```tsx
const BG: Record<CardType, string> = {
  diamond: 'linear-gradient(135deg, #e6194b, #600000)',
  gold:    'linear-gradient(135deg, #f0c030, #806000)',
  silver:  'linear-gradient(135deg, #a9a9a9, #404040)',
  cloth:   'linear-gradient(135deg, #911eb4, #300050)',
  spice:   'linear-gradient(135deg, #f58231, #603000)',
  leather: 'linear-gradient(135deg, #964b00, #301500)',
  camel:   'linear-gradient(135deg, #d0a860, #604010)',
}

// Add inside motion.div:
<div style={{
  position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
  backgroundImage: "url('https://www.transparenttextures.com/patterns/linen.png')",
  opacity: 0.25, pointerEvents: 'none', zIndex: 1
}} />
```

- [ ] **Step 2: Update typography and selection style**
Update `animate` prop in `src/components/Card.tsx`:
```tsx
animate={{
  scale: selected ? 1.05 : 1,
  y: selected ? -12 : 0,
  boxShadow: selected 
    ? '0 20px 40px rgba(0,0,0,0.6), 0 0 0 3px rgba(255,255,255,0.9)' 
    : '0 4px 12px rgba(0,0,0,0.4)',
}}
```
Increase label font size to 14px and weight to 900.

- [ ] **Step 3: Test**
Run: `npm run test` (verify Card.test.tsx still passes)

- [ ] **Step 4: Commit**
```bash
git add src/components/Card.tsx
git commit -m "style: implement premium linen cards with high-fidelity styling"
```

---

### Task 3: Tactile Token Rail

**Files:**
- Modify: `src/components/TokenRail.tsx`

- [ ] **Step 1: Implement physical coin style for goods**
Modify `src/components/TokenRail.tsx` to add radial gradients and shine effects.
```tsx
const getCoinStyle = (type: Good): React.CSSProperties => ({
  width: 50, height: 50, borderRadius: '50%',
  background: `radial-gradient(circle at 35% 35%, var(--${type}-light), var(--${type}-dark))`,
  boxShadow: 'inset 0 2px 4px rgba(255,255,255,0.4), 0 6px 12px rgba(0,0,0,0.5)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 22, fontWeight: 900, color: '#fff', textShadow: '0 2px 4px rgba(0,0,0,0.3)'
})
```

- [ ] **Step 2: Implement Obsidian & Gold bonus tokens with geometries**
Add specific star patterns for 3, 4, and 5 tokens.
```tsx
const bonusStyle: React.CSSProperties = {
  background: 'radial-gradient(circle at 35% 35%, #444, #000)',
  border: '2px solid #f0c030',
  boxShadow: '0 6px 12px rgba(0,0,0,0.6)',
}
```

- [ ] **Step 3: Add stack counts**
Add `<div style={{ fontSize: 12, fontWeight: 900 }}>×{tokens.length}</div>` below each pile.

- [ ] **Step 4: Test**
Run: `npm run test` (verify TokenRail.test.tsx)

- [ ] **Step 5: Commit**
```bash
git add src/components/TokenRail.tsx
git commit -m "style: implement tactile coin tokens with explicit stack counts"
```

---

### Task 4: GameStore & Match Length Logic

**Files:**
- Modify: `src/store/gameStore.ts`

- [ ] **Step 1: Add matchLength state and actions**
```tsx
matchLength: 1 | 3 | 5,
setMatchLength: (l: 1 | 3 | 5) => set({ matchLength: l }),
```

- [ ] **Step 2: Update game-over condition**
In `nextRound` and `startNextRound`, replace `newSeals[0] >= 2` with `newSeals[0] >= (Math.floor(get().matchLength / 2) + 1)`.

- [ ] **Step 3: Commit**
```bash
git add src/store/gameStore.ts
git commit -m "feat: implement adjustable match length logic"
```

---

### Task 5: Match Length Selector

**Files:**
- Modify: `src/screens/HomeScreen.tsx`

- [ ] **Step 1: Add Match Length selector UI**
Add a row of buttons [1, 3, 5] above the game mode selection.
Style them to match the premium aesthetic.

- [ ] **Step 2: Commit**
```bash
git add src/screens/HomeScreen.tsx
git commit -m "feat: add Match Length selector to Home Screen"
```

---

### Task 6: ScoreCard Component

**Files:**
- Create: `src/components/ScoreCard.tsx`

- [ ] **Step 1: Create ScoreCard component**
Implement a beautiful breakdown of points.
```tsx
export function ScoreCard({ player, score, winner }: Props) {
  // Breakdown tokens, bonuses, camels
  // Display big total
  // Show "WINNER" badge if winner
}
```

- [ ] **Step 2: Commit**
```bash
git add src/components/ScoreCard.tsx
git commit -m "feat: implement ScoreCard for round/game summaries"
```

---

### Task 7: End-Game Screen Updates & Board Review

**Files:**
- Modify: `src/screens/RoundEndScreen.tsx`
- Modify: `src/screens/GameOverScreen.tsx`
- Modify: `src/screens/GameScreen.tsx`

- [ ] **Step 1: Implement "The Final Play" badge**
Show `lastMoveDescription` in a floating persistent badge on end screens.

- [ ] **Step 2: Implement Board Review**
Add `frozen?: boolean` prop to `GameScreen`. If true, apply `pointer-events: none` and `opacity: 0.8` to everything.
Add "View Final Board" toggle to `RoundEndScreen` and `GameOverScreen`.

- [ ] **Step 3: Commit**
```bash
git add src/screens/RoundEndScreen.tsx src/screens/GameOverScreen.tsx src/screens/GameScreen.tsx
git commit -m "feat: add board review and final play context to end screens"
```

---

### Task 8: Camel Stack in Hand

**Files:**
- Modify: `src/components/HandRow.tsx`

- [ ] **Step 1: Implement visual stack**
If `herd > 0`, render a special card at the end of the row.
Use absolute positioning for offset "shadow" cards behind the top camel card.
Add `xN` count badge.

- [ ] **Step 2: Wire up selection**
Clicking the stack should select camels for exchanges.

- [ ] **Step 3: Test**
Run: `npm run test` (verify hand selection logic)

- [ ] **Step 4: Commit**
```bash
git add src/components/HandRow.tsx
git commit -m "feat: implement physical Camel Stack in hand row"
```

---

### Task 9: Final Verification

- [ ] **Step 1: Run all tests**
Run: `npm run test`

- [ ] **Step 2: Full build**
Run: `npm run build`

- [ ] **Step 3: Manual playtest**
Check font, board mahogany background, card textures, and camel stack.
Verify 1-game vs 3-game match transitions.

# Framer Motion Animations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Framer Motion layout and enter/exit animations to all key card interactions — take-single, take-camels, sell, exchange, card enter/exit, bonus reveal — without adding any new store state or breaking existing tests.

**Architecture:** Each `Card` gets its stable `card.id` as a Framer Motion `layoutId`, letting the library interpolate positions between mounts. `AnimatePresence` wraps rows for enter/exit. Token sliding uses a keyed `AnimatedTokenValue` component. No new Zustand state — animations are purely presentational.

**Framer Motion version:** 11 (already installed). Key APIs: `motion.div`, `AnimatePresence`, `layoutId`, `layout` prop, `useAnimationControls`.

---

## File Map

| Path | Action |
|------|--------|
| `src/components/Card.tsx` | Modify — wrap in `motion.div`, add `layoutId={card.id}` |
| `src/components/MarketRow.tsx` | Modify — wrap in `AnimatePresence mode="popLayout"` |
| `src/components/HandRow.tsx` | Modify — wrap in `AnimatePresence` |
| `src/components/TokenRail.tsx` | Modify — add `AnimatedTokenValue` for sliding top values |
| `src/screens/GameScreen.tsx` | Modify — add `layout` prop to outer column, bonus reveal local state |
| `tests/ui/Card.test.tsx` | Modify — mock framer-motion or use `initial={false}` wrapper |

---

## Task 1: Card layout animations (take-single, enter/exit)

**Goal:** Cards in market and hand animate position changes. When a card leaves the market, it slides away; when a new card enters, it slides in.

- [ ] **Step 1.1** Modify `src/components/Card.tsx`

Replace the outermost `<div>` with `<motion.div>`. Add `layoutId` (string of `card.id`), and `initial`/`animate`/`exit` variants:

```tsx
import { motion } from 'framer-motion'

// In Card component, add layoutId prop:
interface CardProps {
  card: Card
  // ... existing props
}

// Wrap outer div:
<motion.div
  layoutId={`card-${card.id}`}
  layout
  initial={{ opacity: 0, scale: 0.8 }}
  animate={{ opacity: 1, scale: 1 }}
  exit={{ opacity: 0, scale: 0.8 }}
  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
  // ... rest of existing div props
>
```

- [ ] **Step 1.2** Modify `src/components/MarketRow.tsx`

Wrap card list in `AnimatePresence mode="popLayout"` so exiting cards animate out before the row reflows:

```tsx
import { AnimatePresence } from 'framer-motion'

// Wrap the mapped cards:
<div style={{ display: 'flex', gap: 8 }}>
  <AnimatePresence mode="popLayout">
    {market.map((card, i) => (
      <Card key={card.id} card={card} ... />
    ))}
  </AnimatePresence>
</div>
```

Note: `key={card.id}` (not index) is critical for AnimatePresence to track cards correctly.

- [ ] **Step 1.3** Modify `src/components/HandRow.tsx`

Same pattern — wrap card map in `AnimatePresence mode="popLayout"`, use `key={card.id}`:

```tsx
<AnimatePresence mode="popLayout">
  {hand.map((card, i) => (
    <Card key={card.id} card={card} ... />
  ))}
</AnimatePresence>
```

- [ ] **Step 1.4** Fix tests

In `tests/ui/Card.test.tsx` and any test that renders `MarketRow` or `HandRow`, framer-motion layout animations may warn in jsdom. Mock framer-motion globally in `tests/setup.ts` or wrap renders in a `MotionConfig` with `reducedMotion="always"`:

```ts
// tests/setup.ts — add:
vi.mock('framer-motion', async () => {
  const actual = await vi.importActual<typeof import('framer-motion')>('framer-motion')
  return {
    ...actual,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: {
      div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }) =>
        <div {...props}>{children}</div>,
    },
  }
})
```

Actually, the better approach: use `MotionConfig reducedMotion="always"` in the test render helper, or just run `npm test` and fix failures as they appear.

- [ ] **Step 1.5** Run tests and fix any failures

```bash
cd /Users/vijayram/Cursor/vjaipur && npm test 2>&1 | tail -20
```

- [ ] **Step 1.6** Commit: `feat: add layout animations to Card, MarketRow, HandRow`

---

## Task 2: Token slide animation (sell action)

**Goal:** When a sell action awards tokens, the top-value display in TokenRail animates the number changing.

- [ ] **Step 2.1** In `src/components/TokenRail.tsx`, create an `AnimatedTokenValue` sub-component that uses `AnimatePresence` to animate the count sliding out/in when it changes:

```tsx
import { AnimatePresence, motion } from 'framer-motion'

function AnimatedTokenValue({ value }: { value: number | undefined }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={value ?? 'empty'}
        initial={{ y: -8, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 8, opacity: 0 }}
        transition={{ duration: 0.2 }}
        style={{ display: 'inline-block' }}
      >
        {value ?? '—'}
      </motion.span>
    </AnimatePresence>
  )
}
```

Replace static token top-value renders in `TokenRail` with `<AnimatedTokenValue value={pile[0]} />`.

- [ ] **Step 2.2** Run tests, fix failures, commit: `feat: animate token value changes in TokenRail`

---

## Task 3: Take-camels animation

**Goal:** When camels are taken, the camel cards in the market briefly pulse/scale before disappearing.

- [ ] **Step 3.1** In the `Card` component, add a `variant` prop (`'camel-taken' | undefined`). When `variant === 'camel-taken'`, override the `exit` animation to scale up then fade:

```tsx
exit={variant === 'camel-taken'
  ? { scale: 1.3, opacity: 0, transition: { duration: 0.3 } }
  : { opacity: 0, scale: 0.8 }}
```

- [ ] **Step 3.2** In `MarketRow`, pass `variant='camel-taken'` to camel cards during exit. This requires knowing which action was just taken — pass an optional `lastAction` prop to MarketRow, or use a local effect. Simplest: MarketRow tracks `prevMarket` via `useRef` and checks if a camel card was present before but gone now.

- [ ] **Step 3.3** Run tests, fix, commit: `feat: add camel-taken pulse animation`

---

## Task 4: Sell animation — cards fan off hand

**Goal:** When selling, cards in the hand animate out with a fan/stagger effect before the state updates.

Note: This is the most complex animation because it must happen BEFORE the state update. The simplest approach that doesn't require store changes: use `exit` animations with a stagger on the HandRow. Since `AnimatePresence` already handles exit, add `transition={{ delay: i * 0.05 }}` to each card based on its index.

- [ ] **Step 4.1** Pass a `sellStagger` boolean to `HandRow` (or compute it locally based on whether cards are disappearing). When multiple cards disappear in the same render, stagger their exits:

```tsx
// In Card.tsx, accept an optional exitDelay prop:
exit={{ opacity: 0, y: 20, transition: { delay: exitDelay ?? 0 } }}
```

- [ ] **Step 4.2** In `HandRow`, pass `exitDelay={i * 0.06}` to each Card.

- [ ] **Step 4.3** Run tests, fix, commit: `feat: stagger hand card exit animation on sell`

---

## Task 5: Bonus token reveal (3+ card sale)

**Goal:** After a 3+ card sale awards a bonus token, show a brief overlay with the token value flipping in.

This requires tracking when a bonus token was just earned. Two approaches:
- A) Track in the store (`lastBonusEarned: number | null`)
- B) Compare prevState to currentState in GameScreen via `useRef`

Recommend approach B to avoid store changes.

- [ ] **Step 5.1** In `GameScreen.tsx`, add a `prevStateRef = useRef(state)` and after each render, compare `prevState.players[myIndex].bonusTokens.length` to `state.players[myIndex].bonusTokens.length`. If increased, set local `showBonusReveal: boolean` state to true.

- [ ] **Step 5.2** Create `src/components/BonusReveal.tsx`:

```tsx
import { AnimatePresence, motion } from 'framer-motion'

export function BonusReveal({ show, onDone }: { show: boolean; onDone: () => void }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ scale: 0.5, opacity: 0, rotate: -10 }}
          animate={{ scale: 1.2, opacity: 1, rotate: 0 }}
          exit={{ scale: 0, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          onAnimationComplete={onDone}
          style={{
            position: 'fixed', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none', zIndex: 100,
          }}
        >
          <div style={{
            background: '#f0c030', color: '#3a1a00',
            borderRadius: 16, padding: '24px 48px',
            fontSize: 32, fontWeight: 900,
          }}>
            BONUS!
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
```

- [ ] **Step 5.3** Wire in `GameScreen.tsx`, render `<BonusReveal show={showBonusReveal} onDone={() => setShowBonusReveal(false)} />`.

- [ ] **Step 5.4** Run tests, fix, commit: `feat: add bonus token reveal overlay animation`

---

## Done

Run full suite: `cd /Users/vijayram/Cursor/vjaipur && npm test`

Then `superpowers:finishing-a-development-branch` to push.

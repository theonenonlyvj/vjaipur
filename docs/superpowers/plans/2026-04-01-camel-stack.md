# Camel Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the text-based camel buttons in HandRow with a visual camel stack card that shows herd size and provides +/- controls during exchanges.

**Architecture:** New `CamelStack` component renders a card-sized element with stacked offset layers proportional to herd size, an `xN` badge, and +/- buttons that appear during exchange mode after tapping the stack. HandRow removes its old camel buttons and renders CamelStack at the end of the hand, separated by a subtle divider.

**Tech Stack:** React, framer-motion (for selected lift animation), vitest + @testing-library/react

---

## File Structure

| File | Role |
|---|---|
| `src/components/CamelStack.tsx` | **Create.** Self-contained camel stack visual + badge + +/- controls. |
| `src/components/HandRow.tsx` | **Modify.** Remove old camel buttons, render CamelStack after hand cards with divider. |
| `tests/ui/CamelStack.test.tsx` | **Create.** Unit tests for CamelStack component. |

No changes to GameScreen, ActionBar, StatusBar, or engine.

---

### Task 1: CamelStack — Tests

**Files:**
- Create: `tests/ui/CamelStack.test.tsx`

- [ ] **Step 1: Write test file with all CamelStack tests**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CamelStack } from '../../src/components/CamelStack'

const noop = () => {}

describe('CamelStack', () => {
  it('does not render when herd is 0', () => {
    const { container } = render(
      <CamelStack herd={0} camelsUsed={0} inExchange={false} onUseHerdCamel={noop} onRemoveCamel={noop} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders badge with herd count when herd > 0', () => {
    render(
      <CamelStack herd={5} camelsUsed={0} inExchange={false} onUseHerdCamel={noop} onRemoveCamel={noop} />
    )
    expect(screen.getByText('x5')).toBeInTheDocument()
  })

  it('badge shows available count (herd - camelsUsed)', () => {
    render(
      <CamelStack herd={5} camelsUsed={2} inExchange={true} onUseHerdCamel={noop} onRemoveCamel={noop} />
    )
    expect(screen.getByText('x3')).toBeInTheDocument()
  })

  it('does not show +/- controls when not in exchange', () => {
    render(
      <CamelStack herd={3} camelsUsed={0} inExchange={false} onUseHerdCamel={noop} onRemoveCamel={noop} />
    )
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows + control after tapping stack during exchange', () => {
    render(
      <CamelStack herd={3} camelsUsed={0} inExchange={true} onUseHerdCamel={noop} onRemoveCamel={noop} />
    )
    // Tap the stack to reveal controls
    fireEvent.click(screen.getByTestId('camel-stack'))
    expect(screen.getByText('+')).toBeInTheDocument()
    expect(screen.getByText('(use 1)')).toBeInTheDocument()
  })

  it('hides - button when camelsUsed is 0', () => {
    render(
      <CamelStack herd={3} camelsUsed={0} inExchange={true} onUseHerdCamel={noop} onRemoveCamel={noop} />
    )
    fireEvent.click(screen.getByTestId('camel-stack'))
    expect(screen.queryByText('(remove 1)')).toBeNull()
  })

  it('shows - button when camelsUsed > 0', () => {
    render(
      <CamelStack herd={3} camelsUsed={1} inExchange={true} onUseHerdCamel={noop} onRemoveCamel={noop} />
    )
    fireEvent.click(screen.getByTestId('camel-stack'))
    expect(screen.getByText('(remove 1)')).toBeInTheDocument()
  })

  it('calls onUseHerdCamel when + is clicked', () => {
    const onUse = vi.fn()
    render(
      <CamelStack herd={3} camelsUsed={0} inExchange={true} onUseHerdCamel={onUse} onRemoveCamel={noop} />
    )
    fireEvent.click(screen.getByTestId('camel-stack'))
    fireEvent.click(screen.getByText('+'))
    expect(onUse).toHaveBeenCalledOnce()
  })

  it('calls onRemoveCamel when - is clicked', () => {
    const onRemove = vi.fn()
    render(
      <CamelStack herd={3} camelsUsed={2} inExchange={true} onUseHerdCamel={noop} onRemoveCamel={onRemove} />
    )
    fireEvent.click(screen.getByTestId('camel-stack'))
    fireEvent.click(screen.getByText('-'))
    expect(onRemove).toHaveBeenCalledOnce()
  })

  it('disables + when all camels are used', () => {
    render(
      <CamelStack herd={2} camelsUsed={2} inExchange={true} onUseHerdCamel={noop} onRemoveCamel={noop} />
    )
    fireEvent.click(screen.getByTestId('camel-stack'))
    const plusBtn = screen.getByText('+').closest('button')!
    expect(plusBtn.disabled).toBe(true)
  })

  it('renders no offset layers when herd is 1', () => {
    const { container } = render(
      <CamelStack herd={1} camelsUsed={0} inExchange={false} onUseHerdCamel={noop} onRemoveCamel={noop} />
    )
    const layers = container.querySelectorAll('[data-testid="stack-layer"]')
    expect(layers.length).toBe(0)
  })

  it('renders 1 offset layer when herd is 2', () => {
    const { container } = render(
      <CamelStack herd={2} camelsUsed={0} inExchange={false} onUseHerdCamel={noop} onRemoveCamel={noop} />
    )
    const layers = container.querySelectorAll('[data-testid="stack-layer"]')
    expect(layers.length).toBe(1)
  })

  it('renders 2 offset layers when herd is 3+', () => {
    const { container } = render(
      <CamelStack herd={5} camelsUsed={0} inExchange={false} onUseHerdCamel={noop} onRemoveCamel={noop} />
    )
    const layers = container.querySelectorAll('[data-testid="stack-layer"]')
    expect(layers.length).toBe(2)
  })

  it('controls auto-show when camelsUsed > 0 in exchange (already tapped)', () => {
    render(
      <CamelStack herd={3} camelsUsed={1} inExchange={true} onUseHerdCamel={noop} onRemoveCamel={noop} />
    )
    // Controls should auto-reveal when camelsUsed > 0 (user already interacting)
    expect(screen.getByText('+')).toBeInTheDocument()
    expect(screen.getByText('(remove 1)')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd vjaipur && npx vitest run tests/ui/CamelStack.test.tsx`
Expected: FAIL — `CamelStack` module not found.

---

### Task 2: CamelStack — Implementation

**Files:**
- Create: `src/components/CamelStack.tsx`

- [ ] **Step 1: Create CamelStack component**

```tsx
import { useState, useEffect, type CSSProperties } from 'react'
import { motion } from 'framer-motion'

interface CamelStackProps {
  herd: number
  camelsUsed: number
  inExchange: boolean
  onUseHerdCamel: () => void
  onRemoveCamel: () => void
}

const CAMEL_ICON = 'https://raw.githubusercontent.com/hfg-gmuend/openmoji/master/color/svg/1F42A.svg'

export function CamelStack({ herd, camelsUsed, inExchange, onUseHerdCamel, onRemoveCamel }: CamelStackProps) {
  const [isMobile, setIsMobile] = useState(false)
  const [showControls, setShowControls] = useState(false)

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 480)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Auto-show controls when camelsUsed > 0 during exchange (user already interacting)
  useEffect(() => {
    if (camelsUsed > 0 && inExchange) setShowControls(true)
  }, [camelsUsed, inExchange])

  // Hide controls when exchange ends
  useEffect(() => {
    if (!inExchange) setShowControls(false)
  }, [inExchange])

  if (herd === 0) return null

  const available = herd - camelsUsed
  const selected = camelsUsed > 0

  // Card dimensions — match md CardView
  const baseW = 75
  const baseH = 105
  const w = isMobile ? baseW * 0.9 : baseW
  const h = isMobile ? baseH * 0.9 : baseH

  // Stack layers: 0 for herd=1, 1 for herd=2, 2 for herd>=3
  const layerCount = herd === 1 ? 0 : herd === 2 ? 1 : 2

  const handleStackClick = () => {
    if (inExchange && !showControls) setShowControls(true)
  }

  const layerStyle = (offset: number): CSSProperties => ({
    position: 'absolute',
    width: w,
    height: h,
    background: 'linear-gradient(135deg, #a08040, #403010)',
    border: '1.5px solid rgba(255,255,255,0.08)',
    borderRadius: 10,
    top: offset,
    left: offset,
    zIndex: 0,
  })

  const controlsVisible = inExchange && showControls

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {/* Stack container */}
      <div
        data-testid="camel-stack"
        onClick={handleStackClick}
        style={{
          position: 'relative',
          width: w + (layerCount * 3),
          height: h + (layerCount * 3),
          cursor: inExchange && !showControls ? 'pointer' : 'default',
          flexShrink: 0,
        }}
      >
        {/* Offset layers */}
        {Array.from({ length: layerCount }).map((_, i) => (
          <div
            key={i}
            data-testid="stack-layer"
            style={layerStyle((layerCount - i) * 3)}
          />
        ))}

        {/* Front card */}
        <motion.div
          animate={{ y: selected ? -6 : 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          style={{
            position: 'relative',
            width: w,
            height: h,
            background: 'linear-gradient(135deg, #d0a860, #604010)',
            border: selected ? '3px solid #fff' : '1.5px solid rgba(255,255,255,0.15)',
            borderRadius: 10,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            userSelect: 'none',
            overflow: 'hidden',
            zIndex: 1,
          }}
        >
          {/* Linen texture */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            backgroundImage: "url('https://www.transparenttextures.com/patterns/linen.png')",
            opacity: 0.25,
            pointerEvents: 'none',
            zIndex: 1,
          }} />

          {/* Card content */}
          <div style={{ zIndex: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: isMobile ? 6 : 8 }}>
            <img
              src={CAMEL_ICON}
              alt="camel"
              style={{
                width: isMobile ? 32 : 36,
                height: isMobile ? 32 : 36,
                marginBottom: isMobile ? 4 : 6,
                pointerEvents: 'none',
              }}
            />
            <span style={{
              color: 'rgba(255,255,255,0.9)',
              fontSize: isMobile ? 12 : 14,
              fontWeight: 900,
              letterSpacing: 1.5,
              pointerEvents: 'none',
            }}>
              CAMEL
            </span>
          </div>

          {/* Badge */}
          <div style={{
            position: 'absolute',
            top: 4,
            right: 4,
            background: '#2a1800',
            border: '1px solid #d0a860',
            borderRadius: 10,
            padding: '1px 6px',
            fontSize: 11,
            fontWeight: 700,
            color: '#d0a860',
            zIndex: 3,
          }}>
            x{available}
          </div>
        </motion.div>
      </div>

      {/* +/- controls */}
      {controlsVisible && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button
            onClick={onUseHerdCamel}
            disabled={available <= 0}
            style={{
              ...ctrlBtn,
              opacity: available <= 0 ? 0.4 : 1,
              cursor: available <= 0 ? 'not-allowed' : 'pointer',
            }}
          >
            <span style={{ fontSize: 16, fontWeight: 700 }}>+</span>
            <span style={{ fontSize: 10, color: '#aaa' }}>(use 1)</span>
          </button>
          {camelsUsed > 0 && (
            <button onClick={onRemoveCamel} style={{ ...ctrlBtn, background: '#4a2010', borderColor: '#c08040' }}>
              <span style={{ fontSize: 16, fontWeight: 700 }}>-</span>
              <span style={{ fontSize: 10, color: '#aaa' }}>(remove 1)</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

const ctrlBtn: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  padding: '6px 10px',
  background: '#5a4010',
  color: '#f0e8d8',
  border: '1px solid #d0a860',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  lineHeight: 1.2,
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd vjaipur && npx vitest run tests/ui/CamelStack.test.tsx`
Expected: All 13 tests PASS.

- [ ] **Step 3: Commit**

```bash
cd vjaipur && git add src/components/CamelStack.tsx tests/ui/CamelStack.test.tsx && git commit -m "feat: add CamelStack component with visual stack, badge, and +/- controls"
```

---

### Task 3: HandRow — Integrate CamelStack and Remove Old Buttons

**Files:**
- Modify: `src/components/HandRow.tsx`

- [ ] **Step 1: Replace old camel buttons with CamelStack in HandRow**

Replace the entire contents of `HandRow.tsx` with:

```tsx
import { useState, useEffect } from 'react'
import { AnimatePresence } from 'framer-motion'
import type { Card } from '../engine'
import { CardView } from './Card'
import { CamelStack } from './CamelStack'

interface Props {
  hand: Card[]
  inExchange: boolean
  selectedIndices: number[]
  camelsUsed: number
  herd: number
  onToggleSelect: (i: number) => void
  onUseHerdCamel: () => void
  onRemoveCamel: () => void
}

export function HandRow({ hand, inExchange, selectedIndices, camelsUsed, herd, onToggleSelect, onUseHerdCamel, onRemoveCamel }: Props) {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 480)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  if (hand.length === 0 && herd === 0) {
    return (
      <div style={{ padding: '12px 0', color: '#888', textAlign: 'center', minHeight: 116 }}>
        No cards in hand
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', gap: isMobile ? 8 : 12, flexWrap: 'wrap', justifyContent: 'center', padding: '8px 0', minHeight: 116, alignItems: 'center' }}>
      <AnimatePresence mode="popLayout">
        {hand.map((card, i) => {
          const selected = selectedIndices.includes(i)
          const handleClick = () => onToggleSelect(i)
          return (
            <CardView
              key={card.id}
              card={card}
              selected={selected}
              onClick={handleClick}
              size="md"
            />
          )
        })}
      </AnimatePresence>

      {herd > 0 && (
        <>
          {/* Subtle divider between hand cards and camel stack */}
          {hand.length > 0 && (
            <div style={{
              width: 1,
              height: 80,
              background: 'rgba(255,255,255,0.1)',
              alignSelf: 'center',
              marginLeft: 4,
              marginRight: 4,
              flexShrink: 0,
            }} />
          )}
          <CamelStack
            herd={herd}
            camelsUsed={camelsUsed}
            inExchange={inExchange}
            onUseHerdCamel={onUseHerdCamel}
            onRemoveCamel={onRemoveCamel}
          />
        </>
      )}
    </div>
  )
}
```

Key changes from original:
- Removed the `camelBtnStyle` const and the old `{inExchange && (...)}` button block entirely.
- Added `CamelStack` import and render after hand cards.
- Added a 1px vertical divider between hand cards and camel stack (only when both exist).
- Empty-hand check now also considers `herd === 0` (show "No cards" only when truly empty).

- [ ] **Step 2: Run full test suite to verify nothing broke**

Run: `cd vjaipur && npx vitest run`
Expected: All tests pass (including new CamelStack tests and existing GameScreen/HandRow-related tests).

- [ ] **Step 3: Commit**

```bash
cd vjaipur && git add src/components/HandRow.tsx && git commit -m "feat: integrate CamelStack into HandRow, remove old camel buttons"
```

---

### Task 4: Manual Verification and Final Commit

- [ ] **Step 1: Run TypeScript type check**

Run: `cd vjaipur && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 2: Run full test suite one more time**

Run: `cd vjaipur && npx vitest run`
Expected: All tests pass.

- [ ] **Step 3: Run dev server for manual inspection**

Run: `cd vjaipur && npx vite --port 5173`
Expected: App starts. Navigate to a vs-AI game. Verify:
- Camel stack appears at end of hand when herd > 0
- Stack depth matches herd count (1=no layers, 2=one layer, 3+=two layers)
- Badge shows correct count
- Tapping stack during exchange reveals +/- controls
- +/- correctly add/remove camels
- Stack disappears when herd is 0
- Controls disappear when exchange ends

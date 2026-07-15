# Camel Stack in Hand — Design Spec

**Date:** 2026-04-01
**Status:** Approved

## Summary

Replace the text-based "Use Camel / Remove Camel" buttons in HandRow with a visual camel stack card that renders at the end of the player's hand. The stack visually represents the herd size and provides +/- controls during exchanges.

## Visual Design

### Stack Card

- Renders at the **end of HandRow**, separated from goods cards by an 8px gap and a subtle vertical divider (1px, `rgba(255,255,255,0.1)`).
- Same dimensions as a `md` CardView (75x105 desktop, 90% on mobile).
- Uses the existing camel gradient (`linear-gradient(135deg, #d0a860, #604010)`) and camel icon.

### Stack Depth (offset layers behind the front card)

The number of visible offset layers reflects actual herd size:

- `herd === 1` — Single card, no offset layers.
- `herd === 2` — One offset layer (3px right, 3px down).
- `herd >= 3` — Two offset layers (3px/3px and 6px/6px).

Offset layers use the camel gradient but darker, with no content — just background cards peeking out.

### Count Badge

- Top-right corner of the front card.
- Gold text on dark pill: `background: #2a1800`, `border: 1px solid #d0a860`, `border-radius: 10px`.
- Displays **available** count: `herd - camelsUsed`.
- Updates live as camels are committed to an exchange.

## States

| State | Rendering |
|---|---|
| `herd === 0` | Not rendered at all |
| `herd > 0`, not in exchange | Stack + badge, no interactivity (`cursor: default`) |
| `herd > 0`, in exchange | Stack + badge, tappable to reveal +/- controls |
| `camelsUsed > 0` | Stack card gets selected treatment (white border, slight y-lift) |

## Interaction: +/- Controls

When `inExchange === true` and the player taps the camel stack:

- Compact `+` and `-` buttons appear **to the right** of the stack in a small vertical column.
- **`+` button:** Label `+` with subtle text `(use 1)`. Calls `onUseHerdCamel`. Disabled when `availableCamels === 0`.
- **`-` button:** Label `-` with subtle text `(remove 1)`. Calls `onRemoveCamel`. Hidden entirely when `camelsUsed === 0`.
- Controls **stay visible** for the duration of the exchange — no need to re-tap the stack.
- Controls disappear when `inExchange` becomes false (market selection cleared or exchange confirmed).

## Files Changed

| File | Change |
|---|---|
| `src/components/CamelStack.tsx` | **New.** Self-contained component: stack visual, badge, +/- controls. |
| `src/components/HandRow.tsx` | Remove old "Use Camel / Remove Camel" text buttons. Render `CamelStack` at end of hand cards, separated by divider. |
| `src/components/StatusBar.tsx` | **No changes.** Camel count display remains as-is. |
| `src/components/ActionBar.tsx` | **No changes.** |
| `src/screens/GameScreen.tsx` | **No changes.** Already passes all needed props to HandRow. |

## CamelStack Props

```typescript
interface CamelStackProps {
  herd: number            // total camels in herd
  camelsUsed: number      // camels committed to current exchange
  inExchange: boolean     // whether 2+ market cards are selected
  onUseHerdCamel: () => void
  onRemoveCamel: () => void
}
```

## Out of Scope

- StatusBar camel count — unchanged.
- ActionBar layout — unchanged.
- Any changes to exchange logic or game engine.

# VJaipur — Design Spec
_2026-03-27_

## Overview

VJaipur is a web-based digital implementation of the 2-player card game Jaipur. Players collect and sell goods to earn rupees, aiming to be the first to win 2 Seals of Excellence across multiple rounds.

---

## Platform & Stack

- **Target:** Web app (browser, desktop and mobile)
- **Frontend:** React + TypeScript + Vite
- **State management:** Zustand
- **Animations:** Framer Motion
- **Sound:** Howler.js
- **Backend:** Node.js + Express + Socket.io (in-memory, no database)
- **AI:** Web Worker (MCTS for Hard, heuristics for Easy/Medium)

---

## Play Modes

| Mode | Description |
|---|---|
| vs AI | Single player vs computer. Difficulty: Easy / Medium / Hard. |
| Local | Two humans, same device, pass-and-play. |
| Online | Two humans, remote. Room codes or quick match. No accounts required. |
| Tutorial | Guided first game vs Easy AI. Skippable at any time. |

---

## Architecture

### Principle
The game engine is a pure TypeScript module — no side effects, no I/O. `applyAction(state, action) → Result<GameState, EngineError>`. The server never runs game logic; it only relays moves between online players.

### Components

**Browser (React SPA)**
- **Game Engine** — pure TS module; state + action → state. Shared across all modes.
- **AI Worker** — Web Worker thread running heuristics (Easy), eval + depth search (Medium), or MCTS (Hard). Move time capped at 2s for Hard.
- **React UI** — Zustand game store, Framer Motion animations, Howler.js sounds, React Router for screen navigation.
- **Socket Client** — active only in Online mode. Sends local actions, receives opponent actions, handles room join/leave.

**Node Server (Express + Socket.io)**
- **Room Manager** — in-memory rooms, create/join by 6-char code, quick match queue, 60s reconnect window on disconnect.
- **Move Relay** — broadcasts moves only, no game logic, stateless.

**Mode dispatch:**
- vs AI: engine + worker only, no server
- Local: engine only, no server
- Online: engine + socket relay
- Tutorial: AI mode wrapped with guidance overlay system

---

## Game Engine

### State Shape

```ts
type GameState = {
  phase: 'setup' | 'playing' | 'round-end' | 'game-over'
  round: number                    // 1–3 max
  activePlayer: 0 | 1
  market: Card[]                   // always 5 cards
  deck: Card[]
  discard: Card[]                  // face-up sold cards; used by UI and AI reasoning
  players: [PlayerState, PlayerState]
  tokens: TokenPiles               // remaining on board
  bonusTokens: BonusPiles          // 3/4/5+ stacks, count visible, values hidden
  seals: [number, number]          // seals earned per player
}

type PlayerState = {
  hand: Card[]                     // ≤7 goods at turn end
  herd: number                     // camel count
  tokens: Token[]                  // earned this round
}
```

### Actions

| Action | Description |
|---|---|
| `TAKE_SINGLE` | Take 1 goods card from market by index. Deck auto-refills the slot. |
| `TAKE_EXCHANGE` | Take ≥2 goods from market, return same count from hand. No same-type swap. Min 2 cards. Hand may transiently exceed 7 during resolution. |
| `TAKE_CAMELS` | Take all camels from market into herd. Camels never count toward hand limit. Refills all taken slots. Fails if no camels in market. |
| `SELL` | Sell ≥1 card of one type (≥2 for diamond/gold/silver). Awards goods tokens (highest first) + bonus token if 3+ cards sold. Checks round-end condition. |

### Hand Limit Rule
Every action runs full resolution first (cards move, deck refills, camels go to herd), then a single post-resolution check: `player.hand.length ≤ 7`. No intermediate state is ever rejected for hand size.

### Public API

```ts
applyAction(state, action)  → Result<GameState, EngineError>
getLegalActions(state)      → Action[]
scoreRound(state)           → RoundResult
setupRound(seals, prevLoser?) → GameState  // loser of previous round goes first
```

### Error Handling
Every `EngineError` carries a human-readable `reason` string (e.g. `"Diamonds require selling at least 2 at a time"`, `"You can't exchange just 1 card — minimum 2"`). The UI surfaces these as a non-intrusive toast in both regular gameplay and tutorial mode. The tutorial adds extra contextual guidance on top of the same error messages.

---

## Visual Design

### Principles
- Dark desert background (`#1a0a00` base)
- Atmospheric depth — glows, gradients, dramatic contrast
- **High contrast text vs background at all times, no exceptions**
- Each good has a distinct color; card backgrounds are that good's color
- Text labels always visible on cards (not icon-only)

### Good Colors

| Good | Card Background | Accent / Border |
|---|---|---|
| Diamond | Red (`#5a0010 → #c0102a`) | `#ff4060` |
| Gold | Gold (`#5a3a00 → #c08010`) | `#f0c030` |
| Silver | Blue-grey (`#2a3040 → #6a7a90`) | `#c0d0e0` |
| Cloth | Purple (`#2a0040 → #7a20a0`) | `#c060e0` |
| Spice | Green (`#0a2a00 → #307820`) | `#60c040` |
| Leather | Brown (`#2a1400 → #7a4018`) | `#c08040` |
| Camel | Sand (`#3a2a10 → #907040`) | `#d0a860` |

### Token Design
- Goods tokens: circular, colored to match their good, value on face
- Bonus tokens: square/rounded-square, warm gold, face-down (count visible, values hidden until scoring)
- Token count and running point total both visible in player status bar

---

## Game Board Layout

Vertically oriented, top to bottom:

1. **Opponent strip** (compact) — face-down card count, score hidden, camel count hidden by default
2. **Token rail** (compact) — all goods token stacks with remaining values visible; bonus token piles with remaining count visible; camel token
3. **Market** (hero) — 5 large cards, interactive
4. **Your hand** (hero) — your cards, interactive
5. **Your status bar** (compact) — herd count + 😏 Taunt button (optionally reveals your camel count to opponent), token count, running point total, turn indicator

---

## Screens & Navigation

```
Home
├── vs AI       → (difficulty picker) → Game Board
├── Local       → Game Board
├── Online      → (room code / quick match lobby) → Game Board
└── Tutorial    → Game Board (guided)

Game Board
├── Round End   → (scoring reveal, seal awarded) → new round or Game Over
└── Game Over   → (winner declared) → Home
```

---

## Animations (Framer Motion)

| Moment | Animation |
|---|---|
| Deal / setup | Cards fan out from deck one by one into hand and market |
| Take single | Card slides from market slot into hand; replacement slides in from deck |
| Exchange | Selected cards cross-slide simultaneously (market ↔ hand) |
| Take camels | All camel cards fly to herd pile; slots refill sequentially |
| Sell | Cards fan off hand into discard; tokens flip face-up and slide to your pile one by one |
| Big sale (3+) | Bonus token flips with dramatic slow reveal after goods tokens land |
| Round end | Tokens cascade face-down, then flip back for scoring reveal |
| Taunt | Camel count pops toward opponent's side with a bounce |

---

## Sound (Howler.js)

| Event | Sound |
|---|---|
| Take card | Soft whoosh |
| Take camels | Camel grunt |
| Sell 1–2 cards | Coin clink ×n |
| Big sale | Coin cascade + flourish |
| Bonus token reveal | Dramatic sting |
| Round end / seal | Fanfare |
| Taunt | Smug laugh or bell |

---

## AI Difficulty

| Level | Approach |
|---|---|
| Easy | Pure heuristics: sell at 3+, take highest-value good, no lookahead |
| Medium | Scored eval function (token tops, hand composition, camel count) + 1–2 ply lookahead |
| Hard | MCTS in Web Worker, thousands of playouts, move time capped at 2s |

---

## Online Multiplayer

- **Room codes** — 6-character code (e.g. `CAMEL7`). Creator shares with friend. Game starts when room is full.
- **Quick match** — joins matchmaking queue; server pairs first two waiting players.
- **Disconnect** — opponent sees "waiting for reconnect." Room stays alive 60s. No return = opponent wins by default.
- **No persistence** — rooms are ephemeral. No accounts, no match history.

---

## Tutorial Mode

- Wraps vs-AI (Easy) with a step-by-step guidance overlay system
- At each step, a tooltip/highlight explains what actions are available and why
- Invalid moves blocked with the same engine error messages as regular play, plus extra tutorial context
- Skippable at any time — drops into a normal AI game

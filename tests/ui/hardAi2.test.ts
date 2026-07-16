import { describe, it, expect } from 'vitest'
import { pickHard2Action } from '../../src/ai/hardAi2'
import { setupRound, applyAction } from '../../src/engine'
import type { GameState, Card, TokenPiles, Action } from '../../src/engine'

// REGRESSION TEST for a critical Hard II bug:
//
// `pickHard2Action` determinizes the hidden opponent hand via `fairifyState`,
// which slices random cards out of the full 55-card deck (`ALL_CARDS`) without
// excluding camels. Since `PlayerState.hand` is documented + enforced by the
// engine as "goods only" (camels live exclusively in `herd: number` — see
// src/engine/types.ts and every hand-producing path in src/engine/engine.ts /
// setup.ts), a camel slipping into a fairified opponent hand is an impossible
// state for the rest of the codebase. When the alpha-beta search later reaches
// a node where that contaminated hand is active, `getProfitableExchanges`
// (mediumAi.ts) maps the hand into `handGoods` and indexes token piles by
// card type via `topValue()` — `state.tokens['camel']` is undefined, so
// `undefined[0]` throws, and Hard II crashes almost every turn.
//
// This test builds several realistic mid-round states (goods-only hands +
// herd counts, camels present in the market, non-trivial discard/revealed
// hands, both players as the mover) and calls the real `pickHard2Action`
// entry point many times, the same way aiWorker2.ts does. Pre-fix this
// reliably throws on a large fraction of calls; post-fix it must never throw
// and must always return an action that is legal against the real state.

const PAD_DECK: Card[] = [
  { id: 200, type: 'leather' }, { id: 201, type: 'leather' },
  { id: 202, type: 'cloth' },   { id: 203, type: 'cloth' },
  { id: 204, type: 'spice' },   { id: 205, type: 'spice' },
  { id: 206, type: 'camel' },   { id: 207, type: 'camel' },
  { id: 208, type: 'leather' }, { id: 209, type: 'gold' },
  { id: 210, type: 'silver' },  { id: 211, type: 'diamond' },
]

const FULL_TOKENS: TokenPiles = {
  diamond: [7, 7, 5, 5, 5],
  gold: [6, 6, 5, 5, 5],
  silver: [5, 5, 5, 5, 5],
  cloth: [5, 3, 3, 2, 2, 1, 1],
  spice: [5, 3, 3, 2, 2, 1, 1],
  leather: [4, 3, 2, 1, 1, 1, 1, 1, 1],
}

const URGENT_TOKENS: TokenPiles = {
  ...FULL_TOKENS,
  diamond: [7, 7],
  gold: [6],
}

function buildState(
  activePlayer: 0 | 1,
  market: Card[],
  p0: { hand: Card[]; herd: number },
  p1: { hand: Card[]; herd: number },
  opts: { discard?: Card[]; revealedHands?: [number[], number[]]; tokens?: TokenPiles } = {},
): GameState {
  const base = setupRound([0, 0], undefined, () => 0.5)
  return {
    ...base,
    activePlayer,
    market,
    deck: PAD_DECK,
    discard: opts.discard ?? [],
    revealedHands: opts.revealedHands ?? [[], []],
    players: [
      { hand: p0.hand, herd: p0.herd, tokens: [], bonusTokens: [] },
      { hand: p1.hand, herd: p1.herd, tokens: [], bonusTokens: [] },
    ],
    tokens: opts.tokens ?? FULL_TOKENS,
  }
}

// Several realistic mid-round scenarios — mixed goods-only hands, camels
// present in the market, non-empty discard, some opponent cards revealed,
// and both players taking a turn as the mover.
function midRoundStates(): GameState[] {
  return [
    // 1. AI (p0) to move; opponent has a couple of revealed cards.
    buildState(
      0,
      [
        { id: 1, type: 'diamond' }, { id: 2, type: 'camel' },
        { id: 3, type: 'leather' }, { id: 4, type: 'camel' },
        { id: 5, type: 'gold' },
      ],
      { hand: [
          { id: 10, type: 'diamond' }, { id: 11, type: 'silver' },
          { id: 12, type: 'silver' }, { id: 13, type: 'cloth' },
        ], herd: 2 },
      { hand: [
          { id: 20, type: 'gold' }, { id: 21, type: 'spice' },
          { id: 22, type: 'spice' }, { id: 23, type: 'leather' },
          { id: 24, type: 'leather' },
        ], herd: 1 },
      { discard: [{ id: 30, type: 'cloth' }, { id: 31, type: 'spice' }], revealedHands: [[], [20, 21]] },
    ),
    // 2. Opponent (p1) to move; larger hands, heavier herds (camel-exchange branches).
    buildState(
      1,
      [
        { id: 1, type: 'camel' }, { id: 2, type: 'camel' },
        { id: 3, type: 'camel' }, { id: 4, type: 'silver' },
        { id: 5, type: 'cloth' },
      ],
      { hand: [
          { id: 10, type: 'diamond' }, { id: 11, type: 'diamond' },
          { id: 12, type: 'gold' }, { id: 13, type: 'leather' },
          { id: 14, type: 'leather' }, { id: 15, type: 'cloth' },
          { id: 16, type: 'spice' },
        ], herd: 0 },
      { hand: [
          { id: 20, type: 'silver' }, { id: 21, type: 'silver' },
          { id: 22, type: 'cloth' }, { id: 23, type: 'cloth' },
          { id: 24, type: 'spice' }, { id: 25, type: 'leather' },
        ], herd: 4 },
      { discard: [{ id: 32, type: 'diamond' }, { id: 33, type: 'leather' }], revealedHands: [[10, 11], [20]] },
    ),
    // 3. Urgent token depletion; AI (p0) to move, opponent hand fully unrevealed.
    buildState(
      0,
      [
        { id: 1, type: 'gold' }, { id: 2, type: 'gold' },
        { id: 3, type: 'camel' }, { id: 4, type: 'leather' },
        { id: 5, type: 'spice' },
      ],
      { hand: [
          { id: 10, type: 'gold' }, { id: 11, type: 'gold' },
          { id: 12, type: 'diamond' }, { id: 13, type: 'diamond' },
          { id: 14, type: 'diamond' },
        ], herd: 3 },
      { hand: [
          { id: 20, type: 'silver' }, { id: 21, type: 'cloth' },
          { id: 22, type: 'cloth' },
        ], herd: 2 },
      { discard: [{ id: 34, type: 'silver' }], tokens: URGENT_TOKENS },
    ),
    // 4. Opponent (p1) to move; AI hand at the 7-card limit.
    buildState(
      1,
      [
        { id: 1, type: 'silver' }, { id: 2, type: 'silver' },
        { id: 3, type: 'camel' }, { id: 4, type: 'camel' },
        { id: 5, type: 'diamond' },
      ],
      { hand: [
          { id: 10, type: 'leather' }, { id: 11, type: 'leather' },
          { id: 12, type: 'cloth' }, { id: 13, type: 'cloth' },
          { id: 14, type: 'spice' }, { id: 15, type: 'spice' },
          { id: 16, type: 'gold' },
        ], herd: 1 },
      { hand: [
          { id: 20, type: 'diamond' }, { id: 21, type: 'gold' },
          { id: 22, type: 'silver' },
        ], herd: 5 },
      { discard: [{ id: 35, type: 'gold' }, { id: 36, type: 'silver' }], revealedHands: [[16], [20, 21]] },
    ),
  ]
}

describe('pickHard2Action — camel-in-hand determinization crash (regression)', () => {
  it('never throws and always returns a legal action across many determinized searches', () => {
    const REPS_PER_STATE = 8
    let crashes = 0
    let calls = 0
    const sampleErrors: string[] = []

    for (const state of midRoundStates()) {
      for (let i = 0; i < REPS_PER_STATE; i++) {
        calls++
        let action: Action | null
        try {
          action = pickHard2Action(state)
        } catch (err) {
          crashes++
          if (sampleErrors.length < 5) {
            sampleErrors.push(err instanceof Error ? err.message : String(err))
          }
          continue
        }

        // A realistic mid-round state always has at least one legal action
        // (take-single / take-camels / sell / exchange).
        expect(action, 'pickHard2Action returned null for a state with legal actions').not.toBeNull()

        const result = applyAction(state, action as Action)
        expect(
          result.ok,
          `pickHard2Action returned an illegal action: ${JSON.stringify(action)}`,
        ).toBe(true)
      }
    }

    expect(
      crashes,
      `${crashes}/${calls} pickHard2Action call(s) threw. Sample errors: ${sampleErrors.join(' | ')}`,
    ).toBe(0)
  }, 30000)
})

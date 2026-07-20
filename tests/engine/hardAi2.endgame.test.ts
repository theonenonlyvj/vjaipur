import { describe, it, expect, vi, afterEach } from 'vitest'
import { pickHard2Action } from '../../src/ai/hardAi2'
import { setupRound, initialBonusPiles, applyAction, scoreRound } from '../../src/engine'
import type { GameState, Card, TokenPiles, PlayerState, Action } from '../../src/engine'

// ---------------------------------------------------------------------------
// 2026-07-20 "Hard II as the base" rework: hardAi2 (a FAIR determinization +
// alpha-beta bot — it only ever sees revealedHands + a fairified/reconstructed
// opponent hand, never the true hidden hand) becomes the active "Hard" tier.
// It already beat FairBot (the old "Hard") 82% head-to-head, but flubbed four
// specific endgame tactics benchmarked by hand-built fixtures. These tests
// pin those four scenarios down as regressions, plus a fairness guard and a
// speed guard for the new ~1500ms budget.
// ---------------------------------------------------------------------------

const FULL_TOKENS: TokenPiles = {
  diamond: [7, 7, 5, 5, 5],
  gold:    [6, 6, 5, 5, 5],
  silver:  [5, 5, 5, 5, 5],
  cloth:   [5, 3, 3, 2, 2, 1, 1],
  spice:   [5, 3, 3, 2, 2, 1, 1],
  leather: [4, 3, 2, 1, 1, 1, 1, 1, 1],
}

const PAD_DECK: Card[] = Array.from({ length: 20 }, (_, i) => ({
  id: 500 + i,
  type: (['leather', 'cloth', 'spice'] as const)[i % 3],
}))

function makeState(opts: {
  market: Card[]
  aiHand: Card[]
  oppHand?: Card[]
  tokens: TokenPiles
  aiHerd?: number
  oppHerd?: number
  aiTokens?: { good: Card['type']; value: number }[]
  oppTokens?: { good: Card['type']; value: number }[]
  deck?: Card[]
  revealedHands?: [number[], number[]]
}): GameState {
  const base = setupRound([0, 0], undefined, () => 0)
  const aiPlayer: PlayerState = {
    hand: opts.aiHand, herd: opts.aiHerd ?? 0,
    tokens: (opts.aiTokens as PlayerState['tokens']) ?? [], bonusTokens: [],
  }
  const oppPlayer: PlayerState = {
    hand: opts.oppHand ?? [], herd: opts.oppHerd ?? 0,
    tokens: (opts.oppTokens as PlayerState['tokens']) ?? [], bonusTokens: [],
  }
  return {
    ...base,
    activePlayer: 1, // hard2 is always seat 1 ("me") in these fixtures
    market: opts.market,
    deck: opts.deck ?? PAD_DECK,
    discard: [],
    revealedHands: opts.revealedHands ?? [[], []],
    players: [oppPlayer, aiPlayer],
    tokens: opts.tokens,
    bonusTokens: initialBonusPiles(() => 0),
  }
}

describe('hardAi2 endgame tactics', () => {
  it('A: sells now to LOCK a win when a legal sell would end the round while ahead', () => {
    // Selling 2 silver drains the only remaining silver token and depletes a
    // 3rd token pile (diamond and gold are already empty) -> instant round
    // end. AI is ahead 30-20 in realized tokens, so ending it now locks the
    // win instead of risking a comeback.
    const tokens: TokenPiles = { ...FULL_TOKENS, diamond: [], gold: [], silver: [5] }
    const state = makeState({
      market: [
        { id: 1, type: 'cloth' }, { id: 2, type: 'cloth' },
        { id: 3, type: 'spice' }, { id: 4, type: 'spice' },
        { id: 5, type: 'leather' },
      ],
      aiHand: [{ id: 6, type: 'silver' }, { id: 7, type: 'silver' }, { id: 8, type: 'leather' }, { id: 9, type: 'leather' }],
      oppHand: [{ id: 10, type: 'leather' }, { id: 11, type: 'cloth' }, { id: 12, type: 'spice' }],
      tokens,
      aiTokens: [{ good: 'cloth', value: 10 }, { good: 'cloth', value: 8 }, { good: 'leather', value: 7 }, { good: 'spice', value: 5 }],
      oppTokens: [{ good: 'leather', value: 10 }, { good: 'spice', value: 5 }, { good: 'spice', value: 5 }],
    })

    const action = pickHard2Action(state)
    expect(action).toMatchObject({ type: 'SELL', good: 'silver', quantity: 2 })

    // Sanity: confirm the fixture really does lock a win as described.
    const result = applyAction(state, action as Action)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.phase).toBe('round-end')
      expect(scoreRound(result.value).sealAwardedTo).toBe(1)
    }
  })

  it('B: avoids a round-ending sell that would LOCK a loss while behind', () => {
    // Same round-ending sell is available, but the AI is behind 15-30 — even
    // after selling (netting only 1 silver token, worth 5) it would still
    // lose 20-30. Locking the round shut denies any chance of a comeback, so
    // it should NOT sell silver here.
    const tokens: TokenPiles = { ...FULL_TOKENS, diamond: [], gold: [], silver: [5] }
    const state = makeState({
      market: [
        { id: 1, type: 'cloth' }, { id: 2, type: 'cloth' },
        { id: 3, type: 'spice' }, { id: 4, type: 'spice' },
        { id: 5, type: 'leather' },
      ],
      aiHand: [{ id: 6, type: 'silver' }, { id: 7, type: 'silver' }, { id: 8, type: 'leather' }, { id: 9, type: 'leather' }],
      oppHand: [{ id: 10, type: 'leather' }, { id: 11, type: 'cloth' }, { id: 12, type: 'spice' }],
      tokens,
      aiTokens: [{ good: 'leather', value: 10 }, { good: 'spice', value: 5 }],
      oppTokens: [{ good: 'cloth', value: 10 }, { good: 'cloth', value: 8 }, { good: 'leather', value: 7 }, { good: 'spice', value: 5 }],
    })

    const action = pickHard2Action(state)
    expect(action).not.toMatchObject({ type: 'SELL', good: 'silver' })
  })

  it('C: takes camels to flip a losing camel majority into a winning one, near round end', () => {
    // AI herd=5 < opp herd=6 (AI is currently losing the +/-5 majority swing).
    // Two camels sit in the market; taking both flips the herd to 7 > 6 — a
    // 10-point round-end swing. Herd counts are always public, so this is
    // fair information regardless of AI tier. diamond is depleted and gold is
    // down to 1 token (near round end by pile depletion) so the majority
    // won't have many more chances to flip back before scoring. leather/cloth
    // pile values are tanked to bare minimum (1s) so the competing move —
    // trading all 3 remaining camels away in an exchange for those goods —
    // is unambiguously the weaker play, not a genuine toss-up: with the
    // piles at their normal (FULL_TOKENS) values that exchange nets enough
    // real, immediately-cashable card value that a human could reasonably
    // defend either choice, which makes for a noisy/unreliable regression
    // test rather than a clean one. Deliberately NOT modeled via a tiny deck
    // (tried first): that destabilizes the search itself — deep plies start
    // hitting deck-exhaustion round-ends at unpredictable, hugely-weighted
    // (+/-10000) terminal evals that swamp everything else with search-order
    // noise, not signal. This mirrors the deliberate design choice in
    // hardAi2.ts: the camel-majority overlay is only weighted heavily near
    // round end — see hardAi2.ts's computeRootOverlay doc for the measured
    // reasoning (an ungated or always-large version of this bonus measurably
    // hurt hard2's general win rate by giving the deep search something to
    // over-optimize for).
    const state = makeState({
      market: [
        { id: 1, type: 'camel' }, { id: 2, type: 'camel' },
        { id: 3, type: 'leather' }, { id: 4, type: 'leather' },
        { id: 5, type: 'cloth' },
      ],
      aiHand: [{ id: 6, type: 'spice' }, { id: 7, type: 'leather' }],
      oppHand: [{ id: 10, type: 'leather' }, { id: 11, type: 'cloth' }, { id: 12, type: 'spice' }],
      tokens: {
        ...FULL_TOKENS,
        diamond: [], gold: [6],
        leather: [1, 1, 1, 1, 1, 1, 1, 1, 1],
        cloth: [1, 1, 1, 1, 1, 1, 1],
      },
      aiHerd: 5,
      oppHerd: 6,
      aiTokens: [{ good: 'cloth', value: 5 }],
      oppTokens: [{ good: 'cloth', value: 5 }],
    })

    const action = pickHard2Action(state)
    expect(action).toMatchObject({ type: 'TAKE_CAMELS' })
  })

  it('D: sells now when the opponent is KNOWN (via revealedHands) to hold enough of a nearly-depleted good', () => {
    // Only 2 gold tokens remain. AI holds 2 gold. revealedHands (engine-
    // maintained public state — a card's id is added the moment a player
    // takes it from market, and removed the moment they sell/exchange it
    // away) shows the opponent ALSO currently holds 2 gold they took from
    // the market earlier. Waiting hands them the tokens on their next turn.
    const tokens: TokenPiles = { ...FULL_TOKENS, gold: [6, 5] }
    const state = makeState({
      market: [
        { id: 1, type: 'cloth' }, { id: 2, type: 'leather' },
        { id: 3, type: 'spice' }, { id: 4, type: 'leather' },
        { id: 5, type: 'cloth' },
      ],
      aiHand: [{ id: 6, type: 'gold' }, { id: 7, type: 'gold' }, { id: 8, type: 'leather' }],
      oppHand: [{ id: 9, type: 'gold' }, { id: 10, type: 'gold' }],
      tokens,
      aiTokens: [{ good: 'cloth', value: 5 }],
      oppTokens: [{ good: 'cloth', value: 5 }],
      revealedHands: [[9, 10], []], // opponent (seat 0) publicly known to hold 2 gold
    })

    const action = pickHard2Action(state)
    expect(action).toMatchObject({ type: 'SELL', good: 'gold', quantity: 2 })
  })
})

describe('hardAi2 fairness: blind to the true hidden opponent hand', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('makes the identical decision regardless of the opponent\'s actual (hidden) hand contents', () => {
    // Two states, identical in every PUBLIC respect (market, tokens, my hand,
    // revealedHands=[] i.e. nothing about the opponent has ever been
    // revealed) but with wildly different real opponent hand contents: one
    // stacked with precious goods (a real threat if hard2 were peeking), one
    // full of near-worthless leather. hardAi2's fairifyState only ever reads
    // opp.hand.length (never its contents) when revealedHands is empty, so
    // the reconstructed "fair" opponent hand — and therefore the decision —
    // must be identical. Math.random is pinned so fairifyState's internal
    // shuffle() calls are deterministic and directly comparable across runs.
    const base = {
      market: [
        { id: 1, type: 'cloth' as const }, { id: 2, type: 'leather' as const },
        { id: 3, type: 'spice' as const }, { id: 4, type: 'leather' as const },
        { id: 5, type: 'diamond' as const },
      ],
      aiHand: [{ id: 6, type: 'diamond' as const }, { id: 7, type: 'leather' as const }],
      tokens: FULL_TOKENS,
    }
    const stateThreatening = makeState({
      ...base,
      oppHand: [{ id: 20, type: 'diamond' }, { id: 21, type: 'gold' }, { id: 22, type: 'silver' }],
    })
    const stateHarmless = makeState({
      ...base,
      oppHand: [{ id: 20, type: 'leather' }, { id: 21, type: 'leather' }, { id: 22, type: 'leather' }],
    })

    function fixedSequenceRandom(): () => number {
      let i = 0
      const seq = [0.11, 0.83, 0.42, 0.05, 0.67, 0.29, 0.91, 0.14, 0.58, 0.36, 0.72, 0.03]
      return () => {
        const v = seq[i % seq.length]
        i++
        return v
      }
    }

    const rngA = fixedSequenceRandom()
    vi.spyOn(Math, 'random').mockImplementation(rngA)
    const actionThreatening = pickHard2Action(stateThreatening)

    const rngB = fixedSequenceRandom()
    vi.spyOn(Math, 'random').mockImplementation(rngB)
    const actionHarmless = pickHard2Action(stateHarmless)

    expect(actionThreatening).toEqual(actionHarmless)
  })
})

describe('hardAi2 time budget', () => {
  it('never takes longer than ~1600ms even in a combinatorially large state', () => {
    // Large hand + full market + herd for exchange candidates + several
    // near-depleted piles (endgame urgency amplifies branching in the
    // sell-timing/round-lock overlays) — a worst-case-shaped position.
    const urgentTokens: TokenPiles = {
      diamond: [7], gold: [6, 5], silver: [5, 5],
      cloth: [5, 3, 3, 2, 2, 1, 1], spice: [5, 3], leather: [4, 3, 2],
    }
    const state = makeState({
      market: [
        { id: 1, type: 'diamond' }, { id: 2, type: 'gold' },
        { id: 3, type: 'silver' }, { id: 4, type: 'spice' },
        { id: 5, type: 'cloth' },
      ],
      aiHand: [
        { id: 10, type: 'diamond' }, { id: 11, type: 'gold' }, { id: 12, type: 'gold' },
        { id: 13, type: 'silver' }, { id: 14, type: 'cloth' }, { id: 15, type: 'spice' },
        { id: 16, type: 'leather' },
      ],
      oppHand: [
        { id: 20, type: 'silver' }, { id: 21, type: 'cloth' }, { id: 22, type: 'spice' },
        { id: 23, type: 'leather' }, { id: 24, type: 'leather' },
      ],
      tokens: urgentTokens,
      aiHerd: 4,
      oppHerd: 5,
      revealedHands: [[20, 21], [10]],
    })

    const REPS = 5
    let worst = 0
    for (let i = 0; i < REPS; i++) {
      const t0 = performance.now()
      pickHard2Action(state)
      const elapsed = performance.now() - t0
      if (elapsed > worst) worst = elapsed
    }
    expect(worst).toBeLessThan(1600)
  }, 15000)
})

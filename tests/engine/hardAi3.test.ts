import { describe, it, expect } from 'vitest'
import { pickHard3Action } from '../../src/ai/hardAi3'
import { setupRound, initialBonusPiles } from '../../src/engine/setup'
import type { GameState, Card, TokenPiles } from '../../src/engine/types'

// Pad deck — non-empty so checkRoundEnd doesn't fire prematurely on any single move.
const PAD_DECK: Card[] = [
  { id: 100, type: 'leather' }, { id: 101, type: 'leather' },
  { id: 102, type: 'cloth' },   { id: 103, type: 'cloth' },
  { id: 104, type: 'spice' },   { id: 105, type: 'spice' },
]

function makeState(
  market: Card[],
  aiHand: Card[],
  tokens: TokenPiles,
  oppHand: Card[] = [],
  aiHerd = 0,
  oppHerd = 0,
): GameState {
  const base = setupRound([0, 0], undefined, () => 0)
  return {
    ...base,
    activePlayer: 1,
    market,
    deck: PAD_DECK,
    players: [
      { ...base.players[0], hand: oppHand, herd: oppHerd },
      { ...base.players[1], hand: aiHand, herd: aiHerd },
    ],
    tokens,
    bonusTokens: initialBonusPiles(() => 0),
  }
}

// Full token piles — tokens are abundant, no urgency
const FULL_TOKENS: TokenPiles = {
  diamond: [7, 7, 5, 5, 5],
  gold:    [6, 6, 5, 5, 5],
  silver:  [5, 5, 5, 5, 5],
  cloth:   [5, 3, 3, 2, 2, 1, 1],
  spice:   [5, 3, 3, 2, 2, 1, 1],
  leather: [4, 3, 2, 1, 1, 1, 1, 1, 1],
}

describe('Hard III AI — critical decisions', () => {
  it('takes diamond to complete a pair rather than selling leather', () => {
    // The screenshot scenario: market has a diamond, AI already holds 1 diamond.
    // Taking it → can sell 2 diamonds (14 pts) next turn.
    // Selling 1 leather now yields 4 pts and hands the diamond to the opponent.
    const state = makeState(
      [
        { id: 1, type: 'cloth' },
        { id: 2, type: 'spice' },
        { id: 3, type: 'leather' },
        { id: 4, type: 'gold' },
        { id: 5, type: 'diamond' },
      ],
      [{ id: 6, type: 'diamond' }, { id: 7, type: 'leather' }],
      FULL_TOKENS,
    )

    const action = pickHard3Action(state)
    expect(action).toMatchObject({ type: 'TAKE_SINGLE', marketIndex: 4 })
  })

  it('sells diamonds urgently when token pile is nearly depleted', () => {
    // Only 2 diamond tokens remain (both 7s). Opponent also has 2 diamonds.
    // AI must sell NOW before the tokens run out. Waiting = losing the high-value tokens.
    const urgentTokens: TokenPiles = {
      ...FULL_TOKENS,
      diamond: [7, 7], // only 2 left — urgent
    }
    const state = makeState(
      [
        { id: 1, type: 'cloth' },
        { id: 2, type: 'leather' },
        { id: 3, type: 'spice' },
        { id: 4, type: 'gold' },
        { id: 5, type: 'leather' },
      ],
      [{ id: 6, type: 'diamond' }, { id: 7, type: 'diamond' }, { id: 8, type: 'leather' }],
      urgentTokens,
      [{ id: 9, type: 'diamond' }, { id: 10, type: 'diamond' }], // opponent can sell too!
    )

    const action = pickHard3Action(state)
    expect(action).toMatchObject({ type: 'SELL', good: 'diamond' })
  })

  it('sells all 5 diamonds for the bonus when token pile is nearly depleted and opponent races', () => {
    // Only 2 diamond tokens left (7+7). Opponent ALSO has 4 diamonds ready to sell.
    // AI must sell all 5 NOW: captures both remaining high tokens + bonus token.
    // Waiting even one turn lets the opponent drain the pile.
    const urgentTokens: TokenPiles = {
      ...FULL_TOKENS,
      diamond: [7, 7], // only 2 tokens left
    }
    const state = makeState(
      [
        { id: 1, type: 'cloth' },
        { id: 2, type: 'leather' },
        { id: 3, type: 'spice' },
        { id: 4, type: 'leather' },
        { id: 5, type: 'spice' },
      ],
      [
        { id: 6, type: 'diamond' },
        { id: 7, type: 'diamond' },
        { id: 8, type: 'diamond' },
        { id: 9, type: 'diamond' },
        { id: 10, type: 'diamond' },
      ],
      urgentTokens,
      // Opponent has 4 diamonds ready — will sell next turn if AI doesn't sell now
      [
        { id: 11, type: 'diamond' },
        { id: 12, type: 'diamond' },
        { id: 13, type: 'diamond' },
        { id: 14, type: 'diamond' },
      ],
    )

    const action = pickHard3Action(state)
    expect(action).toMatchObject({ type: 'SELL', good: 'diamond', quantity: 5 })
  })

  it('does not sell cheap goods when a precious good is available in market', () => {
    // Diamond in market, AI has 1 diamond. Selling cloth (5 pts) or leather (4 pts)
    // while giving the opponent a free precious card is a blunder.
    const state = makeState(
      [
        { id: 1, type: 'spice' },
        { id: 2, type: 'cloth' },
        { id: 3, type: 'gold' },
        { id: 4, type: 'spice' },
        { id: 5, type: 'diamond' },
      ],
      [
        { id: 6, type: 'diamond' },
        { id: 7, type: 'cloth' },
        { id: 8, type: 'cloth' },
        { id: 9, type: 'cloth' },
      ],
      FULL_TOKENS,
    )

    const action = pickHard3Action(state)
    expect(action).toMatchObject({ type: 'TAKE_SINGLE', marketIndex: 4 })
  })

  it('prefers taking diamond over taking a cheaper good when completing a pair', () => {
    // Market has gold, spice, cloth, leather, diamond.
    // AI has 1 diamond in hand — should grab the second diamond (forms 14-pt sell)
    // not take spice, cloth, or leather.
    const state = makeState(
      [
        { id: 1, type: 'gold' },
        { id: 2, type: 'spice' },
        { id: 3, type: 'cloth' },
        { id: 4, type: 'leather' },
        { id: 5, type: 'diamond' },
      ],
      [{ id: 6, type: 'diamond' }, { id: 7, type: 'spice' }],
      FULL_TOKENS,
    )

    const action = pickHard3Action(state)
    // Taking diamond (completing pair) or taking gold are both fine precious moves.
    // Taking cheaper goods (spice/cloth/leather) is not.
    const goodIdx = action?.type === 'TAKE_SINGLE' ? state.market[action.marketIndex].type : null
    const isPrecious = goodIdx === 'diamond' || goodIdx === 'gold'
    expect(isPrecious).toBe(true)
  })
})

import { describe, it, expect } from 'vitest'
import { pickEasyAction } from '../../src/ai/easyAi'
import { setupRound, applyAction, getLegalActions } from '../../src/engine'
import type { GameState } from '../../src/engine'

function freshState(): GameState {
  return setupRound([0, 0], undefined, () => 0.5)
}

describe('pickEasyAction', () => {
  it('always returns a legal action when actions are available', () => {
    const state = freshState()
    const action = pickEasyAction(state)
    expect(action).not.toBeNull()
    const legal = getLegalActions(state)
    expect(legal.some(a => JSON.stringify(a) === JSON.stringify(action))).toBe(true)
  })

  it('returns null when no legal actions (round-end phase)', () => {
    const state = { ...freshState(), phase: 'round-end' as const }
    expect(pickEasyAction(state)).toBeNull()
  })

  it('returned action produces a valid state', () => {
    const state = freshState()
    const action = pickEasyAction(state)!
    const result = applyAction(state, action)
    expect(result.ok).toBe(true)
  })

  it('prefers SELL over TAKE_SINGLE when player has diamonds to sell', () => {
    const base = freshState()
    // Put 2 diamonds directly in player 0 hand
    const fakeHand = [
      { id: 9000, type: 'diamond' as const },
      { id: 9001, type: 'diamond' as const },
    ]
    const state: GameState = {
      ...base,
      players: [{ ...base.players[0], hand: fakeHand }, base.players[1]],
    }
    const action = pickEasyAction(state)
    expect(action?.type).toBe('SELL')
    if (action?.type === 'SELL') expect(action.good).toBe('diamond')
  })

  it('prefers taking a higher-value good (diamond over leather) via TAKE_SINGLE', () => {
    const base = freshState()
    // Market with diamond at index 0 and leather at index 1 (non-camel), rest camels
    const market = [
      { id: 9002, type: 'diamond' as const },
      { id: 9003, type: 'leather' as const },
      { id: 9004, type: 'camel' as const },
      { id: 9005, type: 'camel' as const },
      { id: 9006, type: 'camel' as const },
    ]
    const state: GameState = {
      ...base,
      players: [{ ...base.players[0], hand: [] }, base.players[1]],
      market,
    }
    const action = pickEasyAction(state)
    expect(action?.type).toBe('TAKE_SINGLE')
    if (action?.type === 'TAKE_SINGLE') {
      expect(state.market[action.marketIndex].type).toBe('diamond')
    }
  })
})

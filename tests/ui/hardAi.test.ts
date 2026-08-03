import { describe, it, expect } from 'vitest'
import { mcts } from '../../src/ai/hardAi'
import { setupRound, applyAction } from '../../src/engine'
import type { GameState } from '../../src/engine'

function freshState(): GameState {
  return setupRound([0, 0], undefined, () => 0.5)
}

describe('mcts', () => {
  it('returns null when phase is not playing', () => {
    const state = { ...freshState(), phase: 'round-end' as const }
    expect(mcts(state, 50)).toBeNull()
  })

  it('returns a valid action within time limit', () => {
    const state = freshState()
    const p1state: GameState = { ...state, activePlayer: 1 }
    const action = mcts(p1state, 100)
    expect(action).not.toBeNull()
    const result = applyAction(p1state, action!)
    expect(result.ok).toBe(true)
  }, 5000)

  it('returns the only action when exactly one legal action exists', () => {
    const base = freshState()
    const state: GameState = {
      ...base,
      activePlayer: 1,
      players: [
        base.players[0],
        {
          ...base.players[1],
          hand: [{ id: 9100, type: 'leather' as const }],
          herd: 0,
        },
      ],
      market: [
        { id: 9101, type: 'camel' as const },
        { id: 9102, type: 'camel' as const },
        { id: 9103, type: 'camel' as const },
        { id: 9104, type: 'camel' as const },
        { id: 9105, type: 'camel' as const },
      ],
    }
    const action = mcts(state, 50)
    expect(action).not.toBeNull()
    const result = applyAction(state, action!)
    expect(result.ok).toBe(true)
  }, 5000)

  it('runs without error for 200ms and returns a valid action', () => {
    const state = { ...freshState(), activePlayer: 1 as const }
    const action = mcts(state, 200)
    expect(action).not.toBeNull()
    const result = applyAction(state, action!)
    expect(result.ok).toBe(true)
  }, 5000)
})

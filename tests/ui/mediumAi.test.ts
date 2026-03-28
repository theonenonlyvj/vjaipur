import { describe, it, expect } from 'vitest'
import { pickMediumAction, getProfitableExchanges } from '../../src/ai/mediumAi'
import { setupRound, applyAction, getLegalActions } from '../../src/engine'
import type { GameState } from '../../src/engine'

function freshState(): GameState {
  return setupRound([0, 0], undefined, () => 0.5)
}

describe('pickMediumAction', () => {
  it('returns a legal action for a fresh state', () => {
    const state = freshState()
    const action = pickMediumAction(state)
    expect(action).not.toBeNull()
    const result = applyAction(state, action!)
    expect(result.ok).toBe(true)
  })

  it('returns null when phase is not playing', () => {
    const state = { ...freshState(), phase: 'round-end' as const }
    expect(pickMediumAction(state)).toBeNull()
  })

  it('prefers selling diamonds (2) over taking a leather', () => {
    const base = freshState()
    const state: GameState = {
      ...base,
      players: [
        {
          ...base.players[0],
          hand: [
            { id: 9000, type: 'diamond' },
            { id: 9001, type: 'diamond' },
          ],
        },
        base.players[1],
      ],
      market: [
        { id: 9002, type: 'leather' },
        { id: 9003, type: 'camel' },
        { id: 9004, type: 'camel' },
        { id: 9005, type: 'camel' },
        { id: 9006, type: 'camel' },
      ],
    }
    const action = pickMediumAction(state)
    expect(action?.type).toBe('SELL')
    if (action?.type === 'SELL') expect(action.good).toBe('diamond')
  })

  it('prefers a profitable exchange when available', () => {
    const base = freshState()
    const state: GameState = {
      ...base,
      players: [
        {
          ...base.players[0],
          hand: [
            { id: 9010, type: 'leather' },
            { id: 9011, type: 'leather' },
          ],
          herd: 0,
        },
        base.players[1],
      ],
      market: [
        { id: 9012, type: 'diamond' },
        { id: 9013, type: 'diamond' },
        { id: 9014, type: 'camel' },
        { id: 9015, type: 'camel' },
        { id: 9016, type: 'camel' },
      ],
    }
    const action = pickMediumAction(state)
    expect(action?.type).toBe('TAKE_EXCHANGE')
    if (action?.type === 'TAKE_EXCHANGE') {
      const taken = action.marketIndices.map(i => state.market[i].type)
      expect(taken).toContain('diamond')
    }
  })
})

describe('getProfitableExchanges', () => {
  it('returns empty array when fewer than 2 market goods', () => {
    const base = freshState()
    const state: GameState = {
      ...base,
      market: [
        { id: 9020, type: 'diamond' },
        { id: 9021, type: 'camel' },
        { id: 9022, type: 'camel' },
        { id: 9023, type: 'camel' },
        { id: 9024, type: 'camel' },
      ],
    }
    expect(getProfitableExchanges(state)).toHaveLength(0)
  })

  it('returns no exchange when taking value ≤ giving value', () => {
    const base = freshState()
    const state: GameState = {
      ...base,
      players: [
        {
          ...base.players[0],
          hand: [
            { id: 9030, type: 'diamond' },
            { id: 9031, type: 'diamond' },
          ],
          herd: 0,
        },
        base.players[1],
      ],
      market: [
        { id: 9032, type: 'leather' },
        { id: 9033, type: 'leather' },
        { id: 9034, type: 'camel' },
        { id: 9035, type: 'camel' },
        { id: 9036, type: 'camel' },
      ],
    }
    expect(getProfitableExchanges(state)).toHaveLength(0)
  })
})

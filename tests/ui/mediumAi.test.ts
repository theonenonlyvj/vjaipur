import { describe, it, expect } from 'vitest'
import { pickMediumAction, getProfitableExchanges } from '../../src/ai/mediumAi'
import { setupRound, applyAction } from '../../src/engine'
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
            { id: 9000, type: 'diamond' as const },
            { id: 9001, type: 'diamond' as const },
          ],
        },
        base.players[1],
      ],
      market: [
        { id: 9002, type: 'leather' as const },
        { id: 9003, type: 'camel' as const },
        { id: 9004, type: 'camel' as const },
        { id: 9005, type: 'camel' as const },
        { id: 9006, type: 'camel' as const },
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
            { id: 9010, type: 'leather' as const },
            { id: 9011, type: 'leather' as const },
          ],
          herd: 0,
        },
        base.players[1],
      ],
      market: [
        { id: 9012, type: 'diamond' as const },
        { id: 9013, type: 'diamond' as const },
        { id: 9014, type: 'camel' as const },
        { id: 9015, type: 'camel' as const },
        { id: 9016, type: 'camel' as const },
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
        { id: 9020, type: 'diamond' as const },
        { id: 9021, type: 'camel' as const },
        { id: 9022, type: 'camel' as const },
        { id: 9023, type: 'camel' as const },
        { id: 9024, type: 'camel' as const },
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
            { id: 9030, type: 'diamond' as const },
            { id: 9031, type: 'diamond' as const },
          ],
          herd: 0,
        },
        base.players[1],
      ],
      market: [
        { id: 9032, type: 'leather' as const },
        { id: 9033, type: 'leather' as const },
        { id: 9034, type: 'camel' as const },
        { id: 9035, type: 'camel' as const },
        { id: 9036, type: 'camel' as const },
      ],
    }
    expect(getProfitableExchanges(state)).toHaveLength(0)
  })

  it('generates Option B (1 hand good + 1 camel) when player has camel and hand ≤ 6', () => {
    const base = freshState()
    // Player has 1 leather in hand + camels; market has 2 diamonds (high value)
    const state: GameState = {
      ...base,
      players: [
        {
          ...base.players[0],
          hand: [{ id: 9040, type: 'leather' as const }],
          herd: 2,
        },
        base.players[1],
      ],
      market: [
        { id: 9041, type: 'diamond' as const },
        { id: 9042, type: 'diamond' as const },
        { id: 9043, type: 'camel' as const },
        { id: 9044, type: 'camel' as const },
        { id: 9045, type: 'camel' as const },
      ],
    }
    const exchanges = getProfitableExchanges(state)
    // Should include an exchange with handIndices containing -1
    const hasCamelExchange = exchanges.some(a =>
      a.type === 'TAKE_EXCHANGE' && a.handIndices.includes(-1)
    )
    expect(hasCamelExchange).toBe(true)
  })

  it('generates Option C (2 camels) when player has ≥2 camels and hand ≤ 5', () => {
    const base = freshState()
    // Player has empty hand + 3 camels; market has 2 diamonds
    const state: GameState = {
      ...base,
      players: [
        {
          ...base.players[0],
          hand: [],
          herd: 3,
        },
        base.players[1],
      ],
      market: [
        { id: 9050, type: 'diamond' as const },
        { id: 9051, type: 'diamond' as const },
        { id: 9052, type: 'camel' as const },
        { id: 9053, type: 'camel' as const },
        { id: 9054, type: 'camel' as const },
      ],
    }
    const exchanges = getProfitableExchanges(state)
    // Should include exchange giving 2 camels (handIndices = [-1, -1])
    const hasTwoCamelExchange = exchanges.some(a =>
      a.type === 'TAKE_EXCHANGE' &&
      a.handIndices.filter(i => i === -1).length === 2
    )
    expect(hasTwoCamelExchange).toBe(true)
  })
})

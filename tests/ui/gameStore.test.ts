import { describe, it, expect, beforeEach } from 'vitest'
import { useGameStore } from '../../src/store/gameStore'

beforeEach(() => {
  useGameStore.setState({ state: null, mode: null, error: null })
})

describe('startGame', () => {
  it('creates a valid playing state with 5 market cards', () => {
    useGameStore.getState().startGame('vs-ai')
    const { state } = useGameStore.getState()
    expect(state).not.toBeNull()
    expect(state!.phase).toBe('playing')
    expect(state!.market).toHaveLength(5)
  })

  it('sets mode correctly', () => {
    useGameStore.getState().startGame('local')
    expect(useGameStore.getState().mode).toBe('local')
  })

  it('initialises seals to [0, 0]', () => {
    useGameStore.getState().startGame('local')
    expect(useGameStore.getState().state!.seals).toEqual([0, 0])
  })
})

describe('dispatch', () => {
  it('does nothing when state is null', () => {
    useGameStore.getState().dispatch({ type: 'TAKE_CAMELS' })
    expect(useGameStore.getState().state).toBeNull()
  })

  it('stores engine error for invalid action', () => {
    useGameStore.getState().startGame('local')
    // SELL quantity 0 is always invalid
    useGameStore.getState().dispatch({ type: 'SELL', good: 'diamond', quantity: 0 })
    expect(useGameStore.getState().error).not.toBeNull()
    expect(useGameStore.getState().error!.code).toBe('SELL_NONE')
  })

  it('advances state on valid action', () => {
    useGameStore.getState().startGame('local')
    const before = useGameStore.getState().state!
    // Market always starts with 3 camels, so TAKE_CAMELS is always valid
    useGameStore.getState().dispatch({ type: 'TAKE_CAMELS' })
    const after = useGameStore.getState().state!
    expect(after.activePlayer).toBe(1)
    expect(after).not.toBe(before)
  })

  it('clears error on next valid action', () => {
    useGameStore.getState().startGame('local')
    useGameStore.getState().dispatch({ type: 'SELL', good: 'diamond', quantity: 0 })
    expect(useGameStore.getState().error).not.toBeNull()
    useGameStore.getState().dispatch({ type: 'TAKE_CAMELS' })
    expect(useGameStore.getState().error).toBeNull()
  })
})

describe('vs-ai: AI fires after human move', () => {
  it('after human move, AI takes its turn so activePlayer returns to 0', () => {
    useGameStore.getState().startGame('vs-ai')
    useGameStore.getState().dispatch({ type: 'TAKE_CAMELS' })
    const after = useGameStore.getState().state!
    // Human (0) moved, AI (1) responded synchronously, so it's human's turn again
    expect(after.activePlayer).toBe(0)
  })
})

describe('nextRound', () => {
  it('does nothing when phase is playing', () => {
    useGameStore.getState().startGame('local')
    useGameStore.getState().nextRound()
    expect(useGameStore.getState().state!.phase).toBe('playing')
  })
})

describe('clearError', () => {
  it('sets error to null', () => {
    useGameStore.setState({ error: { code: 'X', message: 'test' } })
    useGameStore.getState().clearError()
    expect(useGameStore.getState().error).toBeNull()
  })
})

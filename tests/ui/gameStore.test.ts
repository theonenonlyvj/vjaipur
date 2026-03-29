import { describe, it, expect, beforeEach } from 'vitest'
import { useGameStore } from '../../src/store/gameStore'
import { getLegalActions } from '../../src/engine'
import type { Action } from '../../src/engine'
import { setWorkerBridge, WorkerBridge } from '../../src/ai/workerBridge'

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

describe('difficulty', () => {
  it('defaults to easy', () => {
    expect(useGameStore.getState().difficulty).toBe('easy')
  })

  it('setDifficulty updates the difficulty field', () => {
    useGameStore.getState().setDifficulty('medium')
    expect(useGameStore.getState().difficulty).toBe('medium')
    useGameStore.getState().setDifficulty('easy')
  })
})

describe('aiThinking', () => {
  beforeEach(() => {
    useGameStore.setState({ difficulty: 'easy', aiThinking: false })
    useGameStore.getState().startGame('vs-ai')
  })

  it('is false by default', () => {
    expect(useGameStore.getState().aiThinking).toBe(false)
  })

  it('stays false after a player action in easy mode', () => {
    const state = useGameStore.getState().state!
    const actions = getLegalActions(state)
    useGameStore.getState().dispatch(actions[0])
    expect(useGameStore.getState().aiThinking).toBe(false)
  })

  it('becomes true then resolves false when hard AI processes a turn', async () => {
    useGameStore.setState({ difficulty: 'hard', aiThinking: false })
    useGameStore.getState().startGame('vs-ai')

    let resolveWorker!: (action: Action | null) => void
    const mockBridge = new WorkerBridge(() => { throw new Error('not used') })
    mockBridge.getAction = (_state) =>
      new Promise<Action | null>(res => { resolveWorker = res })
    setWorkerBridge(mockBridge)

    const state = useGameStore.getState().state!
    const actions = getLegalActions(state)
    useGameStore.getState().dispatch(actions[0])

    expect(useGameStore.getState().aiThinking).toBe(true)

    resolveWorker({ type: 'TAKE_CAMELS' })
    await new Promise(r => setTimeout(r, 0))

    expect(useGameStore.getState().aiThinking).toBe(false)
    setWorkerBridge(null)
  })
})

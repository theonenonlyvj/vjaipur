import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useGameStore } from '../../src/store/gameStore'
import { getLegalActions } from '../../src/engine'
import type { Action } from '../../src/engine'
import { setWorkerBridge, WorkerBridge } from '../../src/ai/workerBridge'

// Fix 3 needs to force the medium-AI fallback (used inside runAi's worker
// .catch()) to throw on demand, while leaving it real for every other test.
vi.mock('../../src/ai/mediumAi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/ai/mediumAi')>()
  return { ...actual, pickMediumAction: vi.fn(actual.pickMediumAction) }
})
import { pickMediumAction } from '../../src/ai/mediumAi'

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

  // FIX 3: the worker .then/.catch chain had no terminal .catch(), so if the
  // synchronous medium-AI fallback ALSO threw (a second failure), the
  // resulting rejected promise had nothing downstream to reset aiThinking —
  // "AI is thinking..." would hang forever with no recovery.
  it('recovers aiThinking to false when both the worker AND the medium-AI fallback fail (no permanent stall)', async () => {
    useGameStore.setState({ difficulty: 'hard', aiThinking: false })
    useGameStore.getState().startGame('vs-ai')

    const mockBridge = new WorkerBridge(() => { throw new Error('not used') })
    mockBridge.getAction = () => Promise.reject(new Error('worker crashed'))
    setWorkerBridge(mockBridge)
    vi.mocked(pickMediumAction).mockImplementationOnce(() => { throw new Error('fallback crashed') })

    const state = useGameStore.getState().state!
    const actions = getLegalActions(state)
    useGameStore.getState().dispatch(actions[0])

    expect(useGameStore.getState().aiThinking).toBe(true)

    // Flush the rejected promise chain: getAction() rejects -> the .catch's
    // pickMediumAction fallback throws -> a terminal .catch must still
    // resolve aiThinking back to false instead of leaving it stuck forever.
    await new Promise(r => setTimeout(r, 0))
    await new Promise(r => setTimeout(r, 0))

    expect(useGameStore.getState().aiThinking).toBe(false)
    setWorkerBridge(null)
  })
})

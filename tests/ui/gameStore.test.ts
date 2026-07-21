import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useGameStore } from '../../src/store/gameStore'
import { getLegalActions } from '../../src/engine'
import type { Action } from '../../src/engine'
import {
  setWorkerBridge,
  setWorkerBridge2,
  setWorkerBridge3,
  setFairBotWorkerBridge,
  setIsmctsWorkerBridge,
  WorkerBridge,
} from '../../src/ai/workerBridge'

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

// Tier-lineup rework (2026-07-20): 'Hard' in the picker is now the hardAi2
// engine (id 'hard2' — it already existed as a routed engine id, previously
// labeled "Hard II (Classic)" and off the picker; the rework gave it endgame
// tactics + a tightened budget and promoted it to the active "Hard", retiring
// fairBot/'fair') and 'Omniscient Bot' is still hardAi3 ('hard3'). These
// tests pin down that each difficulty id talks to its OWN worker bridge and
// no other, so a mislabeled routing change can't silently swap engines.
describe('AI tier routing: engine id -> worker bridge', () => {
  afterEach(() => {
    setWorkerBridge(null)
    setWorkerBridge2(null)
    setWorkerBridge3(null)
    setFairBotWorkerBridge(null)
    setIsmctsWorkerBridge(null)
  })

  function trackingBridge(name: string, calls: string[]): WorkerBridge {
    const bridge = new WorkerBridge(() => { throw new Error('not used') })
    bridge.getAction = () => {
      calls.push(name)
      return Promise.resolve({ type: 'TAKE_CAMELS' } as Action)
    }
    return bridge
  }

  it("difficulty 'hard2' (picker label \"Hard\") routes to worker bridge 2 only", async () => {
    const calls: string[] = []
    setWorkerBridge(trackingBridge('hard', calls))
    setWorkerBridge2(trackingBridge('hard2', calls))
    setWorkerBridge3(trackingBridge('hard3', calls))
    setFairBotWorkerBridge(trackingBridge('fair', calls))
    setIsmctsWorkerBridge(trackingBridge('ismcts', calls))

    useGameStore.setState({ difficulty: 'hard2', aiThinking: false })
    useGameStore.getState().startGame('vs-ai')

    const state = useGameStore.getState().state!
    const actions = getLegalActions(state)
    useGameStore.getState().dispatch(actions[0])
    await new Promise((r) => setTimeout(r, 0))

    expect(calls).toEqual(['hard2'])
  })

  it("difficulty 'ismcts' (picker label \"Hard (ISMCTS)\") routes to the ismcts worker bridge only", async () => {
    const calls: string[] = []
    setWorkerBridge(trackingBridge('hard', calls))
    setWorkerBridge2(trackingBridge('hard2', calls))
    setWorkerBridge3(trackingBridge('hard3', calls))
    setFairBotWorkerBridge(trackingBridge('fair', calls))
    setIsmctsWorkerBridge(trackingBridge('ismcts', calls))

    useGameStore.setState({ difficulty: 'ismcts', aiThinking: false })
    useGameStore.getState().startGame('vs-ai')

    const state = useGameStore.getState().state!
    const actions = getLegalActions(state)
    useGameStore.getState().dispatch(actions[0])
    await new Promise((r) => setTimeout(r, 0))

    expect(calls).toEqual(['ismcts'])
  })

  it("retired difficulty 'fair' (formerly picker label \"Hard\") still routes to the fairBot worker bridge only", async () => {
    const calls: string[] = []
    setWorkerBridge(trackingBridge('hard', calls))
    setWorkerBridge2(trackingBridge('hard2', calls))
    setWorkerBridge3(trackingBridge('hard3', calls))
    setFairBotWorkerBridge(trackingBridge('fair', calls))

    useGameStore.setState({ difficulty: 'fair', aiThinking: false })
    useGameStore.getState().startGame('vs-ai')

    const state = useGameStore.getState().state!
    const actions = getLegalActions(state)
    useGameStore.getState().dispatch(actions[0])
    await new Promise((r) => setTimeout(r, 0))

    expect(calls).toEqual(['fair'])
  })

  it("difficulty 'hard3' (picker label \"Omniscient Bot\") routes to worker bridge 3 only", async () => {
    const calls: string[] = []
    setWorkerBridge(trackingBridge('hard', calls))
    setWorkerBridge2(trackingBridge('hard2', calls))
    setWorkerBridge3(trackingBridge('hard3', calls))
    setFairBotWorkerBridge(trackingBridge('fair', calls))

    useGameStore.setState({ difficulty: 'hard3', aiThinking: false })
    useGameStore.getState().startGame('vs-ai')

    const state = useGameStore.getState().state!
    const actions = getLegalActions(state)
    useGameStore.getState().dispatch(actions[0])
    await new Promise((r) => setTimeout(r, 0))

    expect(calls).toEqual(['hard3'])
  })

  it("retired difficulty 'hard' still routes to worker bridge 1 (engine untouched, just off the picker)", async () => {
    const calls: string[] = []
    setWorkerBridge(trackingBridge('hard', calls))
    setWorkerBridge2(trackingBridge('hard2', calls))
    setWorkerBridge3(trackingBridge('hard3', calls))
    setFairBotWorkerBridge(trackingBridge('fair', calls))

    useGameStore.setState({ difficulty: 'hard', aiThinking: false })
    useGameStore.getState().startGame('vs-ai')

    const state = useGameStore.getState().state!
    const actions = getLegalActions(state)
    useGameStore.getState().dispatch(actions[0])
    await new Promise((r) => setTimeout(r, 0))

    expect(calls).toEqual(['hard'])
  })

  it("new vs-ai matches store the STABLE engine id, not a display label", () => {
    useGameStore.setState({ difficulty: 'fair' })
    expect(useGameStore.getState().difficulty).toBe('fair')
    expect(useGameStore.getState().difficulty).not.toBe('Hard')

    useGameStore.setState({ difficulty: 'hard3' })
    expect(useGameStore.getState().difficulty).toBe('hard3')
    expect(useGameStore.getState().difficulty).not.toBe('Omniscient Bot')
  })
})

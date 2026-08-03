import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useGameStore } from '../../src/store/gameStore'
import { useStatsStore } from '../../src/store/statsStore'
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

// The vs-ai match-end test below needs a CONTROLLED round outcome (a
// specific seal winner + score) without hand-building a fully-scoreable
// GameState (real tokens/bonusTokens/herd) — wraps the real scoreRound so
// every other test keeps its real scoring behavior, while that one test can
// mockReturnValueOnce a decisive result.
vi.mock('../../src/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine')>()
  return { ...actual, scoreRound: vi.fn(actual.scoreRound) }
})
import { scoreRound } from '../../src/engine'

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

  // Owner's 2026-07-28 GAMES-first ruling — a vs-ai match's own final `seals`
  // IS its exact per-game split (a seal = one game/round won); nextRound must
  // pass it straight through to addMatch as games_won/games_lost.
  describe('vs-ai match end: games_won/games_lost split', () => {
    afterEach(() => {
      vi.mocked(scoreRound).mockRestore()
      // This describe block is the only place in the file that mutates
      // difficulty/matchLength/matchScores directly via setState (every
      // other test either leaves them at their defaults or restores them
      // itself, e.g. the 'difficulty' describe below) — restore them so a
      // later test (like "difficulty > defaults to easy") never sees this
      // block's leftovers. The top-level beforeEach only resets
      // state/mode/error.
      useGameStore.setState({ difficulty: 'easy', matchLength: 1, matchScores: [0, 0] })
    })

    it('passes the match\'s final seals as the exact games_won/games_lost split to addMatch', () => {
      useGameStore.getState().startGame('vs-ai')
      const baseState = useGameStore.getState().state!
      useGameStore.setState({
        matchLength: 3, // sealsNeeded = 2
        difficulty: 'medium',
        matchScores: [50, 40],
        state: { ...baseState, phase: 'round-end', seals: [1, 1] },
      })
      // Seat 0 (the human) takes this round's seal -> newSeals [2, 1], which
      // clears sealsNeeded(2) -> match over.
      vi.mocked(scoreRound).mockReturnValueOnce({ camelWinner: null, scores: [30, 20], bonusTokenCounts: [0, 0], sealAwardedTo: 0 })
      const addMatchSpy = vi.spyOn(useStatsStore.getState(), 'addMatch').mockResolvedValue(undefined)

      useGameStore.getState().nextRound()

      expect(useGameStore.getState().state!.phase).toBe('game-over')
      expect(useGameStore.getState().state!.seals).toEqual([2, 1])
      expect(addMatchSpy).toHaveBeenCalledWith(
        { opponent_type: 'medium', player_score: 80, opponent_score: 60, won: true, games_won: 2, games_lost: 1 },
        [],
      )
    })

    it('a losing final split (opponent seals > mine) reports won:false with the matching games_lost > games_won', () => {
      useGameStore.getState().startGame('vs-ai')
      const baseState = useGameStore.getState().state!
      useGameStore.setState({
        matchLength: 5, // sealsNeeded = 3
        difficulty: 'hard2',
        matchScores: [10, 10],
        state: { ...baseState, phase: 'round-end', seals: [1, 2] },
      })
      // Seat 1 (the AI) takes this round's seal -> newSeals [1, 3], clearing
      // sealsNeeded(3) -> match over, a LOSS for the human.
      vi.mocked(scoreRound).mockReturnValueOnce({ camelWinner: null, scores: [15, 25], bonusTokenCounts: [0, 0], sealAwardedTo: 1 })
      const addMatchSpy = vi.spyOn(useStatsStore.getState(), 'addMatch').mockResolvedValue(undefined)

      useGameStore.getState().nextRound()

      expect(useGameStore.getState().state!.seals).toEqual([1, 3])
      expect(addMatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({ opponent_type: 'hard2', won: false, games_won: 1, games_lost: 3 }),
        [],
      )
    })
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

  // BUG 3 (2026-08-03): a bot move computed for an ABANDONED game (user
  // backed out mid-think and started a fresh one) must never apply to the
  // fresh game, and must never clobber the fresh game's own aiThinking.
  describe('gameEpoch stale-move guard', () => {
    it('discards a stale AI resolution from an abandoned game — the new game\'s state/aiThinking are untouched', async () => {
      useGameStore.setState({ difficulty: 'hard', aiThinking: false })
      useGameStore.getState().startGame('vs-ai')

      let resolveWorker!: (action: Action | null) => void
      const mockBridge = new WorkerBridge(() => { throw new Error('not used') })
      mockBridge.getAction = (_state) => new Promise<Action | null>(res => { resolveWorker = res })
      setWorkerBridge(mockBridge)

      const oldState = useGameStore.getState().state!
      const actions = getLegalActions(oldState)
      useGameStore.getState().dispatch(actions[0]) // triggers runAi against `oldState`'s result, epoch E0

      expect(useGameStore.getState().aiThinking).toBe(true)

      // The player backs out and starts a FRESH game (bumps gameEpoch) while
      // the old worker call is still pending.
      useGameStore.getState().startGame('vs-ai')
      const freshState = useGameStore.getState().state!
      expect(useGameStore.getState().aiThinking).toBe(false)

      // The stale worker call now resolves.
      resolveWorker({ type: 'TAKE_CAMELS' })
      await new Promise(r => setTimeout(r, 0))
      await new Promise(r => setTimeout(r, 0))

      // The fresh game must be completely unaffected: same state reference,
      // aiThinking still false (never flipped true then back by the stale
      // resolution's own set() calls).
      expect(useGameStore.getState().state).toBe(freshState)
      expect(useGameStore.getState().aiThinking).toBe(false)
      setWorkerBridge(null)
    })

    it('a matching-epoch resolution still applies normally (no regression)', async () => {
      useGameStore.setState({ difficulty: 'hard', aiThinking: false })
      useGameStore.getState().startGame('vs-ai')

      let resolveWorker!: (action: Action | null) => void
      const mockBridge = new WorkerBridge(() => { throw new Error('not used') })
      mockBridge.getAction = (_state) => new Promise<Action | null>(res => { resolveWorker = res })
      setWorkerBridge(mockBridge)

      const state = useGameStore.getState().state!
      const actions = getLegalActions(state)
      useGameStore.getState().dispatch(actions[0])

      resolveWorker({ type: 'TAKE_CAMELS' })
      await new Promise(r => setTimeout(r, 0))

      expect(useGameStore.getState().aiThinking).toBe(false)
      expect(useGameStore.getState().state!.activePlayer).toBe(0) // AI moved, turn is back to the human
      setWorkerBridge(null)
    })

    it('discards a stale resolution on the error-fallback path too (both the worker AND medium-AI fail, but for an abandoned game)', async () => {
      useGameStore.setState({ difficulty: 'hard', aiThinking: false })
      useGameStore.getState().startGame('vs-ai')

      const mockBridge = new WorkerBridge(() => { throw new Error('not used') })
      let rejectWorker!: (e: Error) => void
      mockBridge.getAction = () => new Promise<Action | null>((_res, rej) => { rejectWorker = rej })
      setWorkerBridge(mockBridge)
      vi.mocked(pickMediumAction).mockImplementationOnce(() => { throw new Error('fallback crashed') })

      const state = useGameStore.getState().state!
      const actions = getLegalActions(state)
      useGameStore.getState().dispatch(actions[0])
      expect(useGameStore.getState().aiThinking).toBe(true)

      useGameStore.getState().startGame('vs-ai') // abandon mid-think
      const freshState = useGameStore.getState().state!
      expect(useGameStore.getState().aiThinking).toBe(false)

      rejectWorker(new Error('worker crashed'))
      await new Promise(r => setTimeout(r, 0))
      await new Promise(r => setTimeout(r, 0))
      await new Promise(r => setTimeout(r, 0))

      expect(useGameStore.getState().state).toBe(freshState)
      expect(useGameStore.getState().aiThinking).toBe(false)
      setWorkerBridge(null)
    })
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

// Per-move GAME LOGGING for local vs-AI matches (src/store/aiGameLog.ts) —
// captures the play-by-play so AI-tuning can analyze real human-vs-bot games.
describe('aiGameLog', () => {
  afterEach(() => {
    setIsmctsWorkerBridge(null)
  })

  it('is empty before any match starts', () => {
    useGameStore.setState({ state: null, mode: null, aiGameLog: [] })
    expect(useGameStore.getState().aiGameLog).toEqual([])
  })

  it('resets to empty on every startGame call, including a fresh vs-ai match after a prior one logged moves', () => {
    useGameStore.setState({ difficulty: 'easy' })
    useGameStore.getState().startGame('vs-ai')
    const state = useGameStore.getState().state!
    useGameStore.getState().dispatch(getLegalActions(state)[0])
    expect(useGameStore.getState().aiGameLog.length).toBeGreaterThan(0)

    useGameStore.getState().startGame('vs-ai')
    expect(useGameStore.getState().aiGameLog).toEqual([])
  })

  it('does NOT log moves in local mode (no AI opponent)', () => {
    useGameStore.setState({ difficulty: 'easy' })
    useGameStore.getState().startGame('local')
    const state = useGameStore.getState().state!
    useGameStore.getState().dispatch(getLegalActions(state)[0])
    expect(useGameStore.getState().aiGameLog).toEqual([])
  })

  it('logs the human dispatch AND the AI applied action, in order, with ply/round/tier/action captured (sync tier — no worker)', () => {
    useGameStore.setState({ difficulty: 'easy' })
    useGameStore.getState().startGame('vs-ai')
    const before = useGameStore.getState().state!
    const humanAction = getLegalActions(before)[0]

    useGameStore.getState().dispatch(humanAction)

    const log = useGameStore.getState().aiGameLog
    expect(log).toHaveLength(2) // human's move, then the AI's reply

    expect(log[0]).toMatchObject({ ply: 1, round: before.round, actor: 'human', tier: 'easy', action: humanAction })
    expect(log[1]).toMatchObject({ ply: 2, round: before.round, actor: 'ai', tier: 'easy' })

    // preState is the COMPACT (types-only, id-free) snapshot, matching the
    // state the mover actually saw — not the post-move state.
    expect(log[0].preState.h0).toHaveLength(before.players[0].hand.length)
    expect(log[0].preState.h1).toHaveLength(before.players[1].hand.length)
    expect(log[0].preState.mkt).toEqual(before.market.map((c) => c.type))
    expect(JSON.stringify(log[0].preState)).not.toMatch(/"id"/)
  })

  it('routes tier + candidates diagnostics through for the ismcts worker bridge, without altering which action is applied', async () => {
    useGameStore.setState({ difficulty: 'ismcts', aiThinking: false })
    useGameStore.getState().startGame('vs-ai')

    const chosenAction: Action = { type: 'TAKE_CAMELS' }
    const candidates = [
      { action: 'TC', visits: 42, q: 0.31 },
      { action: 'TS:0', visits: 10, q: 0.1 },
    ]
    const mockBridge = new WorkerBridge(() => { throw new Error('not used') })
    mockBridge.getAction = (_data) => {
      mockBridge.lastDebug = { candidates }
      return Promise.resolve(chosenAction)
    }
    setIsmctsWorkerBridge(mockBridge)

    const before = useGameStore.getState().state!
    useGameStore.getState().dispatch(getLegalActions(before)[0])
    // Poll rather than trust a single setTimeout(0) tick — the runAi promise
    // chain is several .then/.catch links deep, and a single fixed-delay
    // macrotask can occasionally get squeezed out under heavy parallel test
    // load. vi.waitFor retries the assertion until it holds (or times out).
    await vi.waitFor(() => {
      expect(useGameStore.getState().aiGameLog.length).toBe(2)
    })

    const log = useGameStore.getState().aiGameLog
    const aiEntry = log[log.length - 1]
    expect(aiEntry.actor).toBe('ai')
    expect(aiEntry.tier).toBe('ismcts')
    expect(aiEntry.action).toEqual(chosenAction)
    expect(aiEntry.candidates).toEqual(candidates)
  })

  it('omits `candidates` entirely for a non-ismcts worker tier (e.g. hard2)', async () => {
    useGameStore.setState({ difficulty: 'hard2', aiThinking: false })
    useGameStore.getState().startGame('vs-ai')

    const mockBridge = new WorkerBridge(() => { throw new Error('not used') })
    mockBridge.getAction = () => Promise.resolve({ type: 'TAKE_CAMELS' } as Action)
    setWorkerBridge2(mockBridge)

    const before = useGameStore.getState().state!
    useGameStore.getState().dispatch(getLegalActions(before)[0])
    await vi.waitFor(() => {
      expect(useGameStore.getState().aiGameLog.length).toBe(2)
    })

    const log = useGameStore.getState().aiGameLog
    const aiEntry = log[log.length - 1]
    expect(aiEntry.actor).toBe('ai')
    expect(aiEntry.candidates).toBeUndefined()
    setWorkerBridge2(null)
  })

  it('caps the log at AI_LOG_MAX_ENTRIES total entries (trims oldest first) over a long synthetic run', () => {
    useGameStore.setState({ difficulty: 'easy' })
    useGameStore.getState().startGame('vs-ai')
    // Directly seed a log at the cap via setState (cheaper/deterministic than
    // playing 600 real plies) and confirm one more real append still trims —
    // proving the store's appendAiLogEntry path honors appendCapped rather
    // than growing the array unbounded.
    const bulky = Array.from({ length: 600 }, (_, i) => ({
      ply: i + 1,
      round: 1,
      actor: 'human' as const,
      tier: 'easy' as const,
      action: { type: 'TAKE_CAMELS' as const },
      preState: { mkt: [], h0: [], h1: [], herd: [0, 0] as [number, number], deck: 0, tok: [], bonus: [0, 0, 0] as [number, number, number], score: [0, 0] as [number, number], seals: [0, 0] as [number, number] },
    }))
    useGameStore.setState({ aiGameLog: bulky })

    const before = useGameStore.getState().state!
    useGameStore.getState().dispatch(getLegalActions(before)[0])

    const log = useGameStore.getState().aiGameLog
    expect(log.length).toBe(600)
    expect(log[0].ply).toBe(3) // oldest 2 dropped (human's + AI's new entries pushed the window forward)
    expect(log[log.length - 1].ply).toBe(602)
  })
})

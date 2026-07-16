import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../src/socket/socketService', () => ({
  socketService: {
    connected: true,
    connect: vi.fn(),
    disconnect: vi.fn(),
    sendAction: vi.fn(),
    sendNextRound: vi.fn(),
    rejoin: vi.fn().mockResolvedValue(undefined),
    createRoom: vi.fn().mockResolvedValue('CAML99'),
    joinRoom: vi.fn().mockResolvedValue({ playerIndex: 1 }),
    quickMatch: vi.fn(),
    sendName: vi.fn(),
    onRoomReady: null,
    onOpponentAction: null,
    onRoundStart: null,
    onOpponentDisconnected: null,
    onOpponentReconnected: null,
    onForfeit: null,
    onConnect: null,
    onSelfDisconnected: null,
    onReconnectFailed: null,
  },
}))

import { useGameStore } from '../../src/store/gameStore'
import { socketService } from '../../src/socket/socketService'
import { useStatsStore } from '../../src/store/statsStore'
import { setupRound } from '../../src/engine'

beforeEach(() => {
  vi.clearAllMocks()
  ;(socketService as any).connected = true
  useGameStore.setState({
    state: null, mode: null, error: null,
    onlinePlayerIndex: null, roomCode: null, onlineStatus: 'idle',
  })
})

describe('gameStore online mode', () => {
  it('setOnlineStatus updates onlineStatus', () => {
    useGameStore.getState().setOnlineStatus('waiting')
    expect(useGameStore.getState().onlineStatus).toBe('waiting')
  })

  it('dispatch in online mode sends action to socket when it is our turn', () => {
    const base = setupRound([0, 0])
    // Find camel index or construct a state where we know TAKE_CAMELS is valid
    const camelIdx = base.market.findIndex(c => c.type === 'camel')
    const action = { type: 'TAKE_CAMELS' as const }
    if (camelIdx === -1) {
      // Force a camel into market slot 0 for a known-good test
      const stateWithCamel = {
        ...base,
        market: [{ id: 999, type: 'camel' as const }, ...base.market.slice(1)],
      }
      useGameStore.setState({ state: stateWithCamel, mode: 'online', onlinePlayerIndex: 0 })
      useGameStore.getState().dispatch(action)
    } else {
      useGameStore.setState({ state: base, mode: 'online', onlinePlayerIndex: 0 })
      useGameStore.getState().dispatch(action)
    }
    expect(socketService.sendAction).toHaveBeenCalledWith(action, expect.any(Object))
  })

  it('dispatch in online mode does nothing when it is not our turn', () => {
    const state = setupRound([0, 0])
    // activePlayer starts at 0; we are player 1
    useGameStore.setState({ state, mode: 'online', onlinePlayerIndex: 1 })
    useGameStore.getState().dispatch({ type: 'TAKE_CAMELS' })
    expect(socketService.sendAction).not.toHaveBeenCalled()
    expect(useGameStore.getState().state).toBe(state)  // state unchanged
  })

  it('receiveOpponentAction applies the action to the state', () => {
    const base = setupRound([0, 0])
    const camelIdx = base.market.findIndex(c => c.type === 'camel')
    let testState = base
    if (camelIdx === -1) {
      testState = {
        ...base,
        market: [{ id: 999, type: 'camel' as const }, ...base.market.slice(1)],
      }
    }
    useGameStore.setState({ state: testState, mode: 'online', onlinePlayerIndex: 1 })
    useGameStore.getState().receiveOpponentAction({ type: 'TAKE_CAMELS' })
    // Turn should have advanced from 0 to 1
    expect(useGameStore.getState().state?.activePlayer).toBe(1)
  })

  it('nextRound in online mode sends NEXT_ROUND signal without advancing state', () => {
    const state = setupRound([0, 0])
    useGameStore.setState({ state: { ...state, phase: 'round-end' }, mode: 'online' })
    useGameStore.getState().nextRound()
    expect(socketService.sendNextRound).toHaveBeenCalledWith(state.round)
    // State phase should still be 'round-end' (waiting for ROUND_START from server)
    expect(useGameStore.getState().state?.phase).toBe('round-end')
  })

  it('startNextRound advances to next round using seeded RNG', () => {
    const state = setupRound([0, 0])
    useGameStore.setState({ state: { ...state, phase: 'round-end' }, mode: 'online', matchLength: 3 })
    useGameStore.getState().startNextRound(999)
    expect(useGameStore.getState().state?.phase).toBe('playing')
  })

  it('joinOnline create sets roomCode and onlineStatus to waiting', async () => {
    await useGameStore.getState().joinOnline('create')
    expect(useGameStore.getState().roomCode).toBe('CAML99')
    expect(useGameStore.getState().onlineStatus).toBe('waiting')
  })

  it('disconnectOnline resets online state and disconnects socket', () => {
    useGameStore.setState({ mode: 'online', onlinePlayerIndex: 0, roomCode: 'X', onlineStatus: 'playing' })
    useGameStore.getState().disconnectOnline()
    expect(socketService.disconnect).toHaveBeenCalled()
    expect(useGameStore.getState().onlineStatus).toBe('idle')
    expect(useGameStore.getState().onlinePlayerIndex).toBeNull()
    expect(useGameStore.getState().roomCode).toBeNull()
    expect(useGameStore.getState().state).toBeNull()
  })

  it('onRoomReady callback sets mode, state, onlinePlayerIndex and onlineStatus', async () => {
    // Start joinOnline so callbacks are wired
    const joinPromise = useGameStore.getState().joinOnline('create')
    // The mock createRoom resolves to 'CAML99' — await it
    await joinPromise

    // Now fire the onRoomReady callback that was wired during joinOnline
    const { onRoomReady } = socketService as any
    expect(onRoomReady).not.toBeNull()
    onRoomReady(0, 42)

    const s = useGameStore.getState()
    expect(s.mode).toBe('online')
    expect(s.onlinePlayerIndex).toBe(0)
    expect(s.onlineStatus).toBe('playing')
    expect(s.state).not.toBeNull()
    expect(s.state?.phase).toBe('playing')
  })
})

// FIX 1: winning by opponent forfeit must record a match, since no
// addMatch() call site is otherwise reached (those all require a normal
// scoreRound()/'game-over' transition, which a forfeit skips entirely).
describe('onForfeit records a win (Fix 1)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- vi.spyOn's
  // return type is only concrete at the call site; widen the declaration to
  // avoid annotation/inference variance and keep this a pure test-local spy.
  let addMatchSpy: any

  beforeEach(() => {
    addMatchSpy = vi.spyOn(useStatsStore.getState(), 'addMatch').mockResolvedValue(undefined)
  })

  afterEach(() => {
    addMatchSpy.mockRestore()
  })

  it('records a won match using the current matchScores when the opponent forfeits', async () => {
    await useGameStore.getState().joinOnline('create')
    useGameStore.setState({
      mode: 'online', onlinePlayerIndex: 0, onlineStatus: 'playing',
      opponentFriendCode: 'VJ-9999', matchScores: [24, 11],
    })

    const { onForfeit } = socketService as any
    expect(onForfeit).toBeInstanceOf(Function)
    onForfeit()

    expect(useGameStore.getState().onlineStatus).toBe('forfeited')
    expect(addMatchSpy).toHaveBeenCalledTimes(1)
    expect(addMatchSpy).toHaveBeenCalledWith(expect.objectContaining({
      opponent_type: 'online',
      opponent_id: 'VJ-9999',
      player_score: 24,
      opponent_score: 11,
      won: true,
    }))
  })

  it('records a win for player 1 using the mirrored score indices', async () => {
    await useGameStore.getState().joinOnline('create')
    useGameStore.setState({
      mode: 'online', onlinePlayerIndex: 1, onlineStatus: 'playing',
      opponentFriendCode: 'VJ-1111', matchScores: [5, 30],
    })

    const { onForfeit } = socketService as any
    onForfeit()

    expect(addMatchSpy).toHaveBeenCalledWith(expect.objectContaining({
      player_score: 30,
      opponent_score: 5,
      won: true,
    }))
  })

  it('still records a win with the best-available (zeroed) scores when the forfeit lands before any round finished', async () => {
    await useGameStore.getState().joinOnline('create')
    useGameStore.setState({
      mode: 'online', onlinePlayerIndex: 0, onlineStatus: 'playing',
      opponentFriendCode: null, matchScores: [0, 0],
    })

    const { onForfeit } = socketService as any
    onForfeit()

    expect(addMatchSpy).toHaveBeenCalledWith(expect.objectContaining({
      opponent_type: 'online',
      player_score: 0,
      opponent_score: 0,
      won: true,
    }))
  })

  it('does not double-record if onForfeit somehow fires more than once', async () => {
    await useGameStore.getState().joinOnline('create')
    useGameStore.setState({
      mode: 'online', onlinePlayerIndex: 0, onlineStatus: 'playing', matchScores: [3, 1],
    })

    const { onForfeit } = socketService as any
    onForfeit()
    onForfeit()

    expect(addMatchSpy).toHaveBeenCalledTimes(1)
  })
})

// FIX 2: the server always relays the sender's authoritative post-move
// state. The receiver must trust it unconditionally instead of gating on a
// local applyAction() replay that can spuriously fail on drift.
describe('receiveOpponentAction trusts authoritative syncedState (Fix 2)', () => {
  it('adopts syncedState even when the local replay of the action would fail (drifted local state)', () => {
    const localState = setupRound([0, 0])
    const authoritative = setupRound([1, 0]) // distinct object standing in for the server's real post-move state
    useGameStore.setState({ state: localState, mode: 'online', onlinePlayerIndex: 1, opponentName: 'Rival', error: null })

    // SELL quantity 0 is always engine-invalid, guaranteeing the local replay fails regardless of state.
    useGameStore.getState().receiveOpponentAction({ type: 'SELL', good: 'diamond', quantity: 0 }, authoritative)

    expect(useGameStore.getState().state).toBe(authoritative)
    expect(useGameStore.getState().error).toBeNull()
  })

  it('still applies the syncedState when the action also replays cleanly', () => {
    const base = setupRound([0, 0])
    const camelIdx = base.market.findIndex(c => c.type === 'camel')
    const testState = camelIdx === -1
      ? { ...base, market: [{ id: 999, type: 'camel' as const }, ...base.market.slice(1)] }
      : base
    useGameStore.setState({ state: testState, mode: 'online', onlinePlayerIndex: 1 })

    const synced = { ...testState, activePlayer: 1 as const }
    useGameStore.getState().receiveOpponentAction({ type: 'TAKE_CAMELS' }, synced)

    expect(useGameStore.getState().state).toBe(synced)
  })

  it('falls back to local replay when no syncedState is provided (legacy relay path)', () => {
    const base = setupRound([0, 0])
    const camelIdx = base.market.findIndex(c => c.type === 'camel')
    const testState = camelIdx === -1
      ? { ...base, market: [{ id: 999, type: 'camel' as const }, ...base.market.slice(1)] }
      : base
    useGameStore.setState({ state: testState, mode: 'online', onlinePlayerIndex: 1 })

    useGameStore.getState().receiveOpponentAction({ type: 'TAKE_CAMELS' })

    expect(useGameStore.getState().state?.activePlayer).toBe(1)
  })

  it('surfaces a visible error instead of silently freezing when there is no syncedState and the local replay fails', () => {
    const localState = setupRound([0, 0])
    useGameStore.setState({ state: localState, mode: 'online', onlinePlayerIndex: 1, error: null })

    useGameStore.getState().receiveOpponentAction({ type: 'SELL', good: 'diamond', quantity: 0 })

    expect(useGameStore.getState().state).toBe(localState)
    expect(useGameStore.getState().error).not.toBeNull()
  })
})

// FIX 4: the client never listened for its OWN socket disconnect, so a local
// network drop left onlineStatus at 'playing' forever while the server ran a
// forfeit timer — the user kept "playing" into the void.
describe('self-disconnect visibility (Fix 4)', () => {
  it('onSelfDisconnected moves onlineStatus to reconnecting during an active online game', async () => {
    await useGameStore.getState().joinOnline('create')
    useGameStore.setState({ mode: 'online', onlineStatus: 'playing' })

    const { onSelfDisconnected } = socketService as any
    expect(onSelfDisconnected).toBeInstanceOf(Function)
    onSelfDisconnected('transport close')

    expect(useGameStore.getState().onlineStatus).toBe('reconnecting')
  })

  it('does not clobber a forfeited status if a disconnect event arrives afterward', async () => {
    await useGameStore.getState().joinOnline('create')
    useGameStore.setState({ mode: 'online', onlineStatus: 'forfeited' })

    const { onSelfDisconnected } = socketService as any
    onSelfDisconnected('transport close')

    expect(useGameStore.getState().onlineStatus).toBe('forfeited')
  })

  it('onReconnectFailed moves onlineStatus to connection-lost', async () => {
    await useGameStore.getState().joinOnline('create')
    useGameStore.setState({ mode: 'online', onlineStatus: 'reconnecting' })

    const { onReconnectFailed } = socketService as any
    expect(onReconnectFailed).toBeInstanceOf(Function)
    onReconnectFailed()

    expect(useGameStore.getState().onlineStatus).toBe('connection-lost')
  })

  it('dispatch in online mode does not apply the move locally as authoritative when the socket is disconnected', () => {
    const state = setupRound([0, 0])
    ;(socketService as any).connected = false
    useGameStore.setState({ state, mode: 'online', onlinePlayerIndex: 0, error: null })

    useGameStore.getState().dispatch({ type: 'TAKE_CAMELS' })

    expect(socketService.sendAction).not.toHaveBeenCalled()
    expect(useGameStore.getState().state).toBe(state)
    expect(useGameStore.getState().error).not.toBeNull()
  })

  it('leaveOnline resets to a clean idle state and disconnects the socket', () => {
    useGameStore.setState({
      state: setupRound([0, 0]), mode: 'online', onlinePlayerIndex: 0, roomCode: 'ABCDEF',
      onlineStatus: 'playing', disconnectTimestamp: 12345, opponentName: 'Rival', opponentFriendCode: 'VJ-1',
    })

    useGameStore.getState().leaveOnline()

    expect(socketService.disconnect).toHaveBeenCalled()
    const s = useGameStore.getState()
    expect(s.mode).toBeNull()
    expect(s.roomCode).toBeNull()
    expect(s.onlinePlayerIndex).toBeNull()
    expect(s.onlineStatus).toBe('idle')
    expect(s.state).toBeNull()
    expect(s.disconnectTimestamp).toBeNull()
  })
})

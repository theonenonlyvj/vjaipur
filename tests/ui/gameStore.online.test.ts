import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/socket/socketService', () => ({
  socketService: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    sendAction: vi.fn(),
    sendNextRound: vi.fn(),
    createRoom: vi.fn().mockResolvedValue('CAML99'),
    joinRoom: vi.fn().mockResolvedValue({ playerIndex: 1 }),
    quickMatch: vi.fn(),
    onRoomReady: null,
    onOpponentAction: null,
    onRoundStart: null,
    onOpponentDisconnected: null,
    onOpponentReconnected: null,
    onForfeit: null,
  },
}))

import { useGameStore } from '../../src/store/gameStore'
import { socketService } from '../../src/socket/socketService'
import { setupRound } from '../../src/engine'

beforeEach(() => {
  vi.clearAllMocks()
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
    const state = setupRound([0, 0])
    useGameStore.setState({ state, mode: 'online', onlinePlayerIndex: 0 })
    expect(state.activePlayer).toBe(0)
    // Find a sell action — at minimum test that dispatch calls sendAction when turn is ours
    // Use TAKE_CAMELS if camels available, otherwise TAKE_SINGLE
    const camelsInMarket = state.market.some(c => c.type === 'camel')
    if (camelsInMarket) {
      useGameStore.getState().dispatch({ type: 'TAKE_CAMELS' })
      expect(socketService.sendAction).toHaveBeenCalledWith({ type: 'TAKE_CAMELS' })
    } else {
      const nonCamelIdx = state.market.findIndex(c => c.type !== 'camel')
      if (nonCamelIdx !== -1) {
        useGameStore.getState().dispatch({ type: 'TAKE_SINGLE', marketIndex: nonCamelIdx })
        expect(socketService.sendAction).toHaveBeenCalled()
      }
    }
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
    const state = setupRound([0, 0])
    // Put a state where player 0 is active and there are camels in market
    const stateWithCamels = { ...state, market: [...state.market] }
    const camelsInMarket = stateWithCamels.market.some(c => c.type === 'camel')
    useGameStore.setState({ state: stateWithCamels, mode: 'online', onlinePlayerIndex: 1 })
    if (camelsInMarket) {
      useGameStore.getState().receiveOpponentAction({ type: 'TAKE_CAMELS' })
      // State should have changed (turn should have advanced)
      expect(useGameStore.getState().state?.activePlayer).toBe(1)
    }
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
    useGameStore.setState({ state: { ...state, phase: 'round-end' }, mode: 'online' })
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
  })
})

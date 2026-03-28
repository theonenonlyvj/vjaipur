import { create } from 'zustand'
import type { GameState, Action, EngineError } from '../engine'
import { applyAction, setupRound, scoreRound } from '../engine'
import { pickEasyAction } from '../ai/easyAi'
import { socketService } from '../socket/socketService'
import { mulberry32 } from '../shared/rng'

export type Mode = 'vs-ai' | 'local' | 'online'
export type OnlineStatus = 'idle' | 'connecting' | 'waiting' | 'playing' | 'opponent-disconnected' | 'forfeited'

export interface GameStore {
  state: GameState | null
  mode: Mode | null
  error: EngineError | null
  onlinePlayerIndex: 0 | 1 | null
  roomCode: string | null
  onlineStatus: OnlineStatus

  startGame: (mode: Mode) => void
  dispatch: (action: Action) => void
  nextRound: () => void
  clearError: () => void
  joinOnline: (variant: 'create' | 'join' | 'quick', code?: string) => Promise<void>
  receiveOpponentAction: (action: Action) => void
  startNextRound: (seed: number) => void
  setOnlineStatus: (status: OnlineStatus) => void
  disconnectOnline: () => void
}

export const useGameStore = create<GameStore>((set, get) => ({
  state: null,
  mode: null,
  error: null,
  onlinePlayerIndex: null,
  roomCode: null,
  onlineStatus: 'idle',

  startGame: (mode) => {
    set({ state: setupRound([0, 0]), mode, error: null })
  },

  dispatch: (action) => {
    const { state, mode, onlinePlayerIndex } = get()
    if (!state) return
    if (mode === 'online' && state.activePlayer !== onlinePlayerIndex) return

    const result = applyAction(state, action)
    if (!result.ok) { set({ error: result.error }); return }

    if (mode === 'online') socketService.sendAction(action)

    let next = result.value
    if (mode === 'vs-ai' && next.phase === 'playing' && next.activePlayer === 1) {
      const aiAction = pickEasyAction(next)
      if (aiAction) {
        const aiResult = applyAction(next, aiAction)
        if (aiResult.ok) next = aiResult.value
      }
    }
    set({ state: next, error: null })
  },

  nextRound: () => {
    const { state, mode } = get()
    if (!state || state.phase !== 'round-end') return

    if (mode === 'online') {
      socketService.sendNextRound(state.round)
      return
    }

    const result = scoreRound(state)
    const newSeals: [number, number] = [
      state.seals[0] + (result.sealAwardedTo === 0 ? 1 : 0),
      state.seals[1] + (result.sealAwardedTo === 1 ? 1 : 0),
    ]
    if (newSeals[0] >= 2 || newSeals[1] >= 2) {
      set({ state: { ...state, phase: 'game-over', seals: newSeals } })
    } else {
      const loser: 0 | 1 | undefined =
        result.sealAwardedTo === 0 ? 1 :
        result.sealAwardedTo === 1 ? 0 :
        undefined
      set({ state: setupRound(newSeals, loser), error: null })
    }
  },

  clearError: () => set({ error: null }),

  joinOnline: async (variant, code) => {
    set({ onlineStatus: 'connecting' })
    const url = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001'
    socketService.connect(url)

    socketService.onRoomReady = (playerIndex, seed) => {
      const rng = mulberry32(seed)
      set({
        state: setupRound([0, 0], undefined, rng),
        mode: 'online',
        onlinePlayerIndex: playerIndex,
        onlineStatus: 'playing',
        error: null,
      })
    }
    socketService.onOpponentAction = (action) => get().receiveOpponentAction(action)
    socketService.onRoundStart = (seed) => get().startNextRound(seed)
    socketService.onOpponentDisconnected = () => set({ onlineStatus: 'opponent-disconnected' })
    socketService.onOpponentReconnected = () => set({ onlineStatus: 'playing' })
    socketService.onForfeit = () => set({ onlineStatus: 'forfeited' })
    socketService.onConnect = () => {
      const { mode, roomCode, onlinePlayerIndex } = get()
      // Reconnect: only attempt rejoin when a game is active
      if (mode === 'online' && roomCode !== null && onlinePlayerIndex !== null) {
        socketService.rejoin(roomCode, onlinePlayerIndex).catch(() => {
          set({ onlineStatus: 'forfeited' })
        })
      }
    }

    if (variant === 'create') {
      const newCode = await socketService.createRoom()
      set({ roomCode: newCode, onlineStatus: 'waiting' })
    } else if (variant === 'join') {
      if (!code) throw new Error('Code required for join')
      await socketService.joinRoom(code)
      set({ onlineStatus: 'waiting' })
    } else {
      socketService.quickMatch()
      set({ onlineStatus: 'waiting' })
    }
  },

  receiveOpponentAction: (action) => {
    const { state } = get()
    if (!state) return
    const result = applyAction(state, action)
    if (result.ok) set({ state: result.value, error: null })
  },

  startNextRound: (seed) => {
    const { state } = get()
    if (!state || state.phase !== 'round-end') return
    const result = scoreRound(state)
    const newSeals: [number, number] = [
      state.seals[0] + (result.sealAwardedTo === 0 ? 1 : 0),
      state.seals[1] + (result.sealAwardedTo === 1 ? 1 : 0),
    ]
    if (newSeals[0] >= 2 || newSeals[1] >= 2) {
      set({ state: { ...state, phase: 'game-over', seals: newSeals } })
    } else {
      const loser: 0 | 1 | undefined =
        result.sealAwardedTo === 0 ? 1 :
        result.sealAwardedTo === 1 ? 0 :
        undefined
      const rng = mulberry32(seed)
      set({ state: setupRound(newSeals, loser, rng), error: null })
    }
  },

  setOnlineStatus: (status) => set({ onlineStatus: status }),

  disconnectOnline: () => {
    socketService.disconnect()
    socketService.onRoomReady = null
    socketService.onOpponentAction = null
    socketService.onRoundStart = null
    socketService.onOpponentDisconnected = null
    socketService.onOpponentReconnected = null
    socketService.onForfeit = null
    socketService.onConnect = null
    set({ state: null, mode: null, onlineStatus: 'idle', onlinePlayerIndex: null, roomCode: null })
  },
}))

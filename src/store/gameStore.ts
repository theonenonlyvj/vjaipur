import { create } from 'zustand'
import type { GameState, Action, EngineError } from '../engine'
import { applyAction, setupRound, scoreRound } from '../engine'
import { pickEasyAction } from '../ai/easyAi'
import { pickMediumAction } from '../ai/mediumAi'
import { getWorkerBridge } from '../ai/workerBridge'
import { socketService } from '../socket/socketService'
import { mulberry32 } from '../shared/rng'
import { soundService } from '../audio/soundService'

export type Mode = 'vs-ai' | 'local' | 'online'
export type OnlineStatus = 'idle' | 'connecting' | 'waiting' | 'playing' | 'opponent-disconnected' | 'forfeited'
export type Difficulty = 'easy' | 'medium' | 'hard'

export interface GameStore {
  state: GameState | null
  mode: Mode | null
  error: EngineError | null
  onlinePlayerIndex: 0 | 1 | null
  roomCode: string | null
  onlineStatus: OnlineStatus
  difficulty: Difficulty
  aiThinking: boolean
  muted: boolean
  lastMoveDescription: string | null
  tutorial: boolean
  toggleMute: () => void

  startGame: (mode: Mode) => void
  dispatch: (action: Action) => void
  nextRound: () => void
  clearError: () => void
  joinOnline: (variant: 'create' | 'join' | 'quick', code?: string) => Promise<void>
  receiveOpponentAction: (action: Action) => void
  startNextRound: (seed: number) => void
  setOnlineStatus: (status: OnlineStatus) => void
  disconnectOnline: () => void
  setDifficulty: (d: Difficulty) => void
  startTutorial: () => void
  endTutorial: () => void
}

function describeAction(action: Action, state?: GameState): string {
  switch (action.type) {
    case 'TAKE_SINGLE': {
      const type = state?.market[action.marketIndex]?.type ?? 'card'
      return `took a ${type}`
    }
    case 'TAKE_CAMELS': {
      const count = state ? state.market.filter(c => c.type === 'camel').length : 1
      return `took ${count} camel${count === 1 ? '' : 's'}`
    }
    case 'TAKE_EXCHANGE':
      return 'made an exchange'
    case 'SELL':
      return `sold ${action.quantity} ${action.good}`
  }
}

export const useGameStore = create<GameStore>((set, get) => ({
  state: null,
  mode: null,
  error: null,
  onlinePlayerIndex: null,
  roomCode: null,
  onlineStatus: 'idle',
  difficulty: 'easy',
  aiThinking: false,
  muted: (() => { try { return localStorage.getItem('vjaipur-muted') } catch { return null } })() === 'true',
  lastMoveDescription: null,
  tutorial: false,

  startGame: (mode) => {
    set({ state: setupRound([0, 0]), mode, error: null, aiThinking: false, lastMoveDescription: null })
  },

  dispatch: (action) => {
    const { state, mode, onlinePlayerIndex, difficulty } = get()
    if (!state) return
    if (mode === 'online' && state.activePlayer !== onlinePlayerIndex) return

    const playerDesc = describeAction(action, state)

    const result = applyAction(state, action)
    if (!result.ok) { set({ error: result.error }); return }

    if (mode === 'online') socketService.sendAction(action)

    const next = result.value

    if (mode !== 'vs-ai' || next.phase !== 'playing' || next.activePlayer !== 1) {
      set({ state: next, error: null, lastMoveDescription: mode === 'local' ? playerDesc : null })
      return
    }

    // vs-ai: AI must move (player 1)
    if (difficulty === 'hard') {
      set({ state: next, error: null, aiThinking: true })
      getWorkerBridge()
        .getAction(next)
        .then(aiAction => aiAction ?? pickMediumAction(next))
        .catch(() => pickMediumAction(next))
        .then(aiAction => {
          if (!aiAction) { set({ aiThinking: false }); return }
          const cur = get().state
          if (!cur || cur.phase !== 'playing' || cur.activePlayer !== 1) {
            set({ aiThinking: false }); return
          }
          const aiResult = applyAction(cur, aiAction)
          if (aiResult.ok) set({ state: aiResult.value, aiThinking: false, error: null, lastMoveDescription: describeAction(aiAction, cur) })
          else set({ aiThinking: false })
        })
      return
    }

    const aiAction = difficulty === 'medium'
      ? pickMediumAction(next)
      : pickEasyAction(next)
    if (aiAction) {
      const aiResult = applyAction(next, aiAction)
      if (aiResult.ok) { set({ state: aiResult.value, error: null, lastMoveDescription: describeAction(aiAction, next) }); return }
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
      set({ roomCode: code.toUpperCase(), onlineStatus: 'waiting' })
    } else {
      socketService.quickMatch()
      set({ onlineStatus: 'waiting' })
    }
  },

  receiveOpponentAction: (action) => {
    const { state } = get()
    if (!state) return
    const result = applyAction(state, action)
    if (result.ok) set({ state: result.value, error: null, lastMoveDescription: describeAction(action, state) })
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

  setDifficulty: (d) => set({ difficulty: d }),

  startTutorial: () => set({ tutorial: true }),
  endTutorial: () => set({ tutorial: false }),

  toggleMute: () => {
    const muted = !get().muted
    soundService.setMuted(muted)
    set({ muted })
  },

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

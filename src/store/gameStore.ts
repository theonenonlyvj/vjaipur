import { create } from 'zustand'
import type { GameState, Action, EngineError } from '../engine'
import { applyAction, setupRound, scoreRound } from '../engine'
import { pickEasyAction } from '../ai/easyAi'

export type Mode = 'vs-ai' | 'local'

export interface GameStore {
  state: GameState | null
  mode: Mode | null
  error: EngineError | null
  startGame: (mode: Mode) => void
  dispatch: (action: Action) => void
  nextRound: () => void
  clearError: () => void
}

export const useGameStore = create<GameStore>((set, get) => ({
  state: null,
  mode: null,
  error: null,

  startGame: (mode) => {
    set({ state: setupRound([0, 0]), mode, error: null })
  },

  dispatch: (action) => {
    const { state, mode } = get()
    if (!state) return
    const result = applyAction(state, action)
    if (!result.ok) {
      set({ error: result.error })
      return
    }
    let next = result.value
    // In vs-ai mode, fire AI move synchronously when it is player 1's turn
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
      set({ state: setupRound(newSeals, loser), error: null })
    }
  },

  clearError: () => set({ error: null }),
}))

import { create } from 'zustand'
import type { GameState, Action, EngineError } from '../engine'

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

export const useGameStore = create<GameStore>(() => ({
  state: null,
  mode: null,
  error: null,
  startGame: () => {},
  dispatch: () => {},
  nextRound: () => {},
  clearError: () => {},
}))

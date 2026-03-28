import type { GameState, Action } from '../engine'
import { getLegalActions } from '../engine'

export function pickEasyAction(state: GameState): Action | null {
  const actions = getLegalActions(state)
  return actions[0] ?? null
}

import type { GameState, Action } from '../engine'
import { getLegalActions } from '../engine'
import { mcts } from './hardAi'
import { pickMediumAction, getAllProfitableExchanges } from './mediumAi'

function getActions(state: GameState): Action[] {
  return [...getLegalActions(state), ...getAllProfitableExchanges(state)]
}

self.onmessage = (e: MessageEvent<GameState>) => {
  const action: Action | null = mcts(e.data, 8000, pickMediumAction, getActions)
  self.postMessage(action)
}

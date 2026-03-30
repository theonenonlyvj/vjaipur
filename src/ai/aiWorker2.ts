import type { GameState, Action } from '../engine'
import { mcts } from './hardAi'
import { pickMediumAction } from './mediumAi'

self.onmessage = (e: MessageEvent<GameState>) => {
  const action: Action | null = mcts(e.data, 3000, pickMediumAction)
  self.postMessage(action)
}

import type { GameState, Action } from '../engine'
import { mcts } from './hardAi'

self.onmessage = (e: MessageEvent<GameState>) => {
  const action: Action | null = mcts(e.data, 2000)
  self.postMessage(action)
}

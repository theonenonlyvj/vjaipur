import type { GameState, Action } from '../engine'
import { pickHard2Action } from './hardAi2'

self.onmessage = (e: MessageEvent<GameState>) => {
  const action: Action | null = pickHard2Action(e.data)
  self.postMessage(action)
}

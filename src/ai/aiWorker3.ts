import type { GameState, Action } from '../engine'
import { pickHard3Action } from './hardAi3'

self.onmessage = (e: MessageEvent<GameState>) => {
  const action: Action | null = pickHard3Action(e.data)
  self.postMessage(action)
}

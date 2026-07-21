import type { GameState, Action } from '../engine'
import { pickIsmctsAction } from './ismctsBot'

self.onmessage = (e: MessageEvent<GameState>) => {
  const action: Action | null = pickIsmctsAction(e.data)
  self.postMessage(action)
}

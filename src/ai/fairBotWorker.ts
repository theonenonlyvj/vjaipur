import type { GameState, Action } from '../engine'
import { pickFairBotAction, OpponentTracker } from './fairBot'

interface FairBotMessage {
  state: GameState
  tracker: { knownInHand: { id: number; type: string }[]; unknownInHand: number }
}

self.onmessage = (e: MessageEvent<FairBotMessage>) => {
  const { state, tracker: trackerData } = e.data
  const tracker = new OpponentTracker(trackerData.unknownInHand)
  tracker.knownInHand = trackerData.knownInHand as any
  const action: Action | null = pickFairBotAction(state, tracker)
  self.postMessage(action)
}

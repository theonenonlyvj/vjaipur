import type { GameState, Action } from '../engine'
import { pickIsmctsAction, getLastIsmctsDebugInfo } from './ismctsBot'
import type { IsmctsCandidateLog } from '../store/aiGameLog'

// Posts `{action, debug}` rather than a bare action — see
// WorkerBridge.lastDebug's docstring for why every other AI worker doesn't.
// `getLastIsmctsDebugInfo()` is read AFTER pickIsmctsAction returns, purely
// for logging (top-3 root-child candidates by visit count, already sorted
// that way) — it never influences which action was chosen, so this adds
// diagnostics without touching move selection at all.
self.onmessage = (e: MessageEvent<GameState>) => {
  const action: Action | null = pickIsmctsAction(e.data)
  const debugInfo = getLastIsmctsDebugInfo()
  const candidates: IsmctsCandidateLog[] | undefined = debugInfo
    ? debugInfo.rootChildVisits.slice(0, 3).map((c) => ({ action: c.key, visits: c.visits, q: c.q }))
    : undefined
  self.postMessage({ action, debug: candidates ? { candidates } : undefined })
}

import type { GameState, Action } from '../engine'

export type WorkerFactory = () => Worker

export class WorkerBridge {
  private factory: WorkerFactory
  private timeoutMs: number

  /**
   * Diagnostics posted ALONGSIDE the most recently resolved action, if any —
   * only ismctsWorker.ts populates this (its onmessage posts
   * `{action, debug}` instead of a bare action; see that file's docstring).
   * Every other worker (aiWorker/aiWorker2/aiWorker3/fairBotWorker) still
   * posts a bare `Action | null`, so this stays `null` for them. Read
   * immediately after the `getAction()` promise this call produced resolves
   * — a later `getAction()` call on the same bridge instance overwrites it.
   */
  lastDebug: unknown = null

  constructor(factory: WorkerFactory, timeoutMs = 5000) {
    this.factory = factory
    this.timeoutMs = timeoutMs
  }

  getAction(data: unknown): Promise<Action | null> {
    return new Promise((resolve, reject) => {
      const worker = this.factory()

      const timeout = setTimeout(() => {
        worker.terminate()
        reject(new Error('Worker timeout'))
      }, this.timeoutMs)

      worker.onmessage = (e: MessageEvent<unknown>) => {
        clearTimeout(timeout)
        worker.terminate()
        const payload = e.data
        // Distinguish ismctsWorker's `{action, debug}` envelope from every
        // other worker's bare `Action | null` — safe because a real Action
        // is discriminated by a `type` field and never carries an `action`
        // key of its own.
        if (payload !== null && typeof payload === 'object' && 'action' in (payload as Record<string, unknown>)) {
          const envelope = payload as { action: Action | null; debug?: unknown }
          this.lastDebug = envelope.debug ?? null
          resolve(envelope.action)
        } else {
          this.lastDebug = null
          resolve(payload as Action | null)
        }
      }

      worker.onerror = (e: unknown) => {
        clearTimeout(timeout)
        worker.terminate()
        reject(e)
      }

      worker.postMessage(data)
    })
  }
}

// Module-level singletons — default uses Vite's URL-based workers (browser only).
// Tests replace these via setWorkerBridge() / setWorkerBridge2().
let _bridge: WorkerBridge | null = null
let _bridge2: WorkerBridge | null = null

export function getWorkerBridge(): WorkerBridge {
  if (!_bridge) {
    _bridge = new WorkerBridge(
      // @ts-ignore
      () => new Worker(new URL('./aiWorker.ts', import.meta.url), { type: 'module' })
    )
  }
  return _bridge
}

export function setWorkerBridge(bridge: WorkerBridge | null): void {
  _bridge = bridge
}

export function getWorkerBridge2(): WorkerBridge {
  if (!_bridge2) {
    _bridge2 = new WorkerBridge(
      // @ts-ignore
      () => new Worker(new URL('./aiWorker2.ts', import.meta.url), { type: 'module' }),
      3000,  // hardAi2's own think budget is ~1500ms (BUDGET_MS in hardAi2.ts) — 3000ms
             // leaves comfortable headroom for worker spin-up/postMessage overhead so a
             // legitimate in-budget move is never killed by this timeout.
    )
  }
  return _bridge2
}

export function setWorkerBridge2(bridge: WorkerBridge | null): void {
  _bridge2 = bridge
}

let _bridge3: WorkerBridge | null = null

export function getWorkerBridge3(): WorkerBridge {
  if (!_bridge3) {
    _bridge3 = new WorkerBridge(
      // @ts-ignore
      () => new Worker(new URL('./aiWorker3.ts', import.meta.url), { type: 'module' }),
      11000,  // 8s think time + 3s buffer
    )
  }
  return _bridge3
}

export function setWorkerBridge3(bridge: WorkerBridge | null): void {
  _bridge3 = bridge
}

let _bridgeIsmcts: WorkerBridge | null = null

export function getIsmctsWorkerBridge(): WorkerBridge {
  if (!_bridgeIsmcts) {
    _bridgeIsmcts = new WorkerBridge(
      // @ts-ignore
      () => new Worker(new URL('./ismctsWorker.ts', import.meta.url), { type: 'module' }),
      5000,  // ismctsBot's own think budget is 3000ms (DEFAULT_BUDGET_MS in ismctsBot.ts) —
             // 5000ms leaves comfortable headroom for worker spin-up/postMessage overhead so
             // a legitimate in-budget move is never killed by this timeout.
    )
  }
  return _bridgeIsmcts
}

export function setIsmctsWorkerBridge(bridge: WorkerBridge | null): void {
  _bridgeIsmcts = bridge
}

let _bridgeFair: WorkerBridge | null = null

export function getFairBotWorkerBridge(): WorkerBridge {
  if (!_bridgeFair) {
    _bridgeFair = new WorkerBridge(
      // @ts-ignore
      () => new Worker(new URL('./fairBotWorker.ts', import.meta.url), { type: 'module' }),
      15000,
    )
  }
  return _bridgeFair
}

export function setFairBotWorkerBridge(bridge: WorkerBridge | null): void {
  _bridgeFair = bridge
}

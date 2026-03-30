import type { GameState, Action } from '../engine'

export type WorkerFactory = () => Worker

export class WorkerBridge {
  private factory: WorkerFactory
  private timeoutMs: number

  constructor(factory: WorkerFactory, timeoutMs = 5000) {
    this.factory = factory
    this.timeoutMs = timeoutMs
  }

  getAction(state: GameState): Promise<Action | null> {
    return new Promise((resolve, reject) => {
      const worker = this.factory()

      const timeout = setTimeout(() => {
        worker.terminate()
        reject(new Error('Worker timeout'))
      }, this.timeoutMs)

      worker.onmessage = (e: MessageEvent<Action | null>) => {
        clearTimeout(timeout)
        worker.terminate()
        resolve(e.data)
      }

      worker.onerror = (e: unknown) => {
        clearTimeout(timeout)
        worker.terminate()
        reject(e)
      }

      worker.postMessage(state)
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
      () => new Worker(new URL('./aiWorker2.ts', import.meta.url), { type: 'module' })
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

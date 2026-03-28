import type { GameState, Action } from '../engine'

export type WorkerFactory = () => Worker

export class WorkerBridge {
  private factory: WorkerFactory

  constructor(factory: WorkerFactory) {
    this.factory = factory
  }

  getAction(state: GameState): Promise<Action | null> {
    return new Promise((resolve, reject) => {
      const worker = this.factory()

      const timeout = setTimeout(() => {
        worker.terminate()
        reject(new Error('Worker timeout'))
      }, 3500)

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

// Module-level singleton — default uses Vite's URL-based worker (browser only).
// Tests replace this via setWorkerBridge().
let _bridge: WorkerBridge | null = null

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

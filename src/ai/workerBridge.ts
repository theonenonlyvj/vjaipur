import type { Action } from '../engine'

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
// Tests replace these via setWorkerBridge() / setWorkerBridge2() / etc.
//
// Each get*/set* pair below is the same lazy-init-with-test-override shape;
// makeBridgeSingleton factors that shape out so each singleton is just its
// worker factory + timeout.
function makeBridgeSingleton(factory: WorkerFactory, timeoutMs?: number) {
  let instance: WorkerBridge | null = null
  return {
    get(): WorkerBridge {
      if (!instance) {
        instance = new WorkerBridge(factory, timeoutMs)
      }
      return instance
    },
    set(bridge: WorkerBridge | null): void {
      instance = bridge
    },
  }
}

const bridge = makeBridgeSingleton(
  // @ts-ignore
  () => new Worker(new URL('./aiWorker.ts', import.meta.url), { type: 'module' })
)

export function getWorkerBridge(): WorkerBridge {
  return bridge.get()
}

export function setWorkerBridge(b: WorkerBridge | null): void {
  bridge.set(b)
}

const bridge2 = makeBridgeSingleton(
  // @ts-ignore
  () => new Worker(new URL('./aiWorker2.ts', import.meta.url), { type: 'module' }),
  3000,  // hardAi2's own think budget is ~1500ms (BUDGET_MS in hardAi2.ts) — 3000ms
         // leaves comfortable headroom for worker spin-up/postMessage overhead so a
         // legitimate in-budget move is never killed by this timeout.
)

export function getWorkerBridge2(): WorkerBridge {
  return bridge2.get()
}

export function setWorkerBridge2(b: WorkerBridge | null): void {
  bridge2.set(b)
}

const bridge3 = makeBridgeSingleton(
  // @ts-ignore
  () => new Worker(new URL('./aiWorker3.ts', import.meta.url), { type: 'module' }),
  11000,  // 8s think time + 3s buffer
)

export function getWorkerBridge3(): WorkerBridge {
  return bridge3.get()
}

export function setWorkerBridge3(b: WorkerBridge | null): void {
  bridge3.set(b)
}

const bridgeIsmcts = makeBridgeSingleton(
  // @ts-ignore
  () => new Worker(new URL('./ismctsWorker.ts', import.meta.url), { type: 'module' }),
  10000, // ismctsBot's think budget is 3000ms (DEFAULT_BUDGET_MS) but the
         // 2026-08-02 iteration floor lets a THROTTLED device run up to
         // HARD_CAP_MS=8000 to reach 25k iterations (consistent strength
         // on slow phones — Vijay approved the extra wait). 10s leaves
         // spin-up/postMessage headroom above that worst case.
)

export function getIsmctsWorkerBridge(): WorkerBridge {
  return bridgeIsmcts.get()
}

export function setIsmctsWorkerBridge(b: WorkerBridge | null): void {
  bridgeIsmcts.set(b)
}

const bridgeFair = makeBridgeSingleton(
  // @ts-ignore
  () => new Worker(new URL('./fairBotWorker.ts', import.meta.url), { type: 'module' }),
  15000,
)

export function getFairBotWorkerBridge(): WorkerBridge {
  return bridgeFair.get()
}

export function setFairBotWorkerBridge(b: WorkerBridge | null): void {
  bridgeFair.set(b)
}

import { describe, it, expect } from 'vitest'
import { WorkerBridge } from '../../src/ai/workerBridge'
import { setupRound } from '../../src/engine'
import type { GameState, Action } from '../../src/engine'

function freshState(): GameState {
  return setupRound([0, 0], undefined, () => 0.5)
}

class MockWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  terminated = false
  sentData: unknown = null

  postMessage(data: unknown) {
    this.sentData = data
  }

  terminate() {
    this.terminated = true
  }

  respond(action: Action | null) {
    this.onmessage?.({ data: action })
  }

  fail(err: unknown) {
    this.onerror?.(err)
  }
}

describe('WorkerBridge', () => {
  it('resolves with the action returned by the worker', async () => {
    const mockWorker = new MockWorker()
    const bridge = new WorkerBridge(() => mockWorker as unknown as Worker)
    const expectedAction: Action = { type: 'TAKE_CAMELS' }

    const promise = bridge.getAction(freshState())
    mockWorker.respond(expectedAction)
    const result = await promise

    expect(result).toEqual(expectedAction)
    expect(mockWorker.terminated).toBe(true)
  })

  it('resolves with null when worker responds with null', async () => {
    const mockWorker = new MockWorker()
    const bridge = new WorkerBridge(() => mockWorker as unknown as Worker)

    const promise = bridge.getAction(freshState())
    mockWorker.respond(null)
    const result = await promise

    expect(result).toBeNull()
    expect(mockWorker.terminated).toBe(true)
  })

  it('rejects when the worker emits an error', async () => {
    const mockWorker = new MockWorker()
    const bridge = new WorkerBridge(() => mockWorker as unknown as Worker)

    const promise = bridge.getAction(freshState())
    mockWorker.fail(new Error('worker crashed'))

    await expect(promise).rejects.toBeDefined()
    expect(mockWorker.terminated).toBe(true)
  })

  it('posts the state to the worker', async () => {
    const mockWorker = new MockWorker()
    const bridge = new WorkerBridge(() => mockWorker as unknown as Worker)
    const state = freshState()

    const promise = bridge.getAction(state)
    mockWorker.respond({ type: 'TAKE_CAMELS' })
    await promise

    expect(mockWorker.sentData).toEqual(state)
  })
})

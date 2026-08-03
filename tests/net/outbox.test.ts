import { describe, it, expect, vi, beforeEach } from 'vitest'

const move = vi.fn()
vi.mock('../../src/net/online', () => ({ move: (...args: unknown[]) => move(...args) }))

import * as outbox from '../../src/net/outbox'
import { WorkerError } from '../../src/net/http'

const ACTION = { type: 'TAKE_CAMELS' as const }

beforeEach(() => {
  move.mockReset()
  outbox.clear()
})

describe('net/outbox', () => {
  it('save/load round-trips a pending move', () => {
    expect(outbox.load()).toBeNull()
    outbox.save({ gameId: 'ABC', seatIndex: 0, action: ACTION, clientMoveId: 'uuid-1' })
    expect(outbox.load()).toEqual({ gameId: 'ABC', seatIndex: 0, action: ACTION, clientMoveId: 'uuid-1' })
  })

  it('clear empties it', () => {
    outbox.save({ gameId: 'ABC', seatIndex: 0, action: ACTION, clientMoveId: 'uuid-1' })
    outbox.clear()
    expect(outbox.load()).toBeNull()
  })

  it('save overwrites — at most ONE pending move at a time', () => {
    outbox.save({ gameId: 'ABC', seatIndex: 0, action: ACTION, clientMoveId: 'uuid-1' })
    outbox.save({ gameId: 'ABC', seatIndex: 0, action: ACTION, clientMoveId: 'uuid-2' })
    expect(outbox.load()?.clientMoveId).toBe('uuid-2')
  })

  it('drain(gameId) with nothing pending is a no-op', async () => {
    const result = await outbox.drain('ABC')
    expect(result).toBeNull()
    expect(move).not.toHaveBeenCalled()
  })

  it('drain(gameId) with a pending move for a DIFFERENT game is left untouched', async () => {
    outbox.save({ gameId: 'OTHER', seatIndex: 0, action: ACTION, clientMoveId: 'uuid-1' })
    const result = await outbox.drain('ABC')
    expect(result).toBeNull()
    expect(move).not.toHaveBeenCalled()
    expect(outbox.load()).not.toBeNull() // left in place for its own game
  })

  it('drain(gameId) posts the pending move (idempotent via clientMoveId) and clears on success', async () => {
    outbox.save({ gameId: 'ABC', seatIndex: 1, action: ACTION, clientMoveId: 'uuid-1' })
    move.mockResolvedValueOnce({ ok: true, moveIndex: 3, view: { mySeat: 1 } })

    const result = await outbox.drain('ABC')

    expect(move).toHaveBeenCalledWith('ABC', 1, ACTION, 'uuid-1')
    expect(result).toEqual({ view: { mySeat: 1 } })
    expect(outbox.load()).toBeNull()
  })

  it('drain(gameId) treats a {duplicate:true} ack as success (already landed server-side)', async () => {
    outbox.save({ gameId: 'ABC', seatIndex: 0, action: ACTION, clientMoveId: 'uuid-1' })
    move.mockResolvedValueOnce({ duplicate: true, view: { mySeat: 0 } })

    const result = await outbox.drain('ABC')

    expect(result).toEqual({ view: { mySeat: 0 } })
    expect(outbox.load()).toBeNull()
  })

  it('drain(gameId) leaves the entry queued when the repost itself fails (still offline)', async () => {
    outbox.save({ gameId: 'ABC', seatIndex: 0, action: ACTION, clientMoveId: 'uuid-1' })
    move.mockRejectedValueOnce(new TypeError('network down'))

    const result = await outbox.drain('ABC')

    expect(result).toBeNull()
    expect(outbox.load()).not.toBeNull()
  })

  // BUG 8+10 (2026-08-03): a 4xx means the worker definitively rejected the
  // move — it's moot, not transient, so drain must clear it (same rule
  // dispatchOnline already applies to a fresh 4xx) rather than retrying it
  // forever on every future nudge/sync.
  it('drain(gameId) CLEARS the entry on a 409 (definitively rejected — never retried)', async () => {
    outbox.save({ gameId: 'ABC', seatIndex: 0, action: ACTION, clientMoveId: 'uuid-1' })
    move.mockRejectedValueOnce(new WorkerError(409, 'not_your_turn', {}))

    const result = await outbox.drain('ABC')

    expect(result).toBeNull()
    expect(outbox.load()).toBeNull()
  })

  it('drain(gameId) CLEARS the entry on a 404 (definitively rejected — never retried)', async () => {
    outbox.save({ gameId: 'ABC', seatIndex: 0, action: ACTION, clientMoveId: 'uuid-1' })
    move.mockRejectedValueOnce(new WorkerError(404, 'game_not_found', {}))

    const result = await outbox.drain('ABC')

    expect(result).toBeNull()
    expect(outbox.load()).toBeNull()
  })

  it('drain(gameId) RETAINS the entry on a 5xx WorkerError (genuinely unknown outcome — kept for retry)', async () => {
    outbox.save({ gameId: 'ABC', seatIndex: 0, action: ACTION, clientMoveId: 'uuid-1' })
    move.mockRejectedValueOnce(new WorkerError(500, 'http_500', {}))

    const result = await outbox.drain('ABC')

    expect(result).toBeNull()
    expect(outbox.load()).not.toBeNull()
  })

  it('drain(gameId) RETAINS the entry on a plain network error (not a WorkerError at all)', async () => {
    outbox.save({ gameId: 'ABC', seatIndex: 0, action: ACTION, clientMoveId: 'uuid-1' })
    move.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const result = await outbox.drain('ABC')

    expect(result).toBeNull()
    expect(outbox.load()).not.toBeNull()
  })
})

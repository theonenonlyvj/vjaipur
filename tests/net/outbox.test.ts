import { describe, it, expect, vi, beforeEach } from 'vitest'

const move = vi.fn()
vi.mock('../../src/net/online', () => ({ move: (...args: unknown[]) => move(...args) }))

import * as outbox from '../../src/net/outbox'

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
})

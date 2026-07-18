import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const heartbeat = vi.fn()
vi.mock('../../src/net/online', () => ({ heartbeat: (...args: unknown[]) => heartbeat(...args) }))

import * as session from '../../src/net/session'

beforeEach(() => {
  heartbeat.mockReset()
  heartbeat.mockResolvedValue({ ok: true, seat: 0 })
  session.clear()
})

afterEach(() => {
  session.stopHeartbeat()
  vi.useRealTimers()
})

describe('net/session', () => {
  it('save/load round-trips', () => {
    expect(session.load()).toBeNull()
    session.save({ gameId: 'ABC123', code: 'ABC123', mySeat: 1 })
    expect(session.load()).toEqual({ gameId: 'ABC123', code: 'ABC123', mySeat: 1 })
  })

  it('clear empties the persisted session', () => {
    session.save({ gameId: 'ABC123', code: 'ABC123', mySeat: 0 })
    session.clear()
    expect(session.load()).toBeNull()
  })

  it('load() rejects a malformed persisted blob instead of throwing', () => {
    localStorage.setItem('vjaipur-online-session', '{"not":"a session"}')
    expect(session.load()).toBeNull()
    localStorage.setItem('vjaipur-online-session', 'not even json')
    expect(session.load()).toBeNull()
  })

  it('startHeartbeat calls heartbeat(gameId) every 20s', () => {
    vi.useFakeTimers()
    session.startHeartbeat('ABC123')

    expect(heartbeat).not.toHaveBeenCalled()
    vi.advanceTimersByTime(20_000)
    expect(heartbeat).toHaveBeenCalledTimes(1)
    expect(heartbeat).toHaveBeenCalledWith('ABC123')
    vi.advanceTimersByTime(20_000)
    expect(heartbeat).toHaveBeenCalledTimes(2)
  })

  it('starting a new heartbeat loop replaces (does not stack) a prior one', () => {
    vi.useFakeTimers()
    session.startHeartbeat('FIRST')
    vi.advanceTimersByTime(20_000)
    expect(heartbeat).toHaveBeenCalledTimes(1)

    session.startHeartbeat('SECOND')
    vi.advanceTimersByTime(20_000)
    // Only ONE more call (from SECOND) — not two (FIRST's old interval must
    // have been cleared, not left running alongside SECOND's).
    expect(heartbeat).toHaveBeenCalledTimes(2)
    expect(heartbeat).toHaveBeenLastCalledWith('SECOND')
  })

  it('stopHeartbeat halts the loop', () => {
    vi.useFakeTimers()
    session.startHeartbeat('ABC123')
    session.stopHeartbeat()
    vi.advanceTimersByTime(60_000)
    expect(heartbeat).not.toHaveBeenCalled()
  })

  it('clear() also stops the heartbeat loop', () => {
    vi.useFakeTimers()
    session.startHeartbeat('ABC123')
    session.clear()
    vi.advanceTimersByTime(60_000)
    expect(heartbeat).not.toHaveBeenCalled()
  })

  it('a failed heartbeat tick does not crash the loop — the next tick still fires', () => {
    vi.useFakeTimers()
    heartbeat.mockRejectedValueOnce(new TypeError('network down'))
    session.startHeartbeat('ABC123')
    vi.advanceTimersByTime(20_000)
    vi.advanceTimersByTime(20_000)
    expect(heartbeat).toHaveBeenCalledTimes(2)
  })
})

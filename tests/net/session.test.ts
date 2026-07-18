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

  it('startHeartbeat fires immediately, then every 20s', () => {
    vi.useFakeTimers()
    session.startHeartbeat('ABC123')

    // Fires ONE beat immediately so presence is established at kickoff/resume.
    expect(heartbeat).toHaveBeenCalledTimes(1)
    expect(heartbeat).toHaveBeenCalledWith('ABC123')
    vi.advanceTimersByTime(20_000)
    expect(heartbeat).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(20_000)
    expect(heartbeat).toHaveBeenCalledTimes(3)
  })

  it('starting a new heartbeat loop replaces (does not stack) a prior one', () => {
    vi.useFakeTimers()
    session.startHeartbeat('FIRST') // immediate beat #1
    vi.advanceTimersByTime(20_000) // interval beat #2
    expect(heartbeat).toHaveBeenCalledTimes(2)

    session.startHeartbeat('SECOND') // immediate beat #3
    vi.advanceTimersByTime(20_000) // ONE interval beat from SECOND (#4); FIRST's cleared
    expect(heartbeat).toHaveBeenCalledTimes(4)
    expect(heartbeat).toHaveBeenLastCalledWith('SECOND')
  })

  it('stopHeartbeat halts the loop (after the one immediate beat)', () => {
    vi.useFakeTimers()
    session.startHeartbeat('ABC123') // immediate beat #1
    session.stopHeartbeat()
    vi.advanceTimersByTime(60_000)
    expect(heartbeat).toHaveBeenCalledTimes(1) // no interval beats after stop
  })

  it('clear() also stops the heartbeat loop (after the one immediate beat)', () => {
    vi.useFakeTimers()
    session.startHeartbeat('ABC123') // immediate beat #1
    session.clear()
    vi.advanceTimersByTime(60_000)
    expect(heartbeat).toHaveBeenCalledTimes(1)
  })

  it('a failed heartbeat tick does not crash the loop — later ticks still fire', () => {
    vi.useFakeTimers()
    heartbeat.mockRejectedValueOnce(new TypeError('network down')) // the immediate beat rejects
    session.startHeartbeat('ABC123') // immediate beat #1 (rejected)
    vi.advanceTimersByTime(20_000) // #2
    vi.advanceTimersByTime(20_000) // #3
    expect(heartbeat).toHaveBeenCalledTimes(3)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RoomManager } from '../../server/roomManager'

describe('RoomManager', () => {
  let rm: RoomManager

  beforeEach(() => { rm = new RoomManager() })

  it('createRoom returns a 6-char uppercase code', () => {
    const code = rm.createRoom('s1')
    expect(code).toMatch(/^[A-Z0-9]{6}$/)
  })

  it('joinRoom succeeds when room is waiting', () => {
    const code = rm.createRoom('s1')
    const result = rm.joinRoom('s2', code)
    expect(result).toEqual({ playerIndex: 1 })
  })

  it('joinRoom fails for unknown code', () => {
    const result = rm.joinRoom('s1', 'XXXXXX')
    expect(result).toHaveProperty('error')
  })

  it('joinRoom fails when room is full', () => {
    const code = rm.createRoom('s1')
    rm.joinRoom('s2', code)
    expect(rm.joinRoom('s3', code)).toHaveProperty('error')
  })

  it('joinRoom is case-insensitive', () => {
    const code = rm.createRoom('s1')
    expect(rm.joinRoom('s2', code.toLowerCase())).toEqual({ playerIndex: 1 })
  })

  it('quickMatch queues a lone player', () => {
    expect(rm.quickMatch('s1').matched).toBe(false)
    expect(rm.quickMatchQueue).toContain('s1')
  })

  it('quickMatch pairs two players and returns room', () => {
    rm.quickMatch('s1')
    const result = rm.quickMatch('s2')
    expect(result.matched).toBe(true)
    if (result.matched) {
      expect(result.code).toMatch(/^[A-Z0-9]{6}$/)
      expect(result.opponentId).toBe('s1')
    }
  })

  it('getPlayerIndex returns correct index', () => {
    const code = rm.createRoom('s1')
    rm.joinRoom('s2', code)
    expect(rm.getPlayerIndex('s1')).toBe(0)
    expect(rm.getPlayerIndex('s2')).toBe(1)
  })

  it('getOpponentId returns the other socket', () => {
    const code = rm.createRoom('s1')
    rm.joinRoom('s2', code)
    expect(rm.getOpponentId('s1')).toBe('s2')
    expect(rm.getOpponentId('s2')).toBe('s1')
  })

  it('tryGetRoundSeed returns a number on first call for a round', () => {
    const code = rm.createRoom('s1')
    const seed = rm.tryGetRoundSeed(code, 1)
    expect(typeof seed).toBe('number')
    expect(seed).not.toBeNull()
  })

  it('tryGetRoundSeed returns null on second call for same round', () => {
    const code = rm.createRoom('s1')
    rm.tryGetRoundSeed(code, 1)
    expect(rm.tryGetRoundSeed(code, 1)).toBeNull()
  })

  it('startDisconnectTimer calls forfeit callback after 60s', () => {
    vi.useFakeTimers()
    const code = rm.createRoom('s1')
    const cb = vi.fn()
    rm.startDisconnectTimer(code, 0, cb)
    vi.advanceTimersByTime(60_000)
    expect(cb).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('cancelDisconnectTimer prevents the callback', () => {
    vi.useFakeTimers()
    const code = rm.createRoom('s1')
    const cb = vi.fn()
    rm.startDisconnectTimer(code, 0, cb)
    rm.cancelDisconnectTimer(code, 0)
    vi.advanceTimersByTime(60_000)
    expect(cb).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('markDisconnected removes socket from lookup but keeps room slot', () => {
    const code = rm.createRoom('s1')
    rm.joinRoom('s2', code)
    rm.markDisconnected('s1')
    expect(rm.getRoomCode('s1')).toBeNull()
    // Room still exists and slot is still occupied (for reconnect)
    const room = rm.rooms.get(code)!
    expect(room.players[0]).toBe('s1')  // slot preserved for rejoin identification
  })

  it('rejoinRoom reclaims player slot', () => {
    const code = rm.createRoom('s1')
    rm.joinRoom('s2', code)
    rm.markDisconnected('s1')
    const ok = rm.rejoinRoom('s1-new', code, 0)
    expect(ok).toBe(true)
    expect(rm.getPlayerIndex('s1-new')).toBe(0)
  })

  it('removeRoom deletes room and clears socket map', () => {
    const code = rm.createRoom('s1')
    rm.joinRoom('s2', code)
    rm.removeRoom(code)
    expect(rm.rooms.has(code)).toBe(false)
    expect(rm.getRoomCode('s1')).toBeNull()
  })
})

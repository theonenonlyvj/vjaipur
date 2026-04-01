import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockEmit = vi.fn()
const mockOn = vi.fn()
const mockConnect = vi.fn()
const mockDisconnect = vi.fn()
const mockSocket = {
  connected: false,
  connect: mockConnect,
  disconnect: mockDisconnect,
  emit: mockEmit,
  on: mockOn,
}

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocket),
}))

import { SocketService } from '../../src/socket/socketService'
import { EVENTS } from '../../src/shared/protocol'

describe('SocketService', () => {
  let svc: SocketService

  beforeEach(() => {
    vi.clearAllMocks()
    mockSocket.connected = false
    svc = new SocketService()
  })

  it('connect calls socket.io and attaches handlers', () => {
    svc.connect('http://localhost:3001')
    expect(mockOn).toHaveBeenCalledWith(EVENTS.ROOM_READY, expect.any(Function))
    expect(mockOn).toHaveBeenCalledWith(EVENTS.OPPONENT_ACTION, expect.any(Function))
    expect(mockOn).toHaveBeenCalledWith(EVENTS.ROUND_START, expect.any(Function))
    expect(mockOn).toHaveBeenCalledWith(EVENTS.OPPONENT_DISCONNECTED, expect.any(Function))
    expect(mockOn).toHaveBeenCalledWith(EVENTS.FORFEIT, expect.any(Function))
  })

  it('sendAction emits ACTION event', () => {
    svc.connect('http://localhost:3001')
    const action = { type: 'TAKE_CAMELS' as const }
    const state = { phase: 'playing' } as any
    svc.sendAction(action, state)
    expect(mockEmit).toHaveBeenCalledWith(EVENTS.ACTION, { action, state })
  })

  it('quickMatch emits QUICK_MATCH event', () => {
    svc.connect('http://localhost:3001')
    svc.quickMatch()
    expect(mockEmit).toHaveBeenCalledWith(EVENTS.QUICK_MATCH)
  })

  it('sendNextRound emits NEXT_ROUND with round number', () => {
    svc.connect('http://localhost:3001')
    svc.sendNextRound(2)
    expect(mockEmit).toHaveBeenCalledWith(EVENTS.NEXT_ROUND, 2)
  })

  it('onOpponentAction callback fires when OPPONENT_ACTION is received', () => {
    svc.connect('http://localhost:3001')
    const cb = vi.fn()
    svc.onOpponentAction = cb
    const action = { type: 'TAKE_CAMELS' as const }
    const state = { phase: 'playing' } as any
    // Get the handler registered for OPPONENT_ACTION and call it
    const call = mockOn.mock.calls.find(([event]) => event === EVENTS.OPPONENT_ACTION)!
    call[1]({ action, state })
    expect(cb).toHaveBeenCalledWith(action, state)
  })

  it('onRoomReady callback fires with playerIndex and seed', () => {
    svc.connect('http://localhost:3001')
    const cb = vi.fn()
    svc.onRoomReady = cb
    const call = mockOn.mock.calls.find(([event]) => event === EVENTS.ROOM_READY)!
    call[1]({ playerIndex: 1, seed: 42 })
    expect(cb).toHaveBeenCalledWith(1, 42)
  })

  it('disconnect clears socket', () => {
    svc.connect('http://localhost:3001')
    svc.disconnect()
    expect(mockDisconnect).toHaveBeenCalled()
    expect(svc.connected).toBe(false)
  })
})

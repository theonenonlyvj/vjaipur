import type { GameState } from '../src/engine/types'

function randomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export interface Room {
  code: string
  players: [string | null, string | null]
  status: 'waiting' | 'playing'
  lastRoundSeeded: number
  state: GameState | null
  matchLength: number
  disconnectTimers: [ReturnType<typeof setTimeout> | null, ReturnType<typeof setTimeout> | null]
}

export class RoomManager {
  rooms = new Map<string, Room>()
  private socketToRoom = new Map<string, string>()
  quickMatchQueue: string[] = []

  createRoom(socketId: string, matchLength: number = 1): string {
    let code = randomCode()
    while (this.rooms.has(code)) code = randomCode()
    this.rooms.set(code, {
      code,
      players: [socketId, null],
      status: 'waiting',
      lastRoundSeeded: 0,
      state: null,
      matchLength,
      disconnectTimers: [null, null],
    })
    this.socketToRoom.set(socketId, code)
    return code
  }

  joinRoom(socketId: string, code: string): { playerIndex: 1 } | { error: string } {
    const upper = code.toUpperCase()
    const room = this.rooms.get(upper)
    if (!room) return { error: 'Room not found' }
    if (room.players[1] !== null) return { error: 'Room is full' }
    if (room.players[0] === socketId) return { error: 'Already in this room' }
    room.players[1] = socketId
    room.status = 'playing'
    this.socketToRoom.set(socketId, upper)
    return { playerIndex: 1 }
  }

  quickMatch(socketId: string, matchLength: number = 1): { matched: false } | { matched: true; code: string; opponentId: string } {
    if (this.quickMatchQueue.length > 0) {
      const opponentId = this.quickMatchQueue.shift()!
      const code = this.createRoom(opponentId, matchLength)
      const result = this.joinRoom(socketId, code)
      if ('error' in result) return { matched: false }
      return { matched: true, code, opponentId }
    }
    this.quickMatchQueue.push(socketId)
    return { matched: false }
  }

  getPlayerIndex(socketId: string): 0 | 1 | null {
    const code = this.socketToRoom.get(socketId)
    if (!code) return null
    const room = this.rooms.get(code)
    if (!room) return null
    if (room.players[0] === socketId) return 0
    if (room.players[1] === socketId) return 1
    return null
  }

  getOpponentId(socketId: string): string | null {
    const code = this.socketToRoom.get(socketId)
    if (!code) return null
    const room = this.rooms.get(code)
    if (!room) return null
    if (room.players[0] === socketId) return room.players[1]
    if (room.players[1] === socketId) return room.players[0]
    return null
  }

  getRoomCode(socketId: string): string | null {
    return this.socketToRoom.get(socketId) ?? null
  }

  getRoomBySocket(socketId: string): Room | undefined {
    const code = this.socketToRoom.get(socketId)
    return code ? this.rooms.get(code) : undefined
  }

  tryGetRoundSeed(code: string, round: number): number | null {
    const room = this.rooms.get(code)
    if (!room) return null
    if (room.lastRoundSeeded >= round) return null
    const seed = (Math.random() * 2 ** 32) >>> 0
    room.lastRoundSeeded = round
    return seed
  }

  markDisconnected(socketId: string): void {
    this.socketToRoom.delete(socketId)
    const qi = this.quickMatchQueue.indexOf(socketId)
    if (qi !== -1) this.quickMatchQueue.splice(qi, 1)
  }

  startDisconnectTimer(code: string, playerIndex: 0 | 1, onForfeit: () => void): void {
    const room = this.rooms.get(code)
    if (!room) return
    if (room.disconnectTimers[playerIndex]) clearTimeout(room.disconnectTimers[playerIndex]!)
    room.disconnectTimers[playerIndex] = setTimeout(() => {
      room.disconnectTimers[playerIndex] = null
      onForfeit()
    }, 180_000) // 3 minutes
  }

  cancelDisconnectTimer(code: string, playerIndex: 0 | 1): void {
    const room = this.rooms.get(code)
    if (!room) return
    if (room.disconnectTimers[playerIndex]) {
      clearTimeout(room.disconnectTimers[playerIndex]!)
      room.disconnectTimers[playerIndex] = null
    }
  }

  rejoinRoom(socketId: string, code: string, playerIndex: 0 | 1): boolean {
    const room = this.rooms.get(code.toUpperCase())
    if (!room) return false
    const existingId = room.players[playerIndex]
    if (existingId !== null && this.socketToRoom.has(existingId)) return false
    room.players[playerIndex] = socketId
    this.socketToRoom.set(socketId, code.toUpperCase())
    this.cancelDisconnectTimer(code.toUpperCase(), playerIndex)
    return true
  }

  removeRoom(code: string): void {
    const room = this.rooms.get(code)
    if (room) {
      room.players.forEach((sid) => { if (sid) this.socketToRoom.delete(sid) })
      room.disconnectTimers.forEach((t) => { if (t) clearTimeout(t) })
    }
    this.rooms.delete(code)
  }
}

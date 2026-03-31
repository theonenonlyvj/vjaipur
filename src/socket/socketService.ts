import { io, Socket } from 'socket.io-client'
import { EVENTS } from '../shared/protocol'
import type { Action } from '../engine'
import type { RoomReadyPayload, JoinRoomAck, RejoinPayload, RejoinAck, OpponentNamePayload, SyncMatchPayload, RestoreAccountPayload, RestoreAccountAck } from '../shared/protocol'

export class SocketService {
  private socket: Socket | null = null

  connect(url: string): void {
    if (this.socket?.connected) return
    this.socket?.disconnect()
    this.socket = io(url, { autoConnect: true })
    this.socket.on(EVENTS.ROOM_READY, (data: RoomReadyPayload) => {
      this.onRoomReady?.(data.playerIndex, data.seed)
    })
    this.socket.on(EVENTS.OPPONENT_ACTION, (data: { action: Action }) => {
      this.onOpponentAction?.(data.action)
    })
    this.socket.on(EVENTS.ROUND_START, (data: { seed: number }) => {
      this.onRoundStart?.(data.seed)
    })
    this.socket.on(EVENTS.OPPONENT_DISCONNECTED, () => {
      this.onOpponentDisconnected?.()
    })
    this.socket.on(EVENTS.OPPONENT_RECONNECTED, () => {
      this.onOpponentReconnected?.()
    })
    this.socket.on(EVENTS.FORFEIT, () => {
      this.onForfeit?.()
    })
    this.socket.on(EVENTS.OPPONENT_NAME, (data: OpponentNamePayload) => {
      this.onOpponentName?.(data)
    })
    this.socket.on('connect', () => {
      this.onConnect?.()
    })
  }

  disconnect(): void {
    this.socket?.disconnect()
    this.socket = null
  }

  get connected(): boolean {
    return this.socket?.connected ?? false
  }

  createRoom(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error('Not connected'))
      this.socket.emit(EVENTS.CREATE_ROOM, (code: string) => resolve(code))
    })
  }

  joinRoom(code: string): Promise<{ playerIndex: 0 | 1 }> {
    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error('Not connected'))
      this.socket.emit(EVENTS.JOIN_ROOM, code, (ack: JoinRoomAck) => {
        if (!ack.ok) reject(new Error(ack.error ?? 'Join failed'))
        else if (ack.playerIndex === undefined) reject(new Error('Server error: missing playerIndex'))
        else resolve({ playerIndex: ack.playerIndex })
      })
    })
  }

  quickMatch(): void {
    this.socket?.emit(EVENTS.QUICK_MATCH)
  }

  sendAction(action: Action): void {
    this.socket?.emit(EVENTS.ACTION, action)
  }

  sendNextRound(round: number): void {
    this.socket?.emit(EVENTS.NEXT_ROUND, round)
  }

  sendName(name: string, friendCode: string): void {
    this.socket?.emit(EVENTS.SET_NAME, { name, friendCode })
  }

  rejoin(code: string, playerIndex: 0 | 1): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error('Not connected'))
      const payload: RejoinPayload = { code, playerIndex }
      this.socket.emit(EVENTS.REJOIN, payload, (ack: RejoinAck) => {
        if (!ack.ok) reject(new Error('Rejoin failed'))
        else resolve()
      })
    })
  }

  syncMatch(payload: SyncMatchPayload): void {
    this.socket?.emit(EVENTS.SYNC_MATCH, payload)
  }

  restoreAccount(payload: RestoreAccountPayload): Promise<RestoreAccountAck> {
    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error('Not connected'))
      this.socket.emit(EVENTS.RESTORE_ACCOUNT, payload, (ack: RestoreAccountAck) => {
        resolve(ack)
      })
    })
  }

  // Callbacks — wired by gameStore
  onRoomReady: ((playerIndex: 0 | 1, seed: number) => void) | null = null
  onOpponentAction: ((action: Action) => void) | null = null
  onRoundStart: ((seed: number) => void) | null = null
  onOpponentDisconnected: (() => void) | null = null
  onOpponentReconnected: (() => void) | null = null
  onForfeit: (() => void) | null = null
  onConnect: (() => void) | null = null
  onOpponentName: ((data: OpponentNamePayload) => void) | null = null
}

export const socketService = new SocketService()


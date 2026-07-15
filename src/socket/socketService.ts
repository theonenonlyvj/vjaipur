import { io, Socket } from 'socket.io-client'
import { EVENTS } from '../shared/protocol'
import type { Action, GameState } from '../engine'
import type { RoomReadyPayload, JoinRoomAck, RejoinPayload, RejoinAck, OpponentNamePayload, SyncMatchPayload, ActionPayload, OpponentActionPayload, OpponentDisconnectedPayload, LeaderboardAck, UpdateProfilePayload, PullHistoryPayload, PullHistoryAck } from '../shared/protocol'

export class SocketService {
  private socket: Socket | null = null

  connect(url: string, vgamesToken?: string): void {
    if (this.socket?.connected) return
    if (this.socket && !this.socket.disconnected) return // Already connecting

    console.log('Connecting to socket server at:', url)
    this.socket = io(url, {
      autoConnect: true,
      reconnectionAttempts: 5,
      timeout: 10000,
      // VGames Identity JWT, sent at connect/join so the server can verify it
      // via /auth/introspect (see server/vgamesAuth.ts). Absent for anonymous
      // pre-account connections — the server treats those as unauthenticated.
      ...(vgamesToken ? { auth: { token: vgamesToken } } : {}),
    })

    this.socket.on('connect_error', (err) => {
      console.error('Socket connection error:', err.message)
    })

    this.socket.on(EVENTS.ROOM_READY, (data: RoomReadyPayload) => {
      this.onRoomReady?.(data.playerIndex, data.seed, data.matchLength)
    })
    this.socket.on(EVENTS.OPPONENT_ACTION, (data: OpponentActionPayload) => {
      this.onOpponentAction?.(data.action, data.state)
    })
    this.socket.on(EVENTS.ROUND_START, (data: { seed: number }) => {
      this.onRoundStart?.(data.seed)
    })
    this.socket.on(EVENTS.OPPONENT_DISCONNECTED, (data: OpponentDisconnectedPayload) => {
      this.onOpponentDisconnected?.(data)
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

  /**
   * Updates the VGames auth token the socket presents on its next (re)connect.
   * Does not force an immediate reconnect of an already-open socket — just
   * keeps the handshake current so a later drop/reconnect (or a fresh
   * connect() call) re-joins as the now-known account instead of anonymous.
   */
  setAuthToken(vgamesToken: string | null): void {
    if (!this.socket) return
    ;(this.socket as any).auth = vgamesToken ? { token: vgamesToken } : {}
  }

  get connected(): boolean {
    return this.socket?.connected ?? false
  }

  createRoom(matchLength: number): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error('Not connected'))
      this.socket.emit(EVENTS.CREATE_ROOM, matchLength, (code: string) => resolve(code))
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

  quickMatch(matchLength: number): void {
    this.socket?.emit(EVENTS.QUICK_MATCH, matchLength)
  }

  sendAction(action: Action, state: GameState): void {
    this.socket?.emit(EVENTS.ACTION, { action, state })
  }

  sendNextRound(round: number): void {
    this.socket?.emit(EVENTS.NEXT_ROUND, round)
  }

  sendName(name: string, friendCode: string): void {
    this.socket?.emit(EVENTS.SET_NAME, { name, friendCode })
  }

  rejoin(code: string, playerIndex: 0 | 1): Promise<RejoinAck> {
    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error('Not connected'))
      const payload: RejoinPayload = { code, playerIndex }
      this.socket.emit(EVENTS.REJOIN, payload, (ack: RejoinAck) => {
        if (!ack.ok) reject(new Error('Rejoin failed'))
        else resolve(ack)
      })
    })
  }

  syncMatch(payload: SyncMatchPayload): void {
    this.socket?.emit(EVENTS.SYNC_MATCH, payload)
  }

  checkUsername(name: string): Promise<{ available: boolean }> {
    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error('Not connected'))
      this.socket.emit(EVENTS.CHECK_USERNAME, { name }, (ack: { available: boolean }) => {
        resolve(ack)
      })
    })
  }

  updateProfile(payload: UpdateProfilePayload): void {
    this.socket?.emit(EVENTS.UPDATE_PROFILE, payload)
  }

  forceForfeit(): void {
    this.socket?.emit(EVENTS.FORCE_FORFEIT)
  }

  getLeaderboard(): Promise<LeaderboardAck> {
    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error('Not connected'))
      this.socket.emit(EVENTS.GET_LEADERBOARD, (ack: LeaderboardAck) => resolve(ack))
    })
  }

  /**
   * Fetch the signed-in VGames account's own match history from the server
   * (cross-device restore). The token in the payload is what the server
   * introspects, so this works over an anonymous-handshake socket too.
   */
  pullHistory(payload: PullHistoryPayload): Promise<PullHistoryAck> {
    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error('Not connected'))
      this.socket.emit(EVENTS.PULL_HISTORY, payload, (ack: PullHistoryAck) => resolve(ack))
    })
  }

  // Callbacks — wired by gameStore
  onRoomReady: ((playerIndex: 0 | 1, seed: number, matchLength: number) => void) | null = null
  onOpponentAction: ((action: Action, state?: GameState) => void) | null = null
  onRoundStart: ((seed: number) => void) | null = null
  onOpponentDisconnected: ((data: OpponentDisconnectedPayload) => void) | null = null
  onOpponentReconnected: (() => void) | null = null
  onForfeit: (() => void) | null = null
  onConnect: (() => void) | null = null
  onOpponentName: ((data: OpponentNamePayload) => void) | null = null
}

export const socketService = new SocketService()


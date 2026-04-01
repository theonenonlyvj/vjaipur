import type { Action, GameState } from '../engine'

export const EVENTS = {
  // Client → Server
  CREATE_ROOM:  'create_room',
  JOIN_ROOM:    'join_room',
  QUICK_MATCH:  'quick_match',
  ACTION:       'action',
  NEXT_ROUND:   'next_round',
  REJOIN:       'rejoin',
  SET_NAME:     'set_name',
  SYNC_MATCH:   'sync_match',
  RESTORE_ACCOUNT: 'restore_account',
  CHECK_USERNAME: 'check_username',
  UPDATE_PROFILE: 'update_profile',
  SECURE_ACCOUNT: 'secure_account',
  FORCE_FORFEIT:  'force_forfeit',
  // Server → Client
  ROOM_READY:            'room_ready',
  OPPONENT_ACTION:       'opponent_action',
  ROUND_START:           'round_start',
  OPPONENT_DISCONNECTED: 'opponent_disconnected',
  OPPONENT_RECONNECTED:  'opponent_reconnected',
  FORFEIT:               'forfeit',
  OPPONENT_NAME:         'opponent_name',
} as const

export type EventName = typeof EVENTS[keyof typeof EVENTS]

export interface RoomReadyPayload    { playerIndex: 0 | 1; seed: number; matchLength: number }
export interface ActionPayload       { action: Action; state: GameState }
export interface OpponentActionPayload { action: Action; state?: GameState }
export interface RoundStartPayload   { seed: number }
export interface JoinRoomAck         { ok: boolean; error?: string; playerIndex?: 0 | 1 }
export interface RejoinPayload       { code: string; playerIndex: 0 | 1 }
export interface RejoinAck           { ok: boolean; playerIndex?: 0 | 1; state?: GameState | null }
export interface SetNamePayload      { name: string; friendCode: string }
export interface OpponentNamePayload { name: string; friendCode: string }
export interface OpponentDisconnectedPayload { timestamp: number }

export interface SyncMatchPayload {
  friendCode?: string
  secretKey?: string
  username?: string
  password?: string
  displayName?: string
  match: {
    opponent_type: string
    opponent_id?: string | null
    player_score: number
    opponent_score: number
    won: boolean
    timestamp: number
  }
}

export interface RestoreAccountPayload {
  username?: string
  password?: string
  friendCode?: string
  secretKey?: string
}

export interface RestoreAccountAck {
  ok: boolean
  friendCode?: string
  secretKey?: string
  matches?: any[]
  displayName?: string | null
  error?: string
}

export interface SecureAccountPayload {
  friendCode: string
  username: string
  password: string
}

export interface SecureAccountAck {
  ok: boolean
  error?: string
}

export type { GameState }

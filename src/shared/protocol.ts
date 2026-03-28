import type { Action } from '../engine'

export const EVENTS = {
  // Client → Server
  CREATE_ROOM:  'create_room',
  JOIN_ROOM:    'join_room',
  QUICK_MATCH:  'quick_match',
  ACTION:       'action',
  NEXT_ROUND:   'next_round',
  REJOIN:       'rejoin',
  // Server → Client
  ROOM_READY:            'room_ready',
  OPPONENT_ACTION:       'opponent_action',
  ROUND_START:           'round_start',
  OPPONENT_DISCONNECTED: 'opponent_disconnected',
  OPPONENT_RECONNECTED:  'opponent_reconnected',
  FORFEIT:               'forfeit',
} as const

export type EventName = typeof EVENTS[keyof typeof EVENTS]

export interface RoomReadyPayload    { playerIndex: 0 | 1; seed: number }
export interface OpponentActionPayload { action: Action }
export interface RoundStartPayload   { seed: number }
export interface JoinRoomAck         { ok: boolean; error?: string; playerIndex?: 0 | 1 }
export interface RejoinPayload       { code: string; playerIndex: 0 | 1 }
export interface RejoinAck           { ok: boolean; playerIndex?: 0 | 1 }

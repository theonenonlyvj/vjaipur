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
  GET_LEADERBOARD: 'get_leaderboard',
  PULL_HISTORY: 'pull_history',
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
  /** VGames Identity JWT (see src/auth/vgamesClient.ts). Server introspects
   *  this to resolve the canonical accountId; replaces the old
   *  friendCode/secretKey/username/password identity fields below, which are
   *  kept optional only so a not-yet-upgraded client doesn't crash. */
  vgamesToken?: string
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

export interface UpdateProfilePayload {
  /** VGames Identity JWT — see SyncMatchPayload. Server introspects this to
   *  resolve the canonical accountId and mirrors displayName onto that
   *  account's Supabase row (ensurePlayerForVGames); an invalid/missing
   *  token is a no-op. Replaces the old friendCode/secretKey plaintext
   *  comparison, which let anyone who could guess a friendCode overwrite
   *  that account's display name with no proof of ownership. */
  vgamesToken?: string
  displayName: string
}

export interface LeaderboardRow {
  display_name: string
  opponent_type: string
  games: number
  wins: number
  avg_delta: number
}

export interface LeaderboardAck {
  ok: boolean
  rows: LeaderboardRow[]
}

export interface PullHistoryPayload {
  /** VGames Identity JWT — the server introspects it to resolve the caller's
   *  canonical accountId, then returns ONLY that account's own match history
   *  (see server/index.ts PULL_HISTORY). Powers cross-device stat restore. */
  vgamesToken?: string
}

export interface PullHistoryMatch {
  opponent_type: string
  opponent_id?: string | null
  player_score: number
  opponent_score: number
  won: boolean
  timestamp: number | string
}

export interface PullHistoryAck {
  ok: boolean
  matches?: PullHistoryMatch[]
  displayName?: string | null
  friendCode?: string | null
  error?: string
}

export type { GameState }

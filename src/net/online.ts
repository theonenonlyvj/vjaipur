// Typed calls against the vjaipur-worker (worker/src/index.ts routes +
// worker/src/game-do.ts's per-game surface). gameId === room code — see
// index.ts's `stubFor` docstring. The auth token is resolved internally from
// statsStore (never passed by the caller) so gameStore call sites stay terse.
import type { Action } from '../engine'
import { useStatsStore } from '../store/statsStore'
import { workerFetch } from './http'
import type {
  CreateGameResponse,
  HeartbeatResponse,
  HistoryResponse,
  JoinResponse,
  LeaderboardResponse,
  LeaveResponse,
  MoveResult,
  MyGamesResponse,
  NextRoundResult,
  ReclaimResponse,
  ReportMatchBody,
  ReportMatchResult,
  ResignResponse,
  ResolveResponse,
  SyncResponse,
  WaitingRoomView,
} from './types'

function authToken(): string | null {
  return useStatsStore.getState().vgamesToken
}

export type MatchLength = 1 | 3 | 5

export async function createGame(matchLength: MatchLength): Promise<CreateGameResponse> {
  return workerFetch<CreateGameResponse>('/games', { method: 'POST', body: { matchLength }, token: authToken() })
}

export async function resolveCode(code: string): Promise<ResolveResponse> {
  return workerFetch<ResolveResponse>(`/resolve?code=${encodeURIComponent(code)}`, { method: 'GET' })
}

export async function join(gameId: string, displayName?: string): Promise<JoinResponse> {
  return workerFetch<JoinResponse>(`/games/${encodeURIComponent(gameId)}/join`, {
    method: 'POST',
    body: { displayName },
    token: authToken(),
  })
}

/** Returns either the active-game shape (`{moveIndex, view, moves}`) or,
 *  while the room is still `'waiting'`, the roster-only `WaitingRoomView`
 *  (no `moveIndex`/`moves` keys) — callers branch on `'moves' in result`. */
export async function sync(gameId: string, since = 0): Promise<SyncResponse | WaitingRoomView> {
  return workerFetch<SyncResponse | WaitingRoomView>(
    `/games/${encodeURIComponent(gameId)}/sync?since=${since}`,
    { method: 'GET', token: authToken() },
  )
}

/** POST /move — safe to retry on 5xx/network: `clientMoveId` is idempotent
 *  server-side (worker/src/do/apply.ts's idempotency check). */
export async function move(gameId: string, seatIndex: 0 | 1, action: Action, clientMoveId: string): Promise<MoveResult> {
  return workerFetch<MoveResult>(`/games/${encodeURIComponent(gameId)}/move`, {
    method: 'POST',
    body: { seatIndex, move: action, clientMoveId },
    token: authToken(),
    retryOn5xx: true,
  })
}

export async function nextRound(gameId: string): Promise<NextRoundResult> {
  return workerFetch<NextRoundResult>(`/games/${encodeURIComponent(gameId)}/next-round`, {
    method: 'POST',
    body: {},
    token: authToken(),
  })
}

export async function resign(gameId: string): Promise<ResignResponse> {
  return workerFetch<ResignResponse>(`/games/${encodeURIComponent(gameId)}/resign`, {
    method: 'POST',
    body: {},
    token: authToken(),
  })
}

/** POST /heartbeat — idempotent refresh; safe to retry on 5xx/network. */
export async function heartbeat(gameId: string): Promise<HeartbeatResponse> {
  return workerFetch<HeartbeatResponse>(`/games/${encodeURIComponent(gameId)}/heartbeat`, {
    method: 'POST',
    body: {},
    token: authToken(),
    retryOn5xx: true,
  })
}

export async function reclaim(gameId: string): Promise<ReclaimResponse> {
  return workerFetch<ReclaimResponse>(`/games/${encodeURIComponent(gameId)}/reclaim`, {
    method: 'POST',
    body: {},
    token: authToken(),
  })
}

export async function leave(gameId: string): Promise<LeaveResponse> {
  return workerFetch<LeaveResponse>(`/games/${encodeURIComponent(gameId)}/leave`, {
    method: 'POST',
    body: {},
    token: authToken(),
  })
}

export async function myGames(): Promise<MyGamesResponse> {
  return workerFetch<MyGamesResponse>('/my-games', { method: 'GET', token: authToken() })
}

export async function leaderboard(): Promise<LeaderboardResponse> {
  return workerFetch<LeaderboardResponse>('/stats/leaderboard', { method: 'GET' })
}

export async function history(): Promise<HistoryResponse> {
  return workerFetch<HistoryResponse>('/stats/history', { method: 'GET', token: authToken() })
}

export async function reportMatch(body: ReportMatchBody): Promise<ReportMatchResult> {
  return workerFetch<ReportMatchResult>('/stats/report', { method: 'POST', body, token: authToken() })
}

export type {
  ClientMove,
  ClientPlayer,
  ClientView,
  HistoryResponse,
  LeaderboardResponse,
  LeaderboardRow,
  MatchHistoryRow,
  MatchPhase,
  ReportMatchBody,
  SyncResponse,
  WaitingRoomView,
} from './types'

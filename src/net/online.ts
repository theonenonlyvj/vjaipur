// Typed calls against the vjaipur-worker (worker/src/index.ts routes +
// worker/src/game-do.ts's per-game surface). gameId === room code — see
// index.ts's `stubFor` docstring. The auth token is resolved internally from
// statsStore (never passed by the caller) so gameStore call sites stay terse.
import type { Action } from '../engine'
import { useStatsStore } from '../store/statsStore'
import { workerFetch } from './http'
import type {
  ClaimWinResponse,
  CreateGameResponse,
  HeartbeatResponse,
  HistoryResponse,
  JoinResponse,
  LeaderboardResponse,
  LeaveResponse,
  MoveResult,
  MyGamesResponse,
  MyStyleResponse,
  NextRoundResult,
  ReclaimResponse,
  ReportMatchBody,
  ReportMatchResult,
  ResignResponse,
  ResolveResponse,
  RivalryResponse,
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

/** POST /games/:id/claim-win — the present player's manual resolution once
 *  the opponent has genuinely, continuously gone dark (no more AI takeover —
 *  see worker/src/game-do.ts#handleClaimWin). 409 `opponent_present` when
 *  the worker's own grace check hasn't cleared yet; surfaced as a
 *  WorkerError for the caller to branch on, same pattern as move()'s 4xx. */
export async function claimWin(gameId: string): Promise<ClaimWinResponse> {
  return workerFetch<ClaimWinResponse>(`/games/${encodeURIComponent(gameId)}/claim-win`, {
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

/** GET /stats/leaderboard[?opponentType=] — omit `opponentType` for the
 *  unfiltered "All" board (the only call that carries `availableOpponents` —
 *  see worker/src/do/stats.ts's LeaderboardResponse docstring). Also accepts
 *  a LIST of ids (joined with commas, e.g. `hard2,ismcts,hard,fair`) — the
 *  worker aggregates matches across all of them into one board (see
 *  StatsDashboard.tsx's "All Hard" family drill-down default). Each id is
 *  individually `encodeURIComponent`-ed but the commas themselves are left
 *  literal, matching exactly what worker/src/index.ts's route splits on. */
export async function leaderboard(opponentType?: string | string[]): Promise<LeaderboardResponse> {
  const ids = Array.isArray(opponentType) ? opponentType : opponentType ? [opponentType] : []
  const qs = ids.length ? `?opponentType=${ids.map(encodeURIComponent).join(',')}` : ''
  return workerFetch<LeaderboardResponse>(`/stats/leaderboard${qs}`, { method: 'GET' })
}

export async function history(): Promise<HistoryResponse> {
  return workerFetch<HistoryResponse>('/stats/history', { method: 'GET', token: authToken() })
}

export async function reportMatch(body: ReportMatchBody): Promise<ReportMatchResult> {
  return workerFetch<ReportMatchResult>('/stats/report', { method: 'POST', body, token: authToken() })
}

/** GET /stats/my-style?tier= (authed) — the "MY STYLE" (You vs the Bot) tab's
 *  only data source. Server-side lazy + incrementally cached (see
 *  worker/src/do/style.ts) — this call itself is what triggers computation;
 *  callers (StatsDashboard.tsx) must only invoke it on first activation of
 *  the tab, never eagerly, to preserve the zero-idle-compute contract for a
 *  player who never opens it. */
export async function myStyle(tier: string): Promise<MyStyleResponse> {
  return workerFetch<MyStyleResponse>(`/stats/my-style?tier=${encodeURIComponent(tier)}`, { method: 'GET', token: authToken() })
}

/** GET /stats/rivalry?opponent= (authed) — the RIVALRY modal's only data
 *  source (StatsDashboard.tsx: clicking an Online Rival). On-demand only,
 *  same zero-idle-compute contract as myStyle above (see
 *  worker/src/do/rivalry.ts's docstring) — callers must only invoke this on
 *  click, never eagerly, and should cache the result per opponent for the
 *  session (re-opening the same rival's modal should not re-fetch). 404s as
 *  a WorkerError (code 'no_shared_games') when the two accounts have never
 *  shared both seats of a completed/resigned match.
 */
export async function rivalry(opponentId: string): Promise<RivalryResponse> {
  return workerFetch<RivalryResponse>(`/stats/rivalry?opponent=${encodeURIComponent(opponentId)}`, { method: 'GET', token: authToken() })
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
  MyStyleAvailableTier,
  MyStyleResponse,
  ReportMatchBody,
  RivalryBiggestGame,
  RivalryBonusSales,
  RivalryCraft,
  RivalryGamesRecord,
  RivalryMatchesRecord,
  RivalryPerGameEntry,
  RivalryRecord,
  RivalryResponse,
  RivalryStreak,
  RivalryTokensPerCard,
  RivalryTotals,
  StyleFinalized,
  SyncResponse,
  WaitingRoomView,
} from './types'

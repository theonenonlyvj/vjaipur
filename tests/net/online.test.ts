import { describe, it, expect, vi, beforeEach } from 'vitest'

const workerFetch = vi.fn()
vi.mock('../../src/net/http', async () => {
  const actual = await vi.importActual<typeof import('../../src/net/http')>('../../src/net/http')
  return { ...actual, workerFetch: (...args: unknown[]) => workerFetch(...args) }
})

let vgamesToken: string | null = 'tok-abc'
vi.mock('../../src/store/statsStore', () => ({
  useStatsStore: { getState: () => ({ vgamesToken }) },
}))

import * as onlineApi from '../../src/net/online'

beforeEach(() => {
  workerFetch.mockReset()
  vgamesToken = 'tok-abc'
})

describe('net/online typed calls', () => {
  it('createGame POSTs /games with matchLength and the current token', async () => {
    workerFetch.mockResolvedValueOnce({ gameId: 'ABC123', code: 'ABC123', view: { status: 'waiting' } })
    const result = await onlineApi.createGame(3)
    expect(workerFetch).toHaveBeenCalledWith('/games', { method: 'POST', body: { matchLength: 3 }, token: 'tok-abc' })
    expect(result.gameId).toBe('ABC123')
  })

  it('resolveCode GETs /resolve?code= with no token (public route)', async () => {
    workerFetch.mockResolvedValueOnce({ gameId: 'ABC123', status: 'active' })
    await onlineApi.resolveCode('ABC123')
    expect(workerFetch).toHaveBeenCalledWith('/resolve?code=ABC123', { method: 'GET' })
  })

  it('join POSTs /games/:id/join with displayName + token', async () => {
    workerFetch.mockResolvedValueOnce({ seatIndex: 1, status: 'active', view: {} })
    await onlineApi.join('ABC123', 'Vijay')
    expect(workerFetch).toHaveBeenCalledWith('/games/ABC123/join', {
      method: 'POST', body: { displayName: 'Vijay' }, token: 'tok-abc',
    })
  })

  it('sync GETs /games/:id/sync?since=', async () => {
    workerFetch.mockResolvedValueOnce({ moveIndex: 5, view: {}, moves: [] })
    await onlineApi.sync('ABC123', 5)
    expect(workerFetch).toHaveBeenCalledWith('/games/ABC123/sync?since=5', { method: 'GET', token: 'tok-abc' })
  })

  it('sync defaults since to 0', async () => {
    workerFetch.mockResolvedValueOnce({ moveIndex: 0, view: {}, moves: [] })
    await onlineApi.sync('ABC123')
    expect(workerFetch).toHaveBeenCalledWith('/games/ABC123/sync?since=0', { method: 'GET', token: 'tok-abc' })
  })

  it('move POSTs /games/:id/move with seatIndex/move/clientMoveId and opts into 5xx retry', async () => {
    workerFetch.mockResolvedValueOnce({ ok: true, moveIndex: 1, view: {} })
    const action = { type: 'TAKE_CAMELS' as const }
    await onlineApi.move('ABC123', 0, action, 'uuid-1')
    expect(workerFetch).toHaveBeenCalledWith('/games/ABC123/move', {
      method: 'POST', body: { seatIndex: 0, move: action, clientMoveId: 'uuid-1' }, token: 'tok-abc', retryOn5xx: true,
    })
  })

  it('nextRound POSTs /games/:id/next-round', async () => {
    workerFetch.mockResolvedValueOnce({ view: {} })
    await onlineApi.nextRound('ABC123')
    expect(workerFetch).toHaveBeenCalledWith('/games/ABC123/next-round', { method: 'POST', body: {}, token: 'tok-abc' })
  })

  it('resign POSTs /games/:id/resign', async () => {
    workerFetch.mockResolvedValueOnce({ view: {} })
    await onlineApi.resign('ABC123')
    expect(workerFetch).toHaveBeenCalledWith('/games/ABC123/resign', { method: 'POST', body: {}, token: 'tok-abc' })
  })

  it('claimWin POSTs /games/:id/claim-win', async () => {
    workerFetch.mockResolvedValueOnce({ view: {} })
    await onlineApi.claimWin('ABC123')
    expect(workerFetch).toHaveBeenCalledWith('/games/ABC123/claim-win', { method: 'POST', body: {}, token: 'tok-abc' })
  })

  it('heartbeat POSTs /games/:id/heartbeat and opts into 5xx retry', async () => {
    workerFetch.mockResolvedValueOnce({ ok: true, seat: 0 })
    await onlineApi.heartbeat('ABC123')
    expect(workerFetch).toHaveBeenCalledWith('/games/ABC123/heartbeat', {
      method: 'POST', body: {}, token: 'tok-abc', retryOn5xx: true,
    })
  })

  it('reclaim POSTs /games/:id/reclaim', async () => {
    workerFetch.mockResolvedValueOnce({ moveIndex: 4, view: {} })
    await onlineApi.reclaim('ABC123')
    expect(workerFetch).toHaveBeenCalledWith('/games/ABC123/reclaim', { method: 'POST', body: {}, token: 'tok-abc' })
  })

  it('leave POSTs /games/:id/leave', async () => {
    workerFetch.mockResolvedValueOnce({ ok: true, seat: 0 })
    await onlineApi.leave('ABC123')
    expect(workerFetch).toHaveBeenCalledWith('/games/ABC123/leave', { method: 'POST', body: {}, token: 'tok-abc' })
  })

  it('myGames GETs /my-games', async () => {
    workerFetch.mockResolvedValueOnce({ games: [] })
    await onlineApi.myGames()
    expect(workerFetch).toHaveBeenCalledWith('/my-games', { method: 'GET', token: 'tok-abc' })
  })

  it('leaderboard GETs /stats/leaderboard with no token (public route)', async () => {
    workerFetch.mockResolvedValueOnce({ overall: [], verified: [] })
    await onlineApi.leaderboard()
    expect(workerFetch).toHaveBeenCalledWith('/stats/leaderboard', { method: 'GET' })
  })

  it('history GETs /stats/history with the token', async () => {
    workerFetch.mockResolvedValueOnce({ matches: [] })
    await onlineApi.history()
    expect(workerFetch).toHaveBeenCalledWith('/stats/history', { method: 'GET', token: 'tok-abc' })
  })

  it('reportMatch POSTs /stats/report with the body + token', async () => {
    workerFetch.mockResolvedValueOnce({ ok: true })
    const body = { opponent_type: 'easy', player_score: 40, opponent_score: 30, won: true, timestamp: 123 }
    await onlineApi.reportMatch(body)
    expect(workerFetch).toHaveBeenCalledWith('/stats/report', { method: 'POST', body, token: 'tok-abc' })
  })

  it('resolves the token at CALL time, not import time (a later-minted token is used)', async () => {
    vgamesToken = null
    workerFetch.mockResolvedValueOnce({ matches: [] })
    // Simulate ensureVGamesAccount having landed between calls.
    vgamesToken = 'minted-later'
    await onlineApi.history()
    expect(workerFetch).toHaveBeenCalledWith('/stats/history', { method: 'GET', token: 'minted-later' })
  })
})

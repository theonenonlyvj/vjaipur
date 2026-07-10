import { describe, it, expect, vi, beforeEach } from 'vitest'

// Use vi.hoisted to ensure the mock object is available during vi.mock hoisting
const { mockSupabase } = vi.hoisted(() => ({
  mockSupabase: {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    single: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
  }
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockSupabase)
}))

// Now import the functions to test
import {
  getPlayerByCode,
  createPlayer, recordMatch, getPlayerMatches, ensurePlayerForVGames
} from '../../server/db'

describe('db.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset the chainable mocks to return mockSupabase
    mockSupabase.from.mockReturnThis()
    mockSupabase.select.mockReturnThis()
    mockSupabase.insert.mockReturnThis()
    mockSupabase.update.mockReturnThis()
    mockSupabase.eq.mockReturnThis()
    mockSupabase.ilike.mockReturnThis()
    mockSupabase.single.mockReturnThis()
    mockSupabase.order.mockReturnThis()
  })

  it('getPlayerByCode calls supabase select and eq', async () => {
    mockSupabase.single.mockResolvedValue({ data: { id: '123' }, error: null })

    const player = await getPlayerByCode('ABCDEF')

    expect(mockSupabase.from).toHaveBeenCalledWith('players')
    expect(mockSupabase.select).toHaveBeenCalledWith('*')
    expect(mockSupabase.eq).toHaveBeenCalledWith('friend_code', 'ABCDEF')
    expect(player).toEqual({ id: '123' })
  })

  it('createPlayer calls supabase insert', async () => {
    mockSupabase.single.mockResolvedValue({ data: { id: '123' }, error: null })

    const player = await createPlayer('ABCDEF', 'secret', 'Player1')

    expect(mockSupabase.from).toHaveBeenCalledWith('players')
    expect(mockSupabase.insert).toHaveBeenCalledWith([{ friend_code: 'ABCDEF', secret_key: 'secret', display_name: 'Player1' }])
    expect(player).toEqual({ id: '123' })
  })

  it('recordMatch calls supabase insert', async () => {
    mockSupabase.insert.mockResolvedValue({ error: null })

    const match = {
      player_id: '123',
      opponent_type: 'ai_easy',
      opponent_id: null,
      player_score: 100,
      opponent_score: 80,
      won: true
    }
    await recordMatch(match)

    expect(mockSupabase.from).toHaveBeenCalledWith('matches')
    expect(mockSupabase.insert).toHaveBeenCalledWith([match])
  })

  it('getPlayerMatches calls supabase select and order', async () => {
    mockSupabase.order.mockResolvedValue({ data: [{ id: 'm1' }], error: null })

    const matches = await getPlayerMatches('123')

    expect(mockSupabase.from).toHaveBeenCalledWith('matches')
    expect(mockSupabase.select).toHaveBeenCalledWith('*')
    expect(mockSupabase.eq).toHaveBeenCalledWith('player_id', '123')
    expect(matches).toEqual([{ id: 'm1' }])
  })

  // ── VGames dual-run bridge (Task C4) ─────────────────────────────────────
  // ensurePlayerForVGames provisions/finds a Supabase `players` row keyed by
  // the new nullable `players.vgames_account_id`, so the existing
  // getLeaderboard()/matches machinery keeps working unchanged while vjaipur
  // runs dual (VGames Identity for auth, Supabase for match/leaderboard
  // storage). It must be idempotent (no duplicate rows) and fail-closed (a
  // lookup/write error returns null so callers block the match write instead
  // of orphaning it).
  describe('ensurePlayerForVGames', () => {
    it('returns the existing linked player row without inserting (idempotent)', async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: 'p1', vgames_account_id: 'acc1', display_name: 'Vee', friend_code: 'VG-1234' },
        error: null,
      })

      const player = await ensurePlayerForVGames('acc1', 'Vee')

      expect(mockSupabase.from).toHaveBeenCalledWith('players')
      expect(mockSupabase.eq).toHaveBeenCalledWith('vgames_account_id', 'acc1')
      expect(mockSupabase.insert).not.toHaveBeenCalled()
      expect(player).toEqual({ id: 'p1', vgames_account_id: 'acc1', display_name: 'Vee', friend_code: 'VG-1234' })
    })

    it('mirrors a changed display_name onto the existing linked row', async () => {
      mockSupabase.single
        .mockResolvedValueOnce({
          data: { id: 'p1', vgames_account_id: 'acc1', display_name: 'OldName', friend_code: 'VG-1234' },
          error: null,
        })
        .mockResolvedValueOnce({
          data: { id: 'p1', vgames_account_id: 'acc1', display_name: 'NewName', friend_code: 'VG-1234' },
          error: null,
        })

      const player = await ensurePlayerForVGames('acc1', 'NewName')

      expect(mockSupabase.update).toHaveBeenCalledWith({ display_name: 'NewName' })
      expect(player?.display_name).toBe('NewName')
    })

    it('creates a new row keyed by vgames_account_id when none exists (create-only, no plaintext secret)', async () => {
      mockSupabase.single
        .mockResolvedValueOnce({ data: null, error: { code: 'PGRST116' } }) // not found
        .mockResolvedValueOnce({
          data: { id: 'p2', vgames_account_id: 'acc2', display_name: 'Newbie', friend_code: 'VG-4242' },
          error: null,
        })

      const player = await ensurePlayerForVGames('acc2', 'Newbie')

      expect(mockSupabase.insert).toHaveBeenCalledTimes(1)
      const [insertedRows] = mockSupabase.insert.mock.calls[0]
      expect(insertedRows[0]).toMatchObject({ vgames_account_id: 'acc2', display_name: 'Newbie' })
      expect(player).toEqual({ id: 'p2', vgames_account_id: 'acc2', display_name: 'Newbie', friend_code: 'VG-4242' })
    })

    it('is idempotent across repeated calls for the same accountId (no duplicate insert)', async () => {
      mockSupabase.single
        .mockResolvedValueOnce({ data: null, error: { code: 'PGRST116' } })
        .mockResolvedValueOnce({ data: { id: 'p3', vgames_account_id: 'acc3', display_name: 'A' }, error: null })
        .mockResolvedValueOnce({ data: { id: 'p3', vgames_account_id: 'acc3', display_name: 'A' }, error: null })

      const first = await ensurePlayerForVGames('acc3', 'A')
      const second = await ensurePlayerForVGames('acc3', 'A')

      expect(mockSupabase.insert).toHaveBeenCalledTimes(1)
      expect(first?.id).toBe('p3')
      expect(second?.id).toBe('p3')
    })

    it('fails closed (returns null) when the lookup errors', async () => {
      mockSupabase.single.mockResolvedValueOnce({ data: null, error: { code: 'CONNECTION_ERROR', message: 'boom' } })

      const player = await ensurePlayerForVGames('acc4', 'X')

      expect(player).toBeNull()
      expect(mockSupabase.insert).not.toHaveBeenCalled()
    })

    it('fails closed (returns null) when the insert errors', async () => {
      mockSupabase.single
        .mockResolvedValueOnce({ data: null, error: { code: 'PGRST116' } })
        .mockResolvedValueOnce({ data: null, error: { code: 'SOME_ERROR', message: 'insert boom' } })

      const player = await ensurePlayerForVGames('acc5', 'Y')

      expect(player).toBeNull()
    })
  })
})

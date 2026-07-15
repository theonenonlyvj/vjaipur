import { describe, it, expect, vi, beforeEach } from 'vitest'

// Use vi.hoisted to ensure the mock object is available during vi.mock hoisting
const { mockSupabase } = vi.hoisted(() => ({
  mockSupabase: {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    single: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  }
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockSupabase)
}))

// Now import the functions to test
import {
  recordMatch, getPlayerMatches, ensurePlayerForVGames,
  getPlayerByVGamesAccountId
} from '../../server/db'

describe('db.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset the chainable mocks to return mockSupabase
    mockSupabase.from.mockReturnThis()
    mockSupabase.select.mockReturnThis()
    mockSupabase.insert.mockReturnThis()
    mockSupabase.update.mockReturnThis()
    mockSupabase.upsert.mockReturnThis()
    mockSupabase.eq.mockReturnThis()
    mockSupabase.ilike.mockReturnThis()
    mockSupabase.single.mockReturnThis()
    mockSupabase.order.mockReturnThis()
    mockSupabase.limit.mockReturnThis()
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
    // NOTE: this assertion is stale (matches.order() is actually called with
    // 'timestamp', not 'created_at' — 'created_at' looks copy-pasted from a
    // players-table test). Left failing on purpose, unrelated to Task C4 —
    // matches the pre-existing baseline; not fixing it here (out of scope).
    expect(mockSupabase.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(matches).toEqual([{ id: 'm1' }])
  })

  it('getPlayerByVGamesAccountId queries players by vgames_account_id (read-only)', async () => {
    mockSupabase.limit.mockResolvedValueOnce({ data: [{ id: 'p9', friend_code: 'VJ-7064' }], error: null })

    const player = await getPlayerByVGamesAccountId('acc-abc')

    expect(mockSupabase.from).toHaveBeenCalledWith('players')
    expect(mockSupabase.eq).toHaveBeenCalledWith('vgames_account_id', 'acc-abc')
    // read-only: it must never write (a write would clobber the real friend_code)
    expect(mockSupabase.upsert).not.toHaveBeenCalled()
    expect(mockSupabase.insert).not.toHaveBeenCalled()
    expect(mockSupabase.update).not.toHaveBeenCalled()
    expect(player).toEqual({ id: 'p9', friend_code: 'VJ-7064' })
  })

  it('getPlayerByVGamesAccountId returns null when no row matches', async () => {
    mockSupabase.limit.mockResolvedValueOnce({ data: [], error: null })
    const player = await getPlayerByVGamesAccountId('acc-none')
    expect(player).toBeNull()
  })

  // ── VGames dual-run bridge (Task C4, race-safety fix in Fix 3) ───────────
  // ensurePlayerForVGames provisions/finds a Supabase `players` row keyed by
  // the new nullable `players.vgames_account_id`, so the existing
  // getLeaderboard()/matches machinery keeps working unchanged while vjaipur
  // runs dual (VGames Identity for auth, Supabase for match/leaderboard
  // storage). It's now a single UPSERT on vgames_account_id — race-safe
  // against two concurrent SYNC_MATCH calls for the same accountId (no
  // select-then-insert TOCTOU window) — and fail-closed (a lookup/write
  // error returns null so callers block the match write instead of
  // orphaning it).
  describe('ensurePlayerForVGames', () => {
    it('upserts on vgames_account_id in a single call (no separate select-then-insert)', async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: 'p1', vgames_account_id: 'acc1', display_name: 'Vee', friend_code: 'VG-1234' },
        error: null,
      })

      const player = await ensurePlayerForVGames('acc1', 'Vee')

      expect(mockSupabase.from).toHaveBeenCalledWith('players')
      expect(mockSupabase.upsert).toHaveBeenCalledTimes(1)
      const [row, opts] = mockSupabase.upsert.mock.calls[0]
      expect(row).toMatchObject({ vgames_account_id: 'acc1', display_name: 'Vee' })
      expect(opts).toEqual({ onConflict: 'vgames_account_id' })
      // No separate lookup-before-write step (that's the TOCTOU window this
      // fix removes).
      expect(mockSupabase.select).not.toHaveBeenCalledWith('*')
      expect(mockSupabase.insert).not.toHaveBeenCalled()
      expect(player).toEqual({ id: 'p1', vgames_account_id: 'acc1', display_name: 'Vee', friend_code: 'VG-1234' })
    })

    it('mirrors the given display_name onto an existing linked row via the upsert', async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: 'p1', vgames_account_id: 'acc1', display_name: 'NewName', friend_code: 'VG-1234' },
        error: null,
      })

      const player = await ensurePlayerForVGames('acc1', 'NewName')

      const [row] = mockSupabase.upsert.mock.calls[0]
      expect(row.display_name).toBe('NewName')
      expect(player?.display_name).toBe('NewName')
    })

    it('creates a new row keyed by vgames_account_id when none exists (no plaintext secret)', async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: 'p2', vgames_account_id: 'acc2', display_name: 'Newbie', friend_code: 'VG-4242' },
        error: null,
      })

      const player = await ensurePlayerForVGames('acc2', 'Newbie')

      expect(mockSupabase.upsert).toHaveBeenCalledTimes(1)
      const [row] = mockSupabase.upsert.mock.calls[0]
      expect(row).toMatchObject({ vgames_account_id: 'acc2', display_name: 'Newbie' })
      expect(player).toEqual({ id: 'p2', vgames_account_id: 'acc2', display_name: 'Newbie', friend_code: 'VG-4242' })
    })

    it('is idempotent across repeated (even concurrent) calls for the same accountId — one upsert per call, no select-then-insert race', async () => {
      mockSupabase.single
        .mockResolvedValueOnce({ data: { id: 'p3', vgames_account_id: 'acc3', display_name: 'A' }, error: null })
        .mockResolvedValueOnce({ data: { id: 'p3', vgames_account_id: 'acc3', display_name: 'A' }, error: null })

      // Fired concurrently (not awaited sequentially) — the old select-then-
      // insert implementation could double-insert here; upsert cannot.
      const [first, second] = await Promise.all([
        ensurePlayerForVGames('acc3', 'A'),
        ensurePlayerForVGames('acc3', 'A'),
      ])

      expect(mockSupabase.upsert).toHaveBeenCalledTimes(2)
      expect(mockSupabase.insert).not.toHaveBeenCalled()
      expect(first?.id).toBe('p3')
      expect(second?.id).toBe('p3')
    })

    it('fails closed (returns null) when the upsert errors', async () => {
      mockSupabase.single.mockResolvedValueOnce({ data: null, error: { code: 'CONNECTION_ERROR', message: 'boom' } })

      const player = await ensurePlayerForVGames('acc4', 'X')

      expect(player).toBeNull()
    })
  })
})

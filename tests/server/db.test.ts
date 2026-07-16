import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

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
    // Real column is 'timestamp' (see server/db.ts getPlayerMatches). This
    // assertion used to say 'created_at' — stale, copy-pasted from a
    // players-table test — and was left red on purpose (Fix 3).
    expect(mockSupabase.order).toHaveBeenCalledWith('timestamp', { ascending: false })
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

// Fix 2 (boot hardening): @supabase/supabase-js throws SYNCHRONOUSLY at
// construction time when the URL/key are blank — every test above mocks
// createClient() to always succeed, so it can't catch a regression of the
// guard in server/db.ts (buildSupabaseClient). This spawns a real subprocess
// with the REAL (unmocked) @supabase/supabase-js package and blank env vars,
// which is the only reliable way to exercise the actual throw-at-construction
// behavior the fix guards against.
describe('supabase client construction degrades gracefully when unconfigured (Fix 2)', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const tsxBin = path.join(repoRoot, 'node_modules/.bin/tsx')

  it('importing server/db.ts with blank SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY does not throw, and db functions degrade to empty/null instead of crashing', () => {
    const script = `
      import('./server/db.ts').then((db) => {
        if (db.supabase !== null) { console.error('EXPECTED_NULL_SUPABASE'); process.exit(1); return }
        return db.getPlayerMatches('p1')
      }).then((matches) => {
        if (!Array.isArray(matches) || matches.length !== 0) { console.error('EXPECTED_EMPTY_MATCHES'); process.exit(1); return }
        console.log('FIX_2_OK')
        process.exit(0)
      }).catch((e) => { console.error('IMPORT_OR_CALL_FAILED', e); process.exit(1) })
    `
    const output = execFileSync(tsxBin, ['-e', script], {
      cwd: repoRoot,
      env: { ...process.env, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' },
      encoding: 'utf-8',
      timeout: 15_000,
    })
    expect(output).toContain('FIX_2_OK')
  }, 20_000)
})

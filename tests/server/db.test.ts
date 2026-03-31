import { describe, it, expect, vi, beforeEach } from 'vitest'

// Use vi.hoisted to ensure the mock object is available during vi.mock hoisting
const { mockSupabase } = vi.hoisted(() => ({
  mockSupabase: {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
  }
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockSupabase)
}))

// Now import the functions to test
import { getPlayerByCode, createPlayer, recordMatch, getPlayerMatches } from '../../server/db'

describe('db.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset the chainable mocks to return mockSupabase
    mockSupabase.from.mockReturnThis()
    mockSupabase.select.mockReturnThis()
    mockSupabase.insert.mockReturnThis()
    mockSupabase.eq.mockReturnThis()
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
    expect(mockSupabase.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(matches).toEqual([{ id: 'm1' }])
  })
})

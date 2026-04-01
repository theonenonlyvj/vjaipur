import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock localStorage BEFORE importing the store
const store: Record<string, string> = {}
const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] || null),
  setItem: vi.fn((key: string, value: string) => {
    store[key] = value.toString()
  }),
  clear: vi.fn(() => {
    for (const key in store) {
      delete store[key]
    }
  }),
  removeItem: vi.fn((key: string) => {
    delete store[key]
  }),
  length: 0,
  key: vi.fn((index: number) => Object.keys(store)[index] || null),
}

vi.stubGlobal('localStorage', localStorageMock)

// NOW import the store
import { useStatsStore } from '../../src/store/statsStore'
import { socketService } from '../../src/socket/socketService'

vi.mock('../../src/socket/socketService', () => ({
  socketService: {
    connected: true,
    connect: vi.fn(),
    syncMatch: vi.fn(),
    restoreAccount: vi.fn(),
    secureAccount: vi.fn(),
  },
}))

describe('statsStore', () => {
  beforeEach(() => {
    useStatsStore.getState().clearStats()
    vi.clearAllMocks()
    localStorageMock.clear()
  })

  it('generates an account when ensureAccount is called with Guest name', () => {
    const { friendCode, secretKey, displayName } = useStatsStore.getState().ensureAccount()
    expect(friendCode).toMatch(/^VJ-\d{4}$/)
    expect(secretKey).toHaveLength(32)
    const expectedName = `Guest_${friendCode.slice(-4)}`
    expect(displayName).toBe(expectedName)
    
    const state = useStatsStore.getState()
    expect(state.friendCode).toBe(friendCode)
    expect(state.secretKey).toBe(secretKey)
    expect(state.displayName).toBe(expectedName)
  })

  it('reuses the same account once generated', () => {
    const first = useStatsStore.getState().ensureAccount()
    const second = useStatsStore.getState().ensureAccount()
    expect(first.friendCode).toBe(second.friendCode)
    expect(first.secretKey).toBe(second.secretKey)
  })

  it('adds a match and triggers sync', () => {
    const matchData = {
      opponent_type: 'ai-easy',
      player_score: 70,
      opponent_score: 60,
      won: true,
    }

    useStatsStore.getState().addMatch(matchData)

    const state = useStatsStore.getState()
    expect(state.matches).toHaveLength(1)
    expect(state.matches[0]).toMatchObject(matchData)
    expect(state.matches[0].timestamp).toBeDefined()

    expect(socketService.syncMatch).toHaveBeenCalledWith(expect.objectContaining({
      friendCode: state.friendCode,
      secretKey: state.secretKey,
      match: expect.objectContaining({
        ...matchData,
        timestamp: expect.any(Number)
      }),
    }))
  })

  it('restores an account via server', async () => {
    const matches = [
      {
        opponent_type: 'ai-hard',
        player_score: 50,
        opponent_score: 80,
        won: false,
        timestamp: 123456789,
      },
    ]
    const friendCode = 'VJ-9999'
    const secretKey = 'secret-key'
    const displayName = 'RestoredUser'

    vi.mocked(socketService.restoreAccount).mockResolvedValueOnce({
      ok: true,
      friendCode,
      secretKey,
      matches,
      displayName,
    })

    const result = await useStatsStore.getState().restoreAccount('user', 'pass')

    expect(result.ok).toBe(true)
    const state = useStatsStore.getState()
    expect(state.matches).toEqual(matches)
    expect(state.friendCode).toBe(friendCode)
    expect(state.secretKey).toBe(secretKey)
    expect(state.displayName).toBe(displayName)
  })

  it('secures an account and updates local state', async () => {
    useStatsStore.getState().ensureAccount()
    const { friendCode } = useStatsStore.getState()

    vi.mocked(socketService.secureAccount).mockResolvedValueOnce({ ok: true })

    const result = await useStatsStore.getState().secureAccount('newuser', 'newpass')

    expect(result.ok).toBe(true)
    expect(socketService.secureAccount).toHaveBeenCalledWith({
      friendCode,
      username: 'newuser',
      password: 'newpass',
    })

    const state = useStatsStore.getState()
    expect(state.displayName).toBe('newuser')
    expect(state.secretKey).toBe('newpass')
  })
})

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
    syncMatch: vi.fn(),
  },
}))

describe('statsStore', () => {
  beforeEach(() => {
    useStatsStore.getState().clearStats()
    vi.clearAllMocks()
    localStorageMock.clear()
  })

  it('generates an account when ensureAccount is called', () => {
    const { friendCode, secretKey } = useStatsStore.getState().ensureAccount()
    expect(friendCode).toMatch(/^VJ-\d{4}$/)
    expect(secretKey).toHaveLength(32)
    
    const state = useStatsStore.getState()
    expect(state.friendCode).toBe(friendCode)
    expect(state.secretKey).toBe(secretKey)
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
      match: matchData,
    }))
  })

  it('restores an account', () => {
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

    useStatsStore.getState().restoreAccount(matches, friendCode, secretKey)

    const state = useStatsStore.getState()
    expect(state.matches).toEqual(matches)
    expect(state.friendCode).toBe(friendCode)
    expect(state.secretKey).toBe(secretKey)
  })
})

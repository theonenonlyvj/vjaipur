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

vi.mock('../../src/socket/socketService', () => ({
  socketService: {
    connected: true,
    connect: vi.fn(),
    syncMatch: vi.fn(),
    restoreAccount: vi.fn(),
    secureAccount: vi.fn(),
    updateProfile: vi.fn(),
    setAuthToken: vi.fn(),
  },
}))

vi.mock('../../src/auth/vgamesClient', () => ({
  vgamesQuick: vi.fn(),
  vgamesSetCredentials: vi.fn(),
  vgamesLogin: vi.fn(),
}))

// NOW import the store + mocked collaborators
import { useStatsStore } from '../../src/store/statsStore'
import { socketService } from '../../src/socket/socketService'
import { vgamesQuick, vgamesSetCredentials, vgamesLogin } from '../../src/auth/vgamesClient'

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

  it('persisted store shape stays backward-compatible: adds vgamesToken/vgamesAccountId, keeps old fields', () => {
    const state = useStatsStore.getState()
    expect(state).toHaveProperty('friendCode')
    expect(state).toHaveProperty('secretKey')
    expect(state).toHaveProperty('displayName')
    expect(state).toHaveProperty('matches')
    expect(state).toHaveProperty('vgamesToken')
    expect(state).toHaveProperty('vgamesAccountId')
    expect(state.vgamesToken).toBeNull()
    expect(state.vgamesAccountId).toBeNull()
  })

  describe('addMatch', () => {
    const matchData = {
      opponent_type: 'ai-easy',
      player_score: 70,
      opponent_score: 60,
      won: true,
    }

    it('adds the match to local history synchronously', () => {
      useStatsStore.getState().addMatch(matchData)
      const state = useStatsStore.getState()
      expect(state.matches).toHaveLength(1)
      expect(state.matches[0]).toMatchObject(matchData)
      expect(state.matches[0].timestamp).toBeDefined()
    })

    it('mints a VGames ghost using the local secretKey as the device credential, then syncs the match by token — no plaintext secret round-trip', async () => {
      vi.mocked(vgamesQuick).mockResolvedValueOnce({ token: 'vg-tok-1', accountId: 'vg-acc-1' })

      await useStatsStore.getState().addMatch(matchData)

      const { secretKey, displayName } = useStatsStore.getState()
      expect(vgamesQuick).toHaveBeenCalledWith(secretKey, displayName)

      expect(socketService.syncMatch).toHaveBeenCalledWith(
        expect.objectContaining({
          vgamesToken: 'vg-tok-1',
          match: expect.objectContaining({ ...matchData, timestamp: expect.any(Number) }),
        })
      )
      const payload = vi.mocked(socketService.syncMatch).mock.calls[0][0] as any
      expect(payload.password).toBeUndefined()
      expect(payload.secretKey).toBeUndefined()

      expect(useStatsStore.getState().vgamesToken).toBe('vg-tok-1')
      expect(useStatsStore.getState().vgamesAccountId).toBe('vg-acc-1')
    })

    it('reuses a cached VGames token across matches instead of re-minting', async () => {
      vi.mocked(vgamesQuick).mockResolvedValueOnce({ token: 'vg-tok-2', accountId: 'vg-acc-2' })
      await useStatsStore.getState().addMatch(matchData)
      await useStatsStore.getState().addMatch(matchData)
      expect(vgamesQuick).toHaveBeenCalledTimes(1)
      expect(socketService.syncMatch).toHaveBeenCalledTimes(2)
    })

    it('does not sync the match if minting a VGames account fails', async () => {
      vi.mocked(vgamesQuick).mockRejectedValueOnce(new Error('network down'))
      await useStatsStore.getState().addMatch(matchData)
      expect(socketService.syncMatch).not.toHaveBeenCalled()
      // local history still recorded
      expect(useStatsStore.getState().matches).toHaveLength(1)
    })
  })

  describe('secureAccount', () => {
    it('claims a username+password on the VGames account, without storing the password as the local secret', async () => {
      useStatsStore.getState().ensureAccount()
      vi.mocked(vgamesQuick).mockResolvedValueOnce({ token: 'vg-tok-3', accountId: 'vg-acc-3' })
      vi.mocked(vgamesSetCredentials).mockResolvedValueOnce({ ok: true })

      const result = await useStatsStore.getState().secureAccount('newuser', 'newpass')

      expect(result.ok).toBe(true)
      expect(vgamesSetCredentials).toHaveBeenCalledWith('vg-tok-3', 'newuser', 'newpass')

      const state = useStatsStore.getState()
      expect(state.displayName).toBe('newuser')
      expect(state.secretKey).not.toBe('newpass') // no plaintext password round-trip into local secret
    })

    it('surfaces an error without mutating local state on failure', async () => {
      useStatsStore.getState().ensureAccount()
      const before = useStatsStore.getState().displayName
      vi.mocked(vgamesQuick).mockResolvedValueOnce({ token: 'vg-tok-4', accountId: 'vg-acc-4' })
      vi.mocked(vgamesSetCredentials).mockResolvedValueOnce({ ok: false, error: 'username_taken' })

      const result = await useStatsStore.getState().secureAccount('taken', 'pw123456')

      expect(result).toEqual({ ok: false, error: 'username_taken' })
      expect(useStatsStore.getState().displayName).toBe(before)
    })
  })

  describe('setDisplayName', () => {
    it('mints/reuses a VGames token and updates the profile by token — no plaintext secret round-trip', async () => {
      useStatsStore.getState().ensureAccount()
      vi.mocked(vgamesQuick).mockResolvedValueOnce({ token: 'vg-tok-6', accountId: 'vg-acc-6' })

      await useStatsStore.getState().setDisplayName('NewName')

      expect(useStatsStore.getState().displayName).toBe('NewName')
      expect(socketService.updateProfile).toHaveBeenCalledWith({
        vgamesToken: 'vg-tok-6',
        displayName: 'NewName',
      })
      const payload = vi.mocked(socketService.updateProfile).mock.calls[0][0] as any
      expect(payload.friendCode).toBeUndefined()
      expect(payload.secretKey).toBeUndefined()
    })

    it('does not call updateProfile if minting a VGames account fails (fail-closed)', async () => {
      useStatsStore.getState().ensureAccount()
      vi.mocked(vgamesQuick).mockRejectedValueOnce(new Error('network down'))

      await useStatsStore.getState().setDisplayName('NewName')

      expect(useStatsStore.getState().displayName).toBe('NewName') // local state still updates
      expect(socketService.updateProfile).not.toHaveBeenCalled()
    })
  })

  describe('restoreAccount', () => {
    it('logs in via VGames using the local secretKey as the device credential and adopts the returned identity', async () => {
      useStatsStore.getState().ensureAccount()
      const { secretKey } = useStatsStore.getState()

      vi.mocked(vgamesLogin).mockResolvedValueOnce({
        ok: true,
        token: 'vg-tok-5',
        accountId: 'vg-acc-5',
        mustChangePassword: false,
      })

      const result = await useStatsStore.getState().restoreAccount('vee', 'hunter2')

      expect(result.ok).toBe(true)
      expect(vgamesLogin).toHaveBeenCalledWith('vee', 'hunter2', secretKey)

      const state = useStatsStore.getState()
      expect(state.vgamesToken).toBe('vg-tok-5')
      expect(state.vgamesAccountId).toBe('vg-acc-5')
      expect(state.displayName).toBe('vee')
    })

    it('surfaces invalid_credentials without adopting a new identity', async () => {
      useStatsStore.getState().ensureAccount()
      vi.mocked(vgamesLogin).mockResolvedValueOnce({ ok: false, error: 'invalid_credentials' })

      const result = await useStatsStore.getState().restoreAccount('vee', 'wrong')

      expect(result).toEqual({ ok: false, error: 'invalid_credentials' })
      expect(useStatsStore.getState().vgamesToken).toBeNull()
    })
  })
})

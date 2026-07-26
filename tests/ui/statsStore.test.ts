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
    pullHistory: vi.fn(),
  },
}))

vi.mock('../../src/auth/vgamesClient', () => ({
  vgamesQuick: vi.fn(),
  vgamesSetCredentials: vi.fn(),
  vgamesLogin: vi.fn(),
}))

vi.mock('../../src/net/online', () => ({
  reportMatch: vi.fn(),
  history: vi.fn(),
}))

// NOW import the store + mocked collaborators
import { useStatsStore } from '../../src/store/statsStore'
import { socketService } from '../../src/socket/socketService'
import { vgamesQuick, vgamesSetCredentials, vgamesLogin } from '../../src/auth/vgamesClient'
import { reportMatch, history } from '../../src/net/online'
import { WorkerError } from '../../src/net/http'

// Builds a syntactically-real (unsigned) JWT whose payload carries only
// `exp` (epoch seconds) — enough for src/auth/tokenExpiry.ts#decodeJwtExp to
// read a real expiry, which the ensureVGamesAccount cache-freshness check
// needs. `offsetSeconds` is relative to "now" (negative = already expired).
function makeJwt(offsetSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + offsetSeconds
  const b64url = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ exp })}.sig`
}

describe('statsStore', () => {
  beforeEach(() => {
    useStatsStore.getState().clearStats()
    vi.clearAllMocks()
    localStorageMock.clear()
    // A harmless default so fire-and-forget pullVGamesHistory() calls (e.g.
    // from restoreAccount) don't log a spurious warning in tests that aren't
    // themselves about pullVGamesHistory.
    vi.mocked(history).mockResolvedValue({ matches: [] })
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

  describe('ensureVGamesAccount forceRefresh (401 self-heal)', () => {
    it('reuses the cached token by default, but forceRefresh mints a fresh one (fixes "Failed to create room" on an expired token)', async () => {
      // Seed a cached token that is NOT near expiry (far-future exp) — the
      // proactive-expiry check (see the dedicated describe block below) must
      // not itself trigger a mint here; this test is only about forceRefresh.
      useStatsStore.setState({ vgamesToken: 'stale-tok', vgamesAccountId: 'acc-1', vgamesTokenExp: Math.floor(Date.now() / 1000) + 3600 })

      // Default: short-circuits on the cache, no network mint.
      const cached = await useStatsStore.getState().ensureVGamesAccount()
      expect(cached).toEqual({ token: 'stale-tok', accountId: 'acc-1' })
      expect(vgamesQuick).not.toHaveBeenCalled()

      // forceRefresh: bypasses the cache and mints a FRESH token via vgamesQuick.
      vi.mocked(vgamesQuick).mockResolvedValueOnce({ token: 'fresh-tok', accountId: 'acc-1' })
      const refreshed = await useStatsStore.getState().ensureVGamesAccount(true)
      expect(vgamesQuick).toHaveBeenCalledTimes(1)
      expect(refreshed).toEqual({ token: 'fresh-tok', accountId: 'acc-1' })
      expect(useStatsStore.getState().vgamesToken).toBe('fresh-tok')
    })
  })

  describe('ensureVGamesAccount proactive expiry refresh (session persistence — owner logged out hourly)', () => {
    it('stores vgamesTokenExp (decoded from the minted token) whenever ensureVGamesAccount mints a token', async () => {
      const token = makeJwt(3600)
      vi.mocked(vgamesQuick).mockResolvedValueOnce({ token, accountId: 'acc-1' })

      await useStatsStore.getState().ensureVGamesAccount()

      const expected = Math.floor(Date.now() / 1000) + 3600
      expect(useStatsStore.getState().vgamesTokenExp).toBe(expected)
    })

    it('reuses a cached token that is NOT near expiry, with no network call', async () => {
      useStatsStore.setState({
        vgamesToken: 'cached-tok', vgamesAccountId: 'acc-1',
        vgamesTokenExp: Math.floor(Date.now() / 1000) + 3600, // 1h out — well outside the 10-minute skew
      })

      const result = await useStatsStore.getState().ensureVGamesAccount()

      expect(result).toEqual({ token: 'cached-tok', accountId: 'acc-1' })
      expect(vgamesQuick).not.toHaveBeenCalled()
    })

    it('mints a fresh token when the cached one is WITHIN the skew window (about to expire)', async () => {
      useStatsStore.setState({
        vgamesToken: 'about-to-expire', vgamesAccountId: 'acc-1',
        vgamesTokenExp: Math.floor(Date.now() / 1000) + 5 * 60, // 5 min out — inside the 10-minute skew
      })
      vi.mocked(vgamesQuick).mockResolvedValueOnce({ token: makeJwt(86_400), accountId: 'acc-1' })

      const result = await useStatsStore.getState().ensureVGamesAccount()

      expect(vgamesQuick).toHaveBeenCalledTimes(1)
      expect(result?.token).not.toBe('about-to-expire')
    })

    it('mints a fresh token when the cached one is already expired', async () => {
      useStatsStore.setState({
        vgamesToken: 'dead-tok', vgamesAccountId: 'acc-1',
        vgamesTokenExp: Math.floor(Date.now() / 1000) - 100,
      })
      vi.mocked(vgamesQuick).mockResolvedValueOnce({ token: makeJwt(86_400), accountId: 'acc-1' })

      await useStatsStore.getState().ensureVGamesAccount()

      expect(vgamesQuick).toHaveBeenCalledTimes(1)
    })

    it('mints a fresh token when vgamesTokenExp is missing even though a token+accountId are cached (self-heals a pre-upgrade persisted session)', async () => {
      useStatsStore.setState({ vgamesToken: 'legacy-tok', vgamesAccountId: 'acc-1', vgamesTokenExp: null })
      vi.mocked(vgamesQuick).mockResolvedValueOnce({ token: makeJwt(86_400), accountId: 'acc-1' })

      await useStatsStore.getState().ensureVGamesAccount()

      expect(vgamesQuick).toHaveBeenCalledTimes(1)
    })

    it('forceRefresh still bypasses the cache even when the cached token is fresh (not near expiry)', async () => {
      useStatsStore.setState({
        vgamesToken: 'fresh-tok', vgamesAccountId: 'acc-1',
        vgamesTokenExp: Math.floor(Date.now() / 1000) + 3600,
      })
      vi.mocked(vgamesQuick).mockResolvedValueOnce({ token: makeJwt(86_400), accountId: 'acc-1' })

      await useStatsStore.getState().ensureVGamesAccount(true)

      expect(vgamesQuick).toHaveBeenCalledTimes(1)
    })

    it('the claimed->ghost refusal guard still fires (and sets sessionExpired) when a near-expiry proactive refresh resolves to a different identity', async () => {
      useStatsStore.getState().ensureAccount()
      useStatsStore.setState({
        claimed: true, vgamesToken: 'old-tok', vgamesAccountId: 'acc-old',
        vgamesTokenExp: Math.floor(Date.now() / 1000) + 5 * 60, // inside the skew window
      })
      vi.mocked(vgamesQuick).mockResolvedValueOnce({ token: makeJwt(86_400), accountId: 'acc-new', status: 'ghost' })

      const result = await useStatsStore.getState().ensureVGamesAccount()

      expect(result).toBeNull()
      expect(useStatsStore.getState().claimed).toBe(true) // not downgraded
      expect(useStatsStore.getState().sessionExpired).toBe(true)
      expect(useStatsStore.getState().vgamesToken).toBe('old-tok') // not adopted
    })
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

    it('mints a VGames ghost using the local secretKey as the device credential, then POSTs /stats/report by token — no plaintext secret round-trip', async () => {
      vi.mocked(vgamesQuick).mockResolvedValueOnce({ token: 'vg-tok-1', accountId: 'vg-acc-1' })
      vi.mocked(reportMatch).mockResolvedValueOnce({ ok: true })

      await useStatsStore.getState().addMatch(matchData)

      const { secretKey, displayName } = useStatsStore.getState()
      expect(vgamesQuick).toHaveBeenCalledWith(secretKey, displayName)

      // The device credential/token never rides in the report body itself —
      // net/online.ts#reportMatch resolves the Bearer token internally from
      // the store, not from a body field (see http.test.ts).
      expect(reportMatch).toHaveBeenCalledWith(
        expect.objectContaining({ ...matchData, timestamp: expect.any(Number) })
      )
      const payload = vi.mocked(reportMatch).mock.calls[0][0] as any
      expect(payload.password).toBeUndefined()
      expect(payload.secretKey).toBeUndefined()

      expect(useStatsStore.getState().vgamesToken).toBe('vg-tok-1')
      expect(useStatsStore.getState().vgamesAccountId).toBe('vg-acc-1')
      expect(useStatsStore.getState().pendingReports).toHaveLength(0)
    })

    it('reuses a cached VGames token across matches instead of re-minting', async () => {
      // A real (far-future-exp) JWT — a fake opaque string would decode to
      // no expiry and, per the new proactive-refresh check, get treated as
      // "unknown freshness" and re-minted on the very next call.
      vi.mocked(vgamesQuick).mockResolvedValueOnce({ token: makeJwt(3600), accountId: 'vg-acc-2' })
      vi.mocked(reportMatch).mockResolvedValue({ ok: true })
      await useStatsStore.getState().addMatch(matchData)
      await useStatsStore.getState().addMatch(matchData)
      expect(vgamesQuick).toHaveBeenCalledTimes(1)
      expect(reportMatch).toHaveBeenCalledTimes(2)
    })

    it('queues the match in pendingReports (for a later boot retry) if minting a VGames account fails', async () => {
      vi.mocked(vgamesQuick).mockRejectedValueOnce(new Error('network down'))
      await useStatsStore.getState().addMatch(matchData)
      expect(reportMatch).not.toHaveBeenCalled()
      // local history still recorded
      expect(useStatsStore.getState().matches).toHaveLength(1)
      expect(useStatsStore.getState().pendingReports).toHaveLength(1)
      expect(useStatsStore.getState().pendingReports[0]).toMatchObject(matchData)
    })

    describe('with an aiGameLog (per-move logging — src/store/aiGameLog.ts)', () => {
      const logEntry = {
        ply: 1,
        round: 1,
        actor: 'human' as const,
        tier: 'easy' as const,
        action: { type: 'TAKE_CAMELS' as const },
        preState: {
          mkt: ['diamond'], h0: ['gold'], h1: ['silver'], herd: [0, 0] as [number, number], deck: 10,
          tok: [[7, 7, 5, 5, 5]], bonus: [7, 6, 5] as [number, number, number], score: [0, 0] as [number, number], seals: [0, 0] as [number, number],
        },
      }

      it('sends the log as a JSON string on the `log` field of the report body', async () => {
        vi.mocked(vgamesQuick).mockResolvedValueOnce({ token: 'vg-tok-log', accountId: 'vg-acc-log' })
        vi.mocked(reportMatch).mockResolvedValueOnce({ ok: true })

        await useStatsStore.getState().addMatch(matchData, [logEntry])

        const payload = vi.mocked(reportMatch).mock.calls[0][0] as any
        expect(typeof payload.log).toBe('string')
        expect(JSON.parse(payload.log)).toEqual([logEntry])
      })

      it('omits the `log` field entirely when no log is passed (e.g. a non-vs-ai report, or a pendingReports retry)', async () => {
        vi.mocked(vgamesQuick).mockResolvedValueOnce({ token: 'vg-tok-nolog', accountId: 'vg-acc-nolog' })
        vi.mocked(reportMatch).mockResolvedValueOnce({ ok: true })

        await useStatsStore.getState().addMatch(matchData)

        const payload = vi.mocked(reportMatch).mock.calls[0][0] as any
        expect(payload.log).toBeUndefined()
      })

      it('omits the `log` field when passed an empty array', async () => {
        vi.mocked(vgamesQuick).mockResolvedValueOnce({ token: 'vg-tok-empty', accountId: 'vg-acc-empty' })
        vi.mocked(reportMatch).mockResolvedValueOnce({ ok: true })

        await useStatsStore.getState().addMatch(matchData, [])

        const payload = vi.mocked(reportMatch).mock.calls[0][0] as any
        expect(payload.log).toBeUndefined()
      })

      it('size-caps the log before sending: an oversized log still reports, with preState stripped from the oldest entries', async () => {
        vi.mocked(vgamesQuick).mockResolvedValueOnce({ token: 'vg-tok-big', accountId: 'vg-acc-big' })
        vi.mocked(reportMatch).mockResolvedValueOnce({ ok: true })

        // Fabricate a log whose full JSON clears 250KB, forcing the client
        // cap (capLogForReport's default budget) to strip the oldest entries.
        const bigLog = Array.from({ length: 1500 }, (_, i) => ({ ...logEntry, ply: i + 1 }))
        const fullSize = JSON.stringify(bigLog).length
        expect(fullSize).toBeGreaterThan(250_000) // sanity: this really does exceed the client budget

        await useStatsStore.getState().addMatch(matchData, bigLog)

        const payload = vi.mocked(reportMatch).mock.calls[0][0] as any
        expect(payload.log.length).toBeLessThan(fullSize)
        const parsed = JSON.parse(payload.log)
        expect(parsed).toHaveLength(1500) // never DROPS entries, only lightens them
        expect(parsed[0].preState).toBeUndefined() // oldest stripped first
        expect(parsed[parsed.length - 1].preState).toBeDefined() // newest survives intact
      })

      it('does not persist the log into the local `matches`/`pendingReports` history (only sent on this one report)', async () => {
        vi.mocked(vgamesQuick).mockResolvedValueOnce({ token: 'vg-tok-persist', accountId: 'vg-acc-persist' })
        vi.mocked(reportMatch).mockResolvedValueOnce({ ok: true })

        await useStatsStore.getState().addMatch(matchData, [logEntry])

        expect(useStatsStore.getState().matches[0]).not.toHaveProperty('log')
      })
    })
  })

  describe('retryPendingReports', () => {
    const matchData = { opponent_type: 'ai-easy', player_score: 70, opponent_score: 60, won: true }

    it('is a no-op with nothing pending', async () => {
      await useStatsStore.getState().retryPendingReports()
      expect(reportMatch).not.toHaveBeenCalled()
    })

    it('retries every queued match and clears the ones that succeed', async () => {
      vi.mocked(vgamesQuick).mockRejectedValueOnce(new Error('offline'))
      await useStatsStore.getState().addMatch(matchData) // lands in pendingReports
      expect(useStatsStore.getState().pendingReports).toHaveLength(1)

      vi.mocked(vgamesQuick).mockResolvedValueOnce({ token: 'vg-tok-9', accountId: 'vg-acc-9' })
      vi.mocked(reportMatch).mockResolvedValueOnce({ ok: true })

      await useStatsStore.getState().retryPendingReports()

      expect(reportMatch).toHaveBeenCalledTimes(1)
      expect(useStatsStore.getState().pendingReports).toHaveLength(0)
    })

    it('leaves a still-failing match queued (does not drop it)', async () => {
      vi.mocked(vgamesQuick).mockRejectedValueOnce(new Error('offline'))
      await useStatsStore.getState().addMatch(matchData)
      expect(useStatsStore.getState().pendingReports).toHaveLength(1)

      vi.mocked(vgamesQuick).mockRejectedValueOnce(new Error('still offline'))
      await useStatsStore.getState().retryPendingReports()

      expect(reportMatch).not.toHaveBeenCalled()
      expect(useStatsStore.getState().pendingReports).toHaveLength(1)
    })
  })

  describe('reportMatchNow lastSyncError copy', () => {
    const matchData = { opponent_type: 'ai-easy', player_score: 70, opponent_score: 60, won: true }

    it('translates a 401 WorkerError into a friendly "signed out" message instead of the raw error string', async () => {
      vi.mocked(vgamesQuick).mockResolvedValueOnce({ token: 'vg-tok', accountId: 'vg-acc' })
      vi.mocked(reportMatch).mockRejectedValueOnce(new WorkerError(401, 'unauthorized/invalid_token', {}))

      const ok = await useStatsStore.getState().reportMatchNow({ ...matchData, timestamp: Date.now() })

      expect(ok).toBe(false)
      expect(useStatsStore.getState().lastSyncError).toBe('Signed out — log in again to sync this game')
    })

    it('keeps the raw diagnostic message for a non-auth failure (offline/5xx)', async () => {
      vi.mocked(vgamesQuick).mockResolvedValueOnce({ token: 'vg-tok', accountId: 'vg-acc' })
      vi.mocked(reportMatch).mockRejectedValueOnce(new WorkerError(500, 'http_500', {}))

      const ok = await useStatsStore.getState().reportMatchNow({ ...matchData, timestamp: Date.now() })

      expect(ok).toBe(false)
      expect(useStatsStore.getState().lastSyncError).toContain('WorkerError')
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

    it('stores vgamesTokenExp decoded from the freshly-issued login token', async () => {
      useStatsStore.getState().ensureAccount()
      const loginToken = makeJwt(3600) // login mints a 1h token
      vi.mocked(vgamesLogin).mockResolvedValueOnce({ ok: true, token: loginToken, accountId: 'vg-acc-5', mustChangePassword: false })
      // The background upgrade-refresh (item 4) also fires on login — keep it
      // a harmless no-op here so it can't race this assertion.
      vi.mocked(vgamesQuick).mockRejectedValueOnce(new Error('network down'))

      await useStatsStore.getState().restoreAccount('vee', 'hunter2')

      const expected = Math.floor(Date.now() / 1000) + 3600
      expect(useStatsStore.getState().vgamesTokenExp).toBe(expected)
    })

    it('after a successful login, kicks a fire-and-forget upgrade refresh that swaps in the longer-lived device-bound token for the SAME account', async () => {
      useStatsStore.getState().ensureAccount()
      const { secretKey } = useStatsStore.getState()
      const loginToken = makeJwt(3600) // 1h
      const upgradedToken = makeJwt(86_400) // 24h device-bound token
      vi.mocked(vgamesLogin).mockResolvedValueOnce({ ok: true, token: loginToken, accountId: 'vg-acc-5', mustChangePassword: false })
      vi.mocked(vgamesQuick).mockResolvedValueOnce({ token: upgradedToken, accountId: 'vg-acc-5', status: 'claimed' })

      await useStatsStore.getState().restoreAccount('vee', 'hunter2')

      await vi.waitFor(() => {
        expect(useStatsStore.getState().vgamesToken).toBe(upgradedToken)
      })
      expect(vgamesQuick).toHaveBeenCalledWith(secretKey, 'vee')
      expect(useStatsStore.getState().vgamesAccountId).toBe('vg-acc-5') // same account, per the measured quick-after-claim behavior
      expect(useStatsStore.getState().vgamesTokenExp).toBe(Math.floor(Date.now() / 1000) + 86_400)
      expect(useStatsStore.getState().sessionExpired).toBe(false)
    })

    it('a failed upgrade refresh leaves the successful login token intact — the user stays signed in, never regressed to signed-out', async () => {
      useStatsStore.getState().ensureAccount()
      const loginToken = makeJwt(3600)
      vi.mocked(vgamesLogin).mockResolvedValueOnce({ ok: true, token: loginToken, accountId: 'vg-acc-5', mustChangePassword: false })
      vi.mocked(vgamesQuick).mockRejectedValueOnce(new Error('network down'))

      await useStatsStore.getState().restoreAccount('vee', 'hunter2')

      // Give the fire-and-forget upgrade attempt a chance to fail and settle.
      await vi.waitFor(() => {
        expect(vgamesQuick).toHaveBeenCalledTimes(1)
      })
      expect(useStatsStore.getState().vgamesToken).toBe(loginToken) // still the working login token
      expect(useStatsStore.getState().vgamesAccountId).toBe('vg-acc-5')
      expect(useStatsStore.getState().sessionExpired).toBe(false) // NOT signed out
    })

    it('an upgrade refresh that resolves to a different/ghost identity is refused but still leaves the login token intact and does not sign the user out', async () => {
      useStatsStore.getState().ensureAccount()
      const loginToken = makeJwt(3600)
      vi.mocked(vgamesLogin).mockResolvedValueOnce({ ok: true, token: loginToken, accountId: 'vg-acc-5', mustChangePassword: false })
      // Pathological: quick resolves to a DIFFERENT/ghost identity — the
      // ensureVGamesAccount guard refuses this internally (and would
      // normally flag sessionExpired for a plain reauth caller), but the
      // login itself must not be undone by it.
      vi.mocked(vgamesQuick).mockResolvedValueOnce({ token: makeJwt(86_400), accountId: 'vg-acc-DIFFERENT', status: 'ghost' })

      await useStatsStore.getState().restoreAccount('vee', 'hunter2')

      await vi.waitFor(() => {
        expect(vgamesQuick).toHaveBeenCalledTimes(1)
      })
      expect(useStatsStore.getState().vgamesToken).toBe(loginToken) // not swapped to the refused identity
      expect(useStatsStore.getState().vgamesAccountId).toBe('vg-acc-5')
      await vi.waitFor(() => {
        expect(useStatsStore.getState().sessionExpired).toBe(false) // not left signed-out
      })
    })
  })

  describe('pullVGamesHistory', () => {
    it('restores matches (via GET /stats/history) without clobbering a secured displayName or the local friendCode', async () => {
      // A signed-in secured account whose cached display_name still lags
      // behind (guest display_name from before "Create Account" claimed it).
      // The pull must restore matches but must NOT revert the identity
      // (ADDENDUM V: "a history pull must NEVER clobber local identity
      // fields" — which would flip the account back to "guest").
      useStatsStore.setState({
        displayName: 'Alice',
        friendCode: 'VJ-1234',
        secretKey: 'sk',
        vgamesToken: 'vg-tok',
        vgamesAccountId: 'vg-acc',
        matches: [],
      })
      vi.mocked(history).mockResolvedValueOnce({
        matches: [
          {
            id: 1, opponentType: 'ai_easy', opponentAccountId: null, playerScore: 10, opponentScore: 5,
            won: true, source: 'client_reported', aiCovered: false, gameUuid: null,
            timestamp: Date.UTC(2026, 0, 1), // ADDENDUM V: D1's INTEGER column is epoch-ms already
          },
        ],
      })

      await useStatsStore.getState().pullVGamesHistory()

      const s = useStatsStore.getState()
      expect(s.matches).toHaveLength(1)
      expect(s.matches[0]).toMatchObject({ opponent_type: 'ai_easy', won: true })
      expect(s.displayName).toBe('Alice') // NOT reverted to the guest name
      expect(s.friendCode).toBe('VJ-1234') // NOT replaced by anything server-side
    })

    it('maps an online match\'s opponentAccountId onto the local opponent_id field', async () => {
      useStatsStore.setState({ vgamesToken: 'vg-tok', vgamesAccountId: 'vg-acc', matches: [] })
      vi.mocked(history).mockResolvedValueOnce({
        matches: [
          {
            id: 2, opponentType: 'online', opponentAccountId: 'acct-rival-1', playerScore: 40, opponentScore: 33,
            won: true, source: 'online_authoritative', aiCovered: false, gameUuid: 'game-uuid-1', timestamp: 1_700_000_000_000,
          },
        ],
      })

      await useStatsStore.getState().pullVGamesHistory()

      expect(useStatsStore.getState().matches[0]).toMatchObject({ opponent_type: 'online', opponent_id: 'acct-rival-1' })
    })

    it('is a no-op without a VGames token', async () => {
      vi.mocked(history).mockClear()
      useStatsStore.setState({ vgamesToken: null, matches: [] })
      await useStatsStore.getState().pullVGamesHistory()
      expect(history).not.toHaveBeenCalled()
    })
  })

  describe('claimed (account claim state)', () => {
    it('is false immediately after a fresh ghost is minted', () => {
      useStatsStore.getState().ensureAccount()
      expect(useStatsStore.getState().claimed).toBe(false)
    })

    it('persists true after a successful secureAccount (claim)', async () => {
      useStatsStore.getState().ensureAccount()
      vi.mocked(vgamesQuick).mockResolvedValueOnce({ token: 'vg-tok', accountId: 'vg-acc' })
      vi.mocked(vgamesSetCredentials).mockResolvedValueOnce({ ok: true })

      await useStatsStore.getState().secureAccount('vee', 'hunter2')

      expect(useStatsStore.getState().claimed).toBe(true)
    })

    it('does not flip claimed to true when secureAccount fails', async () => {
      useStatsStore.getState().ensureAccount() // claimed=false
      vi.mocked(vgamesQuick).mockResolvedValueOnce({ token: 'vg-tok', accountId: 'vg-acc' })
      vi.mocked(vgamesSetCredentials).mockResolvedValueOnce({ ok: false, error: 'username_taken' })

      await useStatsStore.getState().secureAccount('taken', 'pw123456')

      expect(useStatsStore.getState().claimed).toBe(false)
    })

    it('persists true after a successful restoreAccount (login)', async () => {
      useStatsStore.getState().ensureAccount()
      vi.mocked(vgamesLogin).mockResolvedValueOnce({ ok: true, token: 't', accountId: 'a', mustChangePassword: false })

      await useStatsStore.getState().restoreAccount('vee', 'hunter2')

      expect(useStatsStore.getState().claimed).toBe(true)
    })

    it('is reset to false by clearStats', () => {
      useStatsStore.setState({ claimed: true })
      useStatsStore.getState().clearStats()
      expect(useStatsStore.getState().claimed).toBe(false)
    })

    it('self-heals from the auth status on silent re-auth: status "claimed" sets claimed true', async () => {
      useStatsStore.getState().ensureAccount() // claimed=false, no cached token yet
      vi.mocked(vgamesQuick).mockResolvedValueOnce({ token: 'vg-tok', accountId: 'vg-acc', status: 'claimed' })

      await useStatsStore.getState().ensureVGamesAccount()

      expect(useStatsStore.getState().claimed).toBe(true)
    })

    it('status "ghost" on a claimed device REFUSES the downgrade instead of silently adopting it: claimed stays true, sessionExpired flips true, returns null', async () => {
      // This used to silently downgrade claimed->false, which is the exact
      // "different ghost identity" data-integrity bug the sessionExpired
      // fix exists to close — see statsStore.ts#ensureVGamesAccount.
      useStatsStore.getState().ensureAccount()
      useStatsStore.setState({ claimed: true, vgamesToken: null, vgamesAccountId: null }) // pretend a stale true
      vi.mocked(vgamesQuick).mockResolvedValueOnce({ token: 'vg-tok', accountId: 'vg-acc', status: 'ghost' })

      const result = await useStatsStore.getState().ensureVGamesAccount()

      expect(result).toBeNull()
      expect(useStatsStore.getState().claimed).toBe(true) // NOT downgraded
      expect(useStatsStore.getState().sessionExpired).toBe(true)
      expect(useStatsStore.getState().vgamesToken).toBeNull() // not adopted
      expect(useStatsStore.getState().vgamesAccountId).toBeNull() // not adopted
    })

    it('refuses a claimed->different-identity downgrade on a bare accountId mismatch, even with no status field at all', async () => {
      // Belt-and-suspenders: the guard must not depend on the worker
      // actually sending `status` — a claimed device's reauth resolving to a
      // DIFFERENT accountId is refused on its own.
      useStatsStore.getState().ensureAccount()
      useStatsStore.setState({ claimed: true, vgamesToken: 'old-tok', vgamesAccountId: 'acc-old' })
      vi.mocked(vgamesQuick).mockResolvedValueOnce({ token: 'new-tok', accountId: 'acc-new' }) // no status field

      // forceRefresh=true mirrors workerFetch's 401 retry path — the real
      // trigger for this branch (a cached token+accountId short-circuits
      // otherwise).
      const result = await useStatsStore.getState().ensureVGamesAccount(true)

      expect(result).toBeNull()
      expect(useStatsStore.getState().claimed).toBe(true)
      expect(useStatsStore.getState().sessionExpired).toBe(true)
      expect(useStatsStore.getState().vgamesToken).toBe('old-tok') // not adopted
      expect(useStatsStore.getState().vgamesAccountId).toBe('acc-old') // not adopted
    })

    it('leaves claimed untouched when the auth response omits a status (legacy worker)', async () => {
      useStatsStore.getState().ensureAccount()
      useStatsStore.setState({ claimed: undefined, vgamesToken: null, vgamesAccountId: null })
      vi.mocked(vgamesQuick).mockResolvedValueOnce({ token: 'vg-tok', accountId: 'vg-acc' }) // no status

      await useStatsStore.getState().ensureVGamesAccount()

      expect(useStatsStore.getState().claimed).toBeUndefined()
    })
  })

  describe('sessionExpired (session-expiry signal)', () => {
    it('sets sessionExpired (leaves claimed untouched) when a claimed device\'s reauth throws', async () => {
      useStatsStore.getState().ensureAccount()
      useStatsStore.setState({ claimed: true, vgamesToken: null, vgamesAccountId: null })
      vi.mocked(vgamesQuick).mockRejectedValueOnce(new Error('network down'))

      const result = await useStatsStore.getState().ensureVGamesAccount()

      expect(result).toBeNull()
      expect(useStatsStore.getState().claimed).toBe(true)
      expect(useStatsStore.getState().sessionExpired).toBe(true)
    })

    it('does NOT set sessionExpired when a never-claimed guest/ghost fails to mint (not a "signed out" event — never signed in)', async () => {
      useStatsStore.getState().ensureAccount() // claimed=false, fresh ghost
      vi.mocked(vgamesQuick).mockRejectedValueOnce(new Error('network down'))

      const result = await useStatsStore.getState().ensureVGamesAccount()

      expect(result).toBeNull()
      expect(useStatsStore.getState().sessionExpired).toBe(false)
    })

    it('a successful reauth clears a previously-set sessionExpired flag', async () => {
      useStatsStore.getState().ensureAccount()
      useStatsStore.setState({ claimed: true, vgamesToken: null, vgamesAccountId: null, sessionExpired: true })
      vi.mocked(vgamesQuick).mockResolvedValueOnce({ token: 'vg-tok', accountId: 'vg-acc', status: 'claimed' })

      await useStatsStore.getState().ensureVGamesAccount()

      expect(useStatsStore.getState().sessionExpired).toBe(false)
    })

    it('clears sessionExpired on a successful restoreAccount (login)', async () => {
      useStatsStore.getState().ensureAccount()
      useStatsStore.setState({ sessionExpired: true })
      vi.mocked(vgamesLogin).mockResolvedValueOnce({
        ok: true, token: 'vg-tok-5', accountId: 'vg-acc-5', mustChangePassword: false,
      })

      await useStatsStore.getState().restoreAccount('vee', 'hunter2')

      expect(useStatsStore.getState().sessionExpired).toBe(false)
    })

    it('clears sessionExpired on a successful secureAccount (claim)', async () => {
      useStatsStore.getState().ensureAccount()
      useStatsStore.setState({ sessionExpired: true })
      vi.mocked(vgamesQuick).mockResolvedValueOnce({ token: 'vg-tok', accountId: 'vg-acc' })
      vi.mocked(vgamesSetCredentials).mockResolvedValueOnce({ ok: true })

      await useStatsStore.getState().secureAccount('vee', 'hunter2')

      expect(useStatsStore.getState().sessionExpired).toBe(false)
    })
  })
})

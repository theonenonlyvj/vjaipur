import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { socketService } from '../socket/socketService'
import { vgamesQuick, vgamesSetCredentials, vgamesLogin } from '../auth/vgamesClient'
import { history as fetchHistory, reportMatch as reportMatchToWorker } from '../net/online'

export interface MatchRecord {
  opponent_type: string
  opponent_id?: string | null
  player_score: number
  opponent_score: number
  won: boolean
  timestamp: number
}

interface StatsState {
  friendCode: string | null
  secretKey: string | null
  displayName: string | null
  matches: MatchRecord[]
  /** Local vs-AI matches whose POST /stats/report failed (offline / worker
   *  unreachable / not-yet-authenticated) — retried on next app boot (see
   *  retryPendingReports, called from main.tsx). The local `matches` entry
   *  is NOT removed while pending; this is purely a "still owes the server a
   *  write" queue. */
  pendingReports: MatchRecord[]
  // VGames Identity (see src/auth/vgamesClient.ts). `secretKey` above doubles as
  // the device credential passed to /auth/quick — the legacy-guest bridge, so
  // existing local installs resolve to their VGames account automatically.
  vgamesToken: string | null
  vgamesAccountId: string | null
  // Explicit account claim state, authoritative over the old
  // `displayName.startsWith('Guest_')` heuristic (which broke when a guest
  // renamed themselves — see ProfileOverlay). Intentionally OPTIONAL with NO
  // initial value: legacy installs rehydrate WITHOUT this key, so `undefined`
  // is distinguishable from a real false and lets the UI fall back to the name
  // heuristic until the next auth (or an explicit claim) sets it authoritatively.
  //   undefined = unknown (legacy) · false = ghost/guest · true = claimed
  claimed?: boolean
}

interface StatsActions {
  ensureAccount: () => { friendCode: string; secretKey: string; displayName: string | null }
  ensureVGamesAccount: (forceRefresh?: boolean) => Promise<{ token: string; accountId: string } | null>
  addMatch: (match: Omit<MatchRecord, 'timestamp'>) => Promise<void>
  /** POST /stats/report for one match now (minting/reusing a VGames token
   *  first). Returns whether it actually landed — never throws. Split out of
   *  addMatch so retryPendingReports can reuse the exact same path. */
  reportMatchNow: (match: MatchRecord) => Promise<boolean>
  /** Retry every match that failed to report earlier (see pendingReports) —
   *  called once at app boot (main.tsx). */
  retryPendingReports: () => Promise<void>
  restoreAccount: (username: string, password: string) => Promise<{ ok: boolean, error?: string }>
  secureAccount: (username: string, password: string) => Promise<{ ok: boolean, error?: string }>
  setDisplayName: (name: string) => void
  pullVGamesHistory: () => Promise<void>
  clearHistory: () => void
  clearStats: () => void
}

export type StatsStore = StatsState & StatsActions

function generateFriendCode(): string {
  const digits = Math.floor(1000 + Math.random() * 9000).toString()
  return `VJ-${digits}`
}

function generateSecretKey(): string {
  return Array.from({ length: 32 }, () => 
    Math.random().toString(36)[2]
  ).join('')
}

async function waitForConnection(): Promise<void> {
  if (socketService.connected) return
  
  // Try to trigger a connection if it's not even started
  const url = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001'
  socketService.connect(url)

  return new Promise((resolve, reject) => {
    let attempts = 0
    const interval = setInterval(() => {
      attempts++
      if (socketService.connected) {
        clearInterval(interval)
        resolve()
      } else if (attempts > 100) { // 10 seconds
        clearInterval(interval)
        reject(new Error('Connection timeout'))
      }
    }, 100)
  })
}

export const useStatsStore = create<StatsStore>()(
  persist(
    (set, get) => ({
      friendCode: null,
      secretKey: null,
      displayName: null,
      matches: [],
      pendingReports: [],
      vgamesToken: null,
      vgamesAccountId: null,

      ensureAccount: () => {
        const { friendCode, secretKey, displayName } = get()
        if (friendCode && secretKey) {
          const effectiveDisplayName = displayName || `Guest_${friendCode.slice(-4)}`
          if (!displayName) {
            set({ displayName: effectiveDisplayName })
          }
          return { friendCode, secretKey, displayName: effectiveDisplayName }
        }

        const newFriendCode = generateFriendCode()
        const newSecretKey = generateSecretKey()
        const guestName = `Guest_${newFriendCode.slice(-4)}`

        set({
          friendCode: newFriendCode,
          secretKey: newSecretKey,
          displayName: guestName,
          claimed: false, // freshly minted ghost — not yet claimed
        })

        return { friendCode: newFriendCode, secretKey: newSecretKey, displayName: guestName }
      },

      // Mints (or reuses) a VGames Identity account for this device. The local
      // secretKey IS the device credential — reusing it means an existing
      // install resolves to the same VGames account it would have under the
      // old friendCode/secretKey scheme. Never round-trips a plaintext secret
      // to the vjaipur game server itself.
      ensureVGamesAccount: async (forceRefresh = false) => {
        const { vgamesToken, vgamesAccountId } = get()
        // Reuse the cached token UNLESS a caller forces a refresh. workerFetch
        // passes forceRefresh=true on a 401 — without it, an EXPIRED cached
        // token would be handed back unchanged, the retry would 401 again, and
        // the call would fail ("Failed to create room" etc.). Forcing a fresh
        // vgamesQuick mint self-heals an aged-out token (claimed accounts get
        // short-lived tokens). The device credential re-auths to the same
        // account, so identity is preserved.
        if (!forceRefresh && vgamesToken && vgamesAccountId) {
          return { token: vgamesToken, accountId: vgamesAccountId }
        }
        const { secretKey, displayName } = get().ensureAccount()
        try {
          const { token, accountId, status } = await vgamesQuick(secretKey, displayName ?? undefined)
          // Adopt the authoritative claim state when the worker reports one.
          // This self-heals legacy installs on their next silent re-auth. An
          // absent status leaves `claimed` untouched (never assume ghost).
          const patch: Partial<StatsState> = { vgamesToken: token, vgamesAccountId: accountId }
          if (status === 'claimed') patch.claimed = true
          else if (status === 'ghost') patch.claimed = false
          set(patch)
          socketService.setAuthToken(token)
          return { token, accountId }
        } catch (e) {
          console.warn('ensureVGamesAccount failed:', e)
          return null
        }
      },

      // Local vs-AI match (online matches are archived server-side and never
      // call addMatch — see gameStore's applyServerView). Records locally
      // for instant UI, then reports to the worker (source='client_reported'
      // — worker/src/do/stats.ts#reportMatch); a failed report is queued in
      // pendingReports for a retry on next boot rather than silently lost.
      addMatch: async (matchData) => {
        const newMatch: MatchRecord = {
          ...matchData,
          timestamp: Date.now(),
        }

        set((state) => ({
          matches: [newMatch, ...state.matches],
        }))

        const ok = await get().reportMatchNow(newMatch)
        if (!ok) {
          set((state) => ({ pendingReports: [...state.pendingReports, newMatch] }))
        }
      },

      reportMatchNow: async (match) => {
        const account = await get().ensureVGamesAccount()
        if (!account) return false // fail-closed: no verified identity, don't sync
        try {
          const result = await reportMatchToWorker({
            opponent_type: match.opponent_type,
            player_score: match.player_score,
            opponent_score: match.opponent_score,
            won: match.won,
            timestamp: match.timestamp,
          })
          return !!result.ok
        } catch (e) {
          console.warn('reportMatchNow failed (offline or worker unreachable):', e)
          return false
        }
      },

      retryPendingReports: async () => {
        const { pendingReports } = get()
        if (pendingReports.length === 0) return
        const stillPending: MatchRecord[] = []
        for (const match of pendingReports) {
          const ok = await get().reportMatchNow(match)
          if (!ok) stillPending.push(match)
        }
        set({ pendingReports: stillPending })
      },

      // Binds this device to an existing username+password VGames account
      // (POST /auth/login). Device credential = the local secretKey, same
      // bridge as ensureVGamesAccount. No plaintext secret is ever sent back
      // by the server — only a JWT.
      restoreAccount: async (username, password) => {
        try {
          const { secretKey } = get().ensureAccount()
          const result = await vgamesLogin(username, password, secretKey)
          if (result.ok && result.token && result.accountId) {
            set({
              vgamesToken: result.token,
              vgamesAccountId: result.accountId,
              displayName: username,
              claimed: true, // logged into an existing username+password account
            })
            socketService.setAuthToken(result.token)
            // Pull this account's match history so the career-stats panel
            // populates on a new device right after login. Fire-and-forget:
            // the store updates reactively; login itself returns immediately.
            void get().pullVGamesHistory()
            return { ok: true }
          }
          return { ok: false, error: result.error }
        } catch (e) {
          return { ok: false, error: 'Connecting to server... try again in 10 seconds' }
        }
      },

      // Claims a username+password on the current (ghost) VGames account, in
      // place (POST /auth/set-credentials). Never stores the plaintext
      // password locally — only the display name changes.
      secureAccount: async (username, password) => {
        try {
          const account = await get().ensureVGamesAccount()
          if (!account) return { ok: false, error: 'Connecting to server... try again in 10 seconds' }
          const ack = await vgamesSetCredentials(account.token, username, password)
          if (ack.ok) {
            set({ displayName: username, claimed: true }) // just claimed a username+password
          }
          return ack
        } catch (e) {
          return { ok: false, error: 'Connecting to server... try again in 10 seconds' }
        }
      },

      setDisplayName: async (name) => {
        set({ displayName: name })
        // VGames-token-gated, same bridge as addMatch/secureAccount — no
        // plaintext secret round-trips to the game server for this.
        // (ensureVGamesAccount calls ensureAccount() internally, minting a
        // friendCode/secretKey device credential first if needed.)
        const account = await get().ensureVGamesAccount()
        if (!account) return // fail-closed: no verified identity, don't sync
        try {
          await waitForConnection()
          socketService.updateProfile({ vgamesToken: account.token, displayName: name })
        } catch (e) {
          console.warn('Could not sync profile name: connection timeout')
        }
      },

      // Cross-device history restore over the worker's GET /stats/history
      // (superseded the removed legacy Socket.IO PULL_HISTORY path — see
      // worker/src/do/stats.ts#getHistory). Fetches THIS account's own
      // matches (both online_authoritative and client_reported rows) and
      // merges them into the local career-stats panel. No-op without a
      // VGames token. Also called by gameStore on every online match_over so
      // the server-authoritative row shows up without a local addMatch()
      // double-write (see applyServerView).
      pullVGamesHistory: async () => {
        const { vgamesToken } = get()
        if (!vgamesToken) return
        try {
          const { matches: rows } = await fetchHistory()
          const cloud: MatchRecord[] = rows.map((m) => ({
            opponent_type: m.opponentType,
            opponent_id: m.opponentAccountId ?? null,
            player_score: m.playerScore,
            opponent_score: m.opponentScore,
            won: m.won,
            timestamp: m.timestamp, // already epoch-ms (ADDENDUM V — D1's INTEGER column)
          }))
          // Merge server history with any local matches not yet synced up,
          // de-duped by timestamp (string-vs-number normalized defensively —
          // a pre-migration localStorage row could still carry an ISO
          // string), newest first.
          const cloudTs = new Set(cloud.map((m) => m.timestamp))
          const localUnsynced = get().matches.filter((m) => {
            const ts = typeof m.timestamp === 'string' ? new Date(m.timestamp).getTime() : m.timestamp
            return !cloudTs.has(ts)
          })
          const merged = [...localUnsynced, ...cloud].sort((a, b) => {
            const ta = typeof a.timestamp === 'string' ? new Date(a.timestamp).getTime() : a.timestamp
            const tb = typeof b.timestamp === 'string' ? new Date(b.timestamp).getTime() : b.timestamp
            return tb - ta
          })
          // Only restore MATCHES here — never displayName/friendCode/claimed
          // (ADDENDUM V: "a history pull must NEVER clobber local identity
          // fields"). displayName is already authoritative locally (login
          // sets it to the username; boot restores it from persistence), and
          // the server's cached display_name can lag a fresh "Create
          // Account" (still the old guest name) — adopting it would flip a
          // secured account back to "guest".
          set({ matches: merged })
        } catch (e) {
          console.warn('pullVGamesHistory failed (offline or worker unreachable):', e)
        }
      },

      clearHistory: () => {
        set({ matches: [] })
      },

      clearStats: () => {
        set({
          friendCode: null,
          secretKey: null,
          displayName: null,
          matches: [],
          pendingReports: [],
          vgamesToken: null,
          vgamesAccountId: null,
          claimed: false, // reset to a fresh, unclaimed guest
        })
      },
    }),
    {
      name: 'vjaipur-stats',
    }
  )
)

// Selectors for aggregates
export const useStatsAggregates = () => {
  const matches = useStatsStore((state) => state.matches)

  const totalMatches = matches.length
  const wins = matches.filter((m) => m.won).length
  const losses = totalMatches - wins
  const winRate = totalMatches > 0 ? (wins / totalMatches) * 100 : 0
  const totalDelta = matches.reduce(
    (acc, m) => acc + (m.player_score - m.opponent_score),
    0
  )

  return {
    totalMatches,
    wins,
    losses,
    winRate,
    totalDelta,
  }
}

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { socketService } from '../socket/socketService'
import { vgamesQuick, vgamesSetCredentials, vgamesLogin } from '../auth/vgamesClient'
import type { SyncMatchPayload } from '../shared/protocol'

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
  ensureVGamesAccount: () => Promise<{ token: string; accountId: string } | null>
  addMatch: (match: Omit<MatchRecord, 'timestamp'>) => Promise<void>
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
      ensureVGamesAccount: async () => {
        const { vgamesToken, vgamesAccountId } = get()
        if (vgamesToken && vgamesAccountId) {
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

      addMatch: async (matchData) => {
        const { displayName } = get().ensureAccount()
        const newMatch: MatchRecord = {
          ...matchData,
          timestamp: Date.now(),
        }

        set((state) => ({
          matches: [newMatch, ...state.matches],
        }))

        const account = await get().ensureVGamesAccount()
        if (!account) return // fail-closed: no verified identity, don't sync

        const payload: SyncMatchPayload = {
          vgamesToken: account.token,
          displayName: displayName || undefined,
          match: {
            opponent_type: newMatch.opponent_type,
            opponent_id: newMatch.opponent_id,
            player_score: newMatch.player_score,
            opponent_score: newMatch.opponent_score,
            won: newMatch.won,
            timestamp: newMatch.timestamp,
          },
        }
        socketService.syncMatch(payload)
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

      // Cross-device history restore over the VGames-authenticated socket
      // (superseded the removed legacy RESTORE_ACCOUNT path). Fetches THIS
      // account's own matches from the server (Supabase, dual-run) and merges
      // them into the local career-stats panel. No-op without a VGames token.
      pullVGamesHistory: async () => {
        const { vgamesToken } = get()
        if (!vgamesToken) return
        // Render free-tier servers cold-start (~50s), which can exceed
        // waitForConnection's 10s window on a fresh boot. Retry the connect
        // wait (bounded) so the pull still lands once the socket comes up.
        let connected = false
        for (let attempt = 0; attempt < 6; attempt++) {
          try { await waitForConnection(); connected = true; break }
          catch { await new Promise((r) => setTimeout(r, 8000)) }
        }
        if (!connected) { console.warn('pullVGamesHistory: server unreachable after retries'); return }
        try {
          const ack = await socketService.pullHistory({ vgamesToken })
          if (!ack || !ack.ok || !ack.matches) return
          const cloud: MatchRecord[] = ack.matches.map((m) => ({
            opponent_type: m.opponent_type,
            opponent_id: m.opponent_id ?? null,
            player_score: m.player_score,
            opponent_score: m.opponent_score,
            won: m.won,
            timestamp: typeof m.timestamp === 'string' ? new Date(m.timestamp).getTime() : m.timestamp,
          }))
          // Merge server history with any local matches not yet synced up,
          // de-duped by timestamp, newest first.
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
          // Only restore MATCHES here. displayName is already authoritative
          // locally (login sets it to the username; boot restores it from
          // persistence), and the server's Supabase display_name can lag a
          // fresh "Create Account" (still the old guest name) — adopting it
          // would flip a secured account back to "guest". friendCode likewise
          // stays local: the server row holds only the synthetic cosmetic
          // VG-#### code, never the user's real VJ-####.
          set({ matches: merged })
        } catch (e) {
          console.warn('pullVGamesHistory failed (offline or server waking up)')
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

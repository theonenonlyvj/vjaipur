import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { socketService } from '../socket/socketService'
import type { SyncMatchPayload, RestoreAccountAck } from '../shared/protocol'

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
}

interface StatsActions {
  ensureAccount: () => { friendCode: string; secretKey: string; displayName: string | null }
  addMatch: (match: Omit<MatchRecord, 'timestamp'>) => void
  restoreAccount: (username: string, password: string) => Promise<{ ok: boolean, error?: string }>
  secureAccount: (username: string, password: string) => Promise<{ ok: boolean, error?: string }>
  setDisplayName: (name: string) => void
  syncFullHistory: () => Promise<void>
  pullFullHistory: () => Promise<void>
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
        })

        return { friendCode: newFriendCode, secretKey: newSecretKey, displayName: guestName }
      },

      addMatch: (matchData) => {
        const { friendCode, secretKey, displayName } = get().ensureAccount()
        const newMatch: MatchRecord = {
          ...matchData,
          timestamp: Date.now(),
        }

        set((state) => ({
          matches: [newMatch, ...state.matches],
        }))

        const isGuest = displayName?.startsWith('Guest_')

        // Sync with server
        const payload: SyncMatchPayload = {
          friendCode,
          secretKey,
          username: !isGuest ? displayName! : undefined,
          password: !isGuest ? secretKey : undefined,
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

      restoreAccount: async (username, password) => {
        try {
          await waitForConnection()
          const ack = await socketService.restoreAccount({ username, password })
          if (ack.ok && ack.friendCode && ack.secretKey) {
            set({
              matches: ack.matches || [],
              friendCode: ack.friendCode,
              secretKey: ack.secretKey,
              displayName: ack.displayName || null,
            })
          }
          return ack
        } catch (e) {
          return { ok: false, error: 'Connecting to server... try again in 10 seconds' }
        }
      },

      secureAccount: async (username, password) => {
        try {
          await waitForConnection()
          const { friendCode } = get().ensureAccount()
          const ack = await socketService.secureAccount({ friendCode, username, password })
          if (ack.ok) {
            set({
              displayName: username,
              secretKey: password,
            })
          }
          return ack
        } catch (e) {
          return { ok: false, error: 'Connecting to server... try again in 10 seconds' }
        }
      },

      setDisplayName: async (name) => {
        set({ displayName: name })
        const { friendCode, secretKey } = get().ensureAccount()
        try {
          await waitForConnection()
          socketService.updateProfile({ friendCode, secretKey, displayName: name })
        } catch (e) {
          console.warn('Could not sync profile name: connection timeout')
        }
      },

      syncFullHistory: async () => {
        const { matches, friendCode, secretKey, displayName } = get()
        if (!friendCode || !secretKey) return

        try {
          await waitForConnection()
          
          // First, get the current cloud record to see what's already there
          let cloudMatches: MatchRecord[] = []
          const isGuest = displayName?.startsWith('Guest_')
          let ack: RestoreAccountAck
          if (!isGuest && displayName) {
            ack = await socketService.restoreAccount({ username: displayName, password: secretKey })
          } else {
            ack = await socketService.restoreAccount({ friendCode, secretKey })
          }
          if (ack.ok && ack.matches) cloudMatches = ack.matches

          const cloudTimestamps = new Set(cloudMatches.map(m => 
            typeof m.timestamp === 'string' ? new Date(m.timestamp).getTime() : m.timestamp
          ))

          // Only sync matches that DON'T exist in the cloud
          const toSync = matches.filter(m => {
            const ts = typeof m.timestamp === 'string' ? new Date(m.timestamp).getTime() : m.timestamp
            return !cloudTimestamps.has(ts)
          }).reverse()
          for (const m of toSync) {
            socketService.syncMatch({
              friendCode,
              secretKey,
              username: !isGuest ? displayName! : undefined,
              password: !isGuest ? secretKey : undefined,
              displayName: displayName || undefined,
              match: {
                opponent_type: m.opponent_type,
                opponent_id: m.opponent_id,
                player_score: m.player_score,
                opponent_score: m.opponent_score,
                won: m.won,
                timestamp: m.timestamp,
              }
            })
            // Small delay to avoid flooding socket if there are many matches
            await new Promise(r => setTimeout(r, 50))
          }

          // Wait a bit to ensure DB inserts are processed
          await new Promise(r => setTimeout(r, 1000))
          // Refresh local state with the final merged set from cloud
          await get().pullFullHistory()
        } catch (e) {
          console.error('syncFullHistory failed:', e)
        }
      },

      pullFullHistory: async () => {
        const { displayName, secretKey, friendCode } = get()
        if (!secretKey) return

        try {
          await waitForConnection()
          
          let ack: RestoreAccountAck
          const isGuest = displayName?.startsWith('Guest_')
          
          if (!isGuest && displayName) {
            // Secured account: pull by username
            ack = await socketService.restoreAccount({ username: displayName, password: secretKey })
          } else if (friendCode) {
            // Guest account: pull by friendCode + secretKey (the long auto-gen one)
            // We'll need to update restoreAccount to handle this on the server
            ack = await socketService.restoreAccount({ friendCode, secretKey })
          } else {
            return
          }

          if (ack.ok && ack.matches) {
            const cloudMatches = ack.matches
            const cloudTimestamps = new Set(cloudMatches.map(m => 
              typeof m.timestamp === 'string' ? new Date(m.timestamp).getTime() : m.timestamp
            ))
            
            const localMatches = get().matches
            const unsyncedLocal = localMatches.filter(m => {
               const localTs = typeof m.timestamp === 'string' ? new Date(m.timestamp).getTime() : m.timestamp
               return !cloudTimestamps.has(localTs)
            })

            const merged = [...unsyncedLocal, ...cloudMatches].sort((a, b) => {
                 const tA = typeof a.timestamp === 'string' ? new Date(a.timestamp).getTime() : a.timestamp
                 const tB = typeof b.timestamp === 'string' ? new Date(b.timestamp).getTime() : b.timestamp
                 return tB - tA
            })

            set({ 
              matches: merged,
              displayName: ack.displayName || get().displayName,
              friendCode: ack.friendCode || get().friendCode,
              secretKey: ack.secretKey || get().secretKey,
            })
          }
        } catch (e) {
          console.warn('pullFullHistory failed (likely offline or server waking up)')
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

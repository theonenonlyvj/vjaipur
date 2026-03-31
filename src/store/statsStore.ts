import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { socketService } from '../socket/socketService'
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
}

interface StatsActions {
  ensureAccount: () => { friendCode: string; secretKey: string; displayName: string | null }
  addMatch: (match: Omit<MatchRecord, 'timestamp'>) => void
  restoreAccount: (matches: MatchRecord[], friendCode: string, secretKey: string, displayName?: string | null) => void
  setDisplayName: (name: string) => void
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
          return { friendCode, secretKey, displayName }
        }

        const newFriendCode = generateFriendCode()
        const newSecretKey = generateSecretKey()

        set({
          friendCode: newFriendCode,
          secretKey: newSecretKey,
        })

        return { friendCode: newFriendCode, secretKey: newSecretKey, displayName: null }
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

        // Sync with server
        const payload: SyncMatchPayload = {
          friendCode,
          secretKey,
          displayName: displayName || undefined,
          match: {
            opponent_type: newMatch.opponent_type,
            opponent_id: newMatch.opponent_id,
            player_score: newMatch.player_score,
            opponent_score: newMatch.opponent_score,
            won: newMatch.won,
          },
        }
        socketService.syncMatch(payload)
      },

      restoreAccount: (matches, friendCode, secretKey, displayName) => {
        set({
          matches,
          friendCode,
          secretKey,
          displayName: displayName || null,
        })
      },

      setDisplayName: (name) => {
        set({ displayName: name })
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

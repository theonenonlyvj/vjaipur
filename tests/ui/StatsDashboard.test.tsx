import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { StatsDashboard } from '../../src/components/StatsDashboard'
import { useStatsStore } from '../../src/store/statsStore'
import type { LeaderboardResponse } from '../../src/net/online'
import * as onlineApi from '../../src/net/online'

// Mock socket service as it's used transitively by statsStore (mirrors
// StatsStrip.test.tsx / ProfileOverlay.test.tsx's pattern).
vi.mock('../../src/socket/socketService', () => ({
  socketService: {
    connect: vi.fn(),
    connected: false,
    setAuthToken: vi.fn(),
    updateProfile: vi.fn(),
  },
}))

const UNFILTERED: LeaderboardResponse = {
  overall: [{ accountId: 'acct-1', displayName: 'Alice', games: 5, wins: 4, winRate: 0.8 }],
  verified: [{ accountId: 'acct-1', displayName: 'Alice', games: 3, wins: 2, winRate: 0.667 }],
  availableOpponents: ['online', 'medium', 'fair', 'hard'],
}

const ONLINE_ONLY: LeaderboardResponse = {
  overall: [{ accountId: 'acct-2', displayName: 'Bob', games: 3, wins: 3, winRate: 1 }],
  verified: [{ accountId: 'acct-2', displayName: 'Bob', games: 3, wins: 3, winRate: 1 }],
}

const MEDIUM_ONLY: LeaderboardResponse = {
  overall: [{ accountId: 'acct-3', displayName: 'Carol', games: 4, wins: 1, winRate: 0.25 }],
  verified: [],
}

beforeEach(() => {
  useStatsStore.getState().clearStats()
  vi.spyOn(onlineApi, 'leaderboard').mockReset()
})

async function openGlobal() {
  render(<StatsDashboard onClose={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'GLOBAL' }))
  await waitFor(() => expect(onlineApi.leaderboard).toHaveBeenCalled())
}

describe('StatsDashboard global leaderboard opponent-filter toggle', () => {
  it('fetches the unfiltered board (no opponentType) when GLOBAL is first opened', async () => {
    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(UNFILTERED)
    await openGlobal()
    expect(onlineApi.leaderboard).toHaveBeenCalledWith(undefined)
  })

  it('renders "All" plus a toggle for every availableOpponents entry, labeled via tiers.ts', async () => {
    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(UNFILTERED)
    await openGlobal()
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())

    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Online' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Medium' })).toBeInTheDocument()
    // Retired tiers get their tiers.ts historical labels, not raw ids.
    expect(screen.getByRole('button', { name: 'Hard (FairBot, Classic)' })).toBeInTheDocument() // 'fair'
    expect(screen.getByRole('button', { name: 'Hard (Classic)' })).toBeInTheDocument() // 'hard'
  })

  it('does NOT show a toggle for a tier with no data (e.g. Easy/hard2/hard3 absent from availableOpponents)', async () => {
    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(UNFILTERED)
    await openGlobal()
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())

    expect(screen.queryByRole('button', { name: 'Easy' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Hard' })).not.toBeInTheDocument() // active hard2's label
    expect(screen.queryByRole('button', { name: 'Omniscient Bot' })).not.toBeInTheDocument()
  })

  it('clicking a filter re-fetches with that opponentType and shows its rows', async () => {
    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(UNFILTERED)
    await openGlobal()
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())

    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(ONLINE_ONLY)
    fireEvent.click(screen.getByRole('button', { name: 'Online' }))

    await waitFor(() => expect(onlineApi.leaderboard).toHaveBeenCalledWith('online'))
    await waitFor(() => expect(screen.getByText('Bob')).toBeInTheDocument())
    expect(screen.queryByText('Alice')).not.toBeInTheDocument()
  })

  it('clicking a bot filter passes the exact tier id, not its label', async () => {
    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(UNFILTERED)
    await openGlobal()
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())

    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(MEDIUM_ONLY)
    fireEvent.click(screen.getByRole('button', { name: 'Medium' }))

    await waitFor(() => expect(onlineApi.leaderboard).toHaveBeenCalledWith('medium'))
    await waitFor(() => expect(screen.getByText('Carol')).toBeInTheDocument())
  })

  it('hides the Overall/Verified sub-tabs once a specific opponent filter is selected', async () => {
    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(UNFILTERED)
    await openGlobal()
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Verified Online' })).toBeInTheDocument()

    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(ONLINE_ONLY)
    fireEvent.click(screen.getByRole('button', { name: 'Online' }))
    await waitFor(() => expect(screen.getByText('Bob')).toBeInTheDocument())

    expect(screen.queryByRole('button', { name: 'Verified Online' })).not.toBeInTheDocument()
  })

  it('clicking back to "All" re-fetches the unfiltered board', async () => {
    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(UNFILTERED)
    await openGlobal()
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())

    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(ONLINE_ONLY)
    fireEvent.click(screen.getByRole('button', { name: 'Online' }))
    await waitFor(() => expect(screen.getByText('Bob')).toBeInTheDocument())

    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(UNFILTERED)
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    await waitFor(() => expect(onlineApi.leaderboard).toHaveBeenLastCalledWith(undefined))
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())
  })
})

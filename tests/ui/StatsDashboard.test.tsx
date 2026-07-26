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

// The state after the 2026-07-21 tier-family REASSIGNMENT (Vijay's
// data-backed call, do not revert): the two retired Classic tiers ('hard' =
// Classic MCTS, 'fair' = FairBot) moved from `family: 'hard'` to
// `family: 'medium'` — each benchmarked only ~70%/73% vs Medium, nowhere
// near the ~100% the real hard family (hard2/ismcts) runs. 'medium' itself
// now carries `family: 'medium'` as that family's own canonical member. The
// 'hard' family is now ONLY hard2 + ismcts.
//
// This fixture has data for every member of BOTH families at once, so the
// top row collapses TWO chips ("Medium" and "Hard") via the exact same
// generic mechanism (src/ai/tiers.ts + StatsDashboard's
// buildOpponentGroups/getFamilyMembers) — zero component-side branching per
// family.
const UNFILTERED: LeaderboardResponse = {
  overall: [{ accountId: 'acct-1', displayName: 'Alice', games: 5, wins: 4, winRate: 0.8 }],
  verified: [{ accountId: 'acct-1', displayName: 'Alice', games: 3, wins: 2, winRate: 0.667 }],
  availableOpponents: ['online', 'medium', 'hard', 'fair', 'hard2', 'ismcts'],
}

const ONLINE_ONLY: LeaderboardResponse = {
  overall: [{ accountId: 'acct-2', displayName: 'Bob', games: 3, wins: 3, winRate: 1 }],
  verified: [{ accountId: 'acct-2', displayName: 'Bob', games: 3, wins: 3, winRate: 1 }],
}

// Only 'medium' itself has data (hard/fair don't) — used for the flat
// single-data-member-family scenario.
const MEDIUM_ONLY: LeaderboardResponse = {
  overall: [{ accountId: 'acct-3', displayName: 'Carol', games: 4, wins: 1, winRate: 0.25 }],
  verified: [],
}

// The "Medium" family's aggregate — all 3 members (medium, hard, fair).
const MEDIUM_FAMILY_AGGREGATE: LeaderboardResponse = {
  overall: [{ accountId: 'acct-4', displayName: 'Dave', games: 9, wins: 6, winRate: 0.667 }],
  verified: [],
}

// Drilled into just the 'hard' member (label "Hard (Classic)") within the
// Medium family drill-down.
const MEDIUM_CLASSIC_ONLY: LeaderboardResponse = {
  overall: [{ accountId: 'acct-5', displayName: 'Eve', games: 4, wins: 1, winRate: 0.25 }],
  verified: [],
}

// A snapshot where only hard2 (of the Hard family) has data — used for the
// flat single-data-member-family scenario.
const SOLO_HARD2_AVAILABLE: LeaderboardResponse = {
  overall: [{ accountId: 'acct-6', displayName: 'Frank', games: 2, wins: 2, winRate: 1 }],
  verified: [],
  availableOpponents: ['medium', 'hard2'],
}

// The "Hard" family's aggregate — both (now only) members: hard2, ismcts.
const HARD_FAMILY_AGGREGATE: LeaderboardResponse = {
  overall: [{ accountId: 'acct-7', displayName: 'Grace', games: 7, wins: 5, winRate: 0.714 }],
  verified: [],
}

// Drilled into just the 'ismcts' member (label "Hard (ISMCTS)") within the
// Hard family drill-down.
const ISMCTS_ONLY: LeaderboardResponse = {
  overall: [{ accountId: 'acct-8', displayName: 'Heidi', games: 5, wins: 4, winRate: 0.8 }],
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

describe('StatsDashboard global leaderboard — top-level toggle row', () => {
  it('fetches the unfiltered board (no opponentType) when GLOBAL is first opened', async () => {
    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(UNFILTERED)
    await openGlobal()
    expect(onlineApi.leaderboard).toHaveBeenCalledWith(undefined)
  })

  it('shows exactly All, the collapsed "Medium" family, the collapsed "Hard" family, and Online — not the raw member labels', async () => {
    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(UNFILTERED)
    await openGlobal()
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())

    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument()
    // 'Medium' the family chip borrows the canonical 'medium' tier's own
    // label — its two demoted members (hard/fair) don't get their own
    // top-level chip anymore.
    expect(screen.getByRole('button', { name: 'Medium' })).toBeInTheDocument()
    // 'Hard' the family chip borrows hard2's own label.
    expect(screen.getByRole('button', { name: 'Hard' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Online' })).toBeInTheDocument()
    // The individual members' own labels don't clutter the top row — they
    // only appear inside each family's own drill-down (see the describe
    // blocks below).
    expect(screen.queryByRole('button', { name: 'Hard (Classic)' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Hard (FairBot, Classic)' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Hard (ISMCTS)' })).not.toBeInTheDocument()
  })

  it('does NOT show a toggle for a tier with no data at all (Easy/Omniscient Bot absent from availableOpponents)', async () => {
    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(UNFILTERED)
    await openGlobal()
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())

    expect(screen.queryByRole('button', { name: 'Easy' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Omniscient Bot' })).not.toBeInTheDocument()
  })

  it('clicking "Medium" re-fetches with the full family id list (not a plain string) and shows its aggregate rows', async () => {
    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(UNFILTERED)
    await openGlobal()
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())

    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(MEDIUM_FAMILY_AGGREGATE)
    fireEvent.click(screen.getByRole('button', { name: 'Medium' }))

    // Medium is now a family: this fetches every declared member
    // (src/ai/tiers.ts), not just a bare 'medium' string.
    await waitFor(() => expect(onlineApi.leaderboard).toHaveBeenCalledWith(['medium', 'hard', 'fair']))
    await waitFor(() => expect(screen.getByText('Dave')).toBeInTheDocument())
    expect(screen.queryByText('Alice')).not.toBeInTheDocument()
  })

  it('clicking "Online" re-fetches with that opponentType and shows its rows', async () => {
    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(UNFILTERED)
    await openGlobal()
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())

    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(ONLINE_ONLY)
    fireEvent.click(screen.getByRole('button', { name: 'Online' }))

    await waitFor(() => expect(onlineApi.leaderboard).toHaveBeenCalledWith('online'))
    await waitFor(() => expect(screen.getByText('Bob')).toBeInTheDocument())
    expect(screen.queryByText('Alice')).not.toBeInTheDocument()
  })

  it('hides the Overall/Verified sub-tabs once a specific top-level filter is selected', async () => {
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

describe('StatsDashboard global leaderboard — "Medium" family drill-down', () => {
  it('selecting "Medium" fetches the full family id list (comma-list) and defaults to "All Medium"', async () => {
    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(UNFILTERED)
    await openGlobal()
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())

    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(MEDIUM_FAMILY_AGGREGATE)
    fireEvent.click(screen.getByRole('button', { name: 'Medium' }))

    // Every declared family member (src/ai/tiers.ts), not just the
    // data-bearing ones — see StatsDashboard.tsx's fetchArgFor docstring.
    await waitFor(() => expect(onlineApi.leaderboard).toHaveBeenCalledWith(['medium', 'hard', 'fair']))
    await waitFor(() => expect(screen.getByText('Dave')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'All Medium' })).toBeInTheDocument()
  })

  it('shows one drill-down chip per data-bearing family member: Medium, Hard (Classic), Hard (FairBot, Classic)', async () => {
    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(UNFILTERED)
    await openGlobal()
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())

    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(MEDIUM_FAMILY_AGGREGATE)
    fireEvent.click(screen.getByRole('button', { name: 'Medium' }))
    await waitFor(() => expect(screen.getByText('Dave')).toBeInTheDocument())

    // The 'Medium' member chip (for the 'medium' tier itself) shares its
    // text with the still-visible top-level family chip — TWO buttons
    // named "Medium" once the drill-down row is open.
    expect(screen.getAllByRole('button', { name: 'Medium' })).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Hard (Classic)' })).toBeInTheDocument() // 'hard'
    expect(screen.getByRole('button', { name: 'Hard (FairBot, Classic)' })).toBeInTheDocument() // 'fair'
  })

  it('clicking a member chip fetches just that id (a plain string) and updates the board', async () => {
    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(UNFILTERED)
    await openGlobal()
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())

    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(MEDIUM_FAMILY_AGGREGATE)
    fireEvent.click(screen.getByRole('button', { name: 'Medium' }))
    await waitFor(() => expect(screen.getByText('Dave')).toBeInTheDocument())

    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(MEDIUM_CLASSIC_ONLY)
    fireEvent.click(screen.getByRole('button', { name: 'Hard (Classic)' }))

    await waitFor(() => expect(onlineApi.leaderboard).toHaveBeenCalledWith('hard'))
    await waitFor(() => expect(screen.getByText('Eve')).toBeInTheDocument())
    expect(screen.queryByText('Dave')).not.toBeInTheDocument()
  })

  it('selecting a different top-level filter hides the drill-down row entirely', async () => {
    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(UNFILTERED)
    await openGlobal()
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())

    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(MEDIUM_FAMILY_AGGREGATE)
    fireEvent.click(screen.getByRole('button', { name: 'Medium' }))
    await waitFor(() => expect(screen.getByText('Dave')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'All Medium' })).toBeInTheDocument()

    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(ONLINE_ONLY)
    fireEvent.click(screen.getByRole('button', { name: 'Online' }))
    await waitFor(() => expect(screen.getByText('Bob')).toBeInTheDocument())

    expect(screen.queryByRole('button', { name: 'All Medium' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Hard (Classic)' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Hard (FairBot, Classic)' })).not.toBeInTheDocument()
  })

  it('re-selecting "Medium" after drilling into a member resets back to the "All Medium" default', async () => {
    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(UNFILTERED)
    await openGlobal()
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())

    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(MEDIUM_FAMILY_AGGREGATE)
    fireEvent.click(screen.getByRole('button', { name: 'Medium' }))
    await waitFor(() => expect(screen.getByText('Dave')).toBeInTheDocument())

    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(MEDIUM_CLASSIC_ONLY)
    fireEvent.click(screen.getByRole('button', { name: 'Hard (Classic)' }))
    await waitFor(() => expect(screen.getByText('Eve')).toBeInTheDocument())

    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(ONLINE_ONLY)
    fireEvent.click(screen.getByRole('button', { name: 'Online' }))
    await waitFor(() => expect(screen.getByText('Bob')).toBeInTheDocument())

    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(MEDIUM_FAMILY_AGGREGATE)
    fireEvent.click(screen.getByRole('button', { name: 'Medium' }))

    await waitFor(() => expect(onlineApi.leaderboard).toHaveBeenLastCalledWith(['medium', 'hard', 'fair']))
    await waitFor(() => expect(screen.getByText('Dave')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'All Medium' })).toBeInTheDocument()
  })
})

describe('StatsDashboard global leaderboard — "Hard" family drill-down', () => {
  it('selecting "Hard" fetches the full (now 2-member) family id list and defaults to "All Hard"', async () => {
    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(UNFILTERED)
    await openGlobal()
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())

    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(HARD_FAMILY_AGGREGATE)
    fireEvent.click(screen.getByRole('button', { name: 'Hard' }))

    // The 'hard' family no longer includes the demoted 'hard'/'fair'
    // Classics — just hard2 and ismcts.
    await waitFor(() => expect(onlineApi.leaderboard).toHaveBeenCalledWith(['hard2', 'ismcts']))
    await waitFor(() => expect(screen.getByText('Grace')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'All Hard' })).toBeInTheDocument()
  })

  it('shows one drill-down chip per family member: Hard (hard2) and Hard (ISMCTS)', async () => {
    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(UNFILTERED)
    await openGlobal()
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())

    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(HARD_FAMILY_AGGREGATE)
    fireEvent.click(screen.getByRole('button', { name: 'Hard' }))
    await waitFor(() => expect(screen.getByText('Grace')).toBeInTheDocument())

    // Post-rename (Vijay 2026-07-21): hard2's member chip is "Hard (αβ)",
    // distinct from the family umbrella chip "Hard" (FAMILY_LABELS) — so
    // exactly ONE button each, no shared-name ambiguity anymore.
    expect(screen.getAllByRole('button', { name: 'Hard' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Hard (αβ)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hard (ISMCTS)' })).toBeInTheDocument()
  })

  it('clicking the "Hard (ISMCTS)" chip fetches just that id and updates the board', async () => {
    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(UNFILTERED)
    await openGlobal()
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())

    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(HARD_FAMILY_AGGREGATE)
    fireEvent.click(screen.getByRole('button', { name: 'Hard' }))
    await waitFor(() => expect(screen.getByText('Grace')).toBeInTheDocument())

    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(ISMCTS_ONLY)
    fireEvent.click(screen.getByRole('button', { name: 'Hard (ISMCTS)' }))

    await waitFor(() => expect(onlineApi.leaderboard).toHaveBeenCalledWith('ismcts'))
    await waitFor(() => expect(screen.getByText('Heidi')).toBeInTheDocument())
    expect(screen.queryByText('Grace')).not.toBeInTheDocument()
  })

  it('selecting a different top-level filter hides the drill-down row entirely', async () => {
    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(UNFILTERED)
    await openGlobal()
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())

    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(HARD_FAMILY_AGGREGATE)
    fireEvent.click(screen.getByRole('button', { name: 'Hard' }))
    await waitFor(() => expect(screen.getByText('Grace')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'All Hard' })).toBeInTheDocument()

    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(ONLINE_ONLY)
    fireEvent.click(screen.getByRole('button', { name: 'Online' }))
    await waitFor(() => expect(screen.getByText('Bob')).toBeInTheDocument())

    expect(screen.queryByRole('button', { name: 'All Hard' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Hard (ISMCTS)' })).not.toBeInTheDocument()
  })
})

describe('StatsDashboard global leaderboard — family collapse threshold (<2 data-bearing members stays flat)', () => {
  it('a family with only ONE data-bearing member behaves like a flat chip — no drill-down at all', async () => {
    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(SOLO_HARD2_AVAILABLE)
    await openGlobal()
    await waitFor(() => expect(screen.getByText('Frank')).toBeInTheDocument())

    // Hard: only hard2 has data (ismcts doesn't). A single-member "family"
    // renders as a flat chip under the MEMBER'S own label — "Hard (αβ)" post-
    // rename — fetches that member's own id directly (never a 1-element
    // list), and never shows a drill-down (nothing to pick).
    expect(screen.getByRole('button', { name: 'Hard (αβ)' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Hard (αβ)' }))
    await waitFor(() => expect(onlineApi.leaderboard).toHaveBeenLastCalledWith('hard2'))
    expect(screen.queryByRole('button', { name: 'All Hard' })).not.toBeInTheDocument()
  })

  it('the same threshold applies independently to the Medium family: only "medium" has data (hard/fair do not) stays flat too', async () => {
    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue({
      overall: [{ accountId: 'acct-9', displayName: 'Ivan', games: 6, wins: 2, winRate: 0.333 }],
      verified: [],
      availableOpponents: ['medium', 'hard2', 'ismcts'],
    } satisfies LeaderboardResponse)
    await openGlobal()
    await waitFor(() => expect(screen.getByText('Ivan')).toBeInTheDocument())

    // Hard: BOTH hard2 and ismcts have data here, so it's a real 2-member
    // collapsed family (confirms the two families' thresholds are checked
    // fully independently of one another).
    expect(screen.getByRole('button', { name: 'Hard' })).toBeInTheDocument()

    // Medium: only 'medium' itself has data — buildOpponentGroups renders
    // it as a flat chip (no "All Medium" drill-down row, since there's
    // nothing to drill into). But fetchArgFor's family check is purely
    // string-based (`FAMILIES.includes(filter)`), and 'medium' the tier id
    // IS ALSO 'medium' the family tag — so the underlying fetch still goes
    // out for the family's full declared roster, not a bare 'medium'. UI
    // and fetch-arg are two independent codepaths in the component; this
    // is real, current src behavior, not a test assumption.
    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(MEDIUM_ONLY)
    fireEvent.click(screen.getByRole('button', { name: 'Medium' }))
    await waitFor(() => expect(onlineApi.leaderboard).toHaveBeenLastCalledWith(['medium', 'hard', 'fair']))
    await waitFor(() => expect(screen.getByText('Carol')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'All Medium' })).not.toBeInTheDocument()
  })
})

describe('StatsDashboard MY RECORDS — pending-sync banner + Sync now', () => {
  it('shows the pending banner with the count and drains the queue via Sync now', async () => {
    useStatsStore.setState({
      pendingReports: [
        { opponent_type: 'ismcts', player_score: 80, opponent_score: 70, won: true, timestamp: 111 },
        { opponent_type: 'ismcts', player_score: 60, opponent_score: 75, won: false, timestamp: 222 },
      ],
    })
    const retrySpy = vi
      .spyOn(useStatsStore.getState(), 'retryPendingReports')
      .mockImplementation(async () => {
        useStatsStore.setState({ pendingReports: [] })
      })
    useStatsStore.setState({ retryPendingReports: retrySpy as any })

    render(<StatsDashboard onClose={() => {}} />)
    expect(screen.getByText(/2 finished games not yet/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /sync now/i }))
    await waitFor(() => expect(retrySpy).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByText(/not yet\s*synced/i)).not.toBeInTheDocument())
  })

  it('renders no banner when nothing is pending', () => {
    useStatsStore.setState({ pendingReports: [] })
    render(<StatsDashboard onClose={() => {}} />)
    expect(screen.queryByText(/not yet/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sync now/i })).not.toBeInTheDocument()
  })

  it('shows a Log In CTA (not Sync now) when sessionExpired is true — Sync Now cannot succeed until login happens first', () => {
    useStatsStore.setState({
      pendingReports: [
        { opponent_type: 'ismcts', player_score: 80, opponent_score: 70, won: true, timestamp: 111 },
      ],
      sessionExpired: true,
    })

    render(<StatsDashboard onClose={() => {}} />)

    expect(screen.getByRole('button', { name: /^log in$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sync now/i })).not.toBeInTheDocument()
  })

  it('Log In CTA opens ProfileOverlay', () => {
    useStatsStore.setState({
      pendingReports: [
        { opponent_type: 'ismcts', player_score: 80, opponent_score: 70, won: true, timestamp: 111 },
      ],
      sessionExpired: true,
    })

    render(<StatsDashboard onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /^log in$/i }))

    expect(screen.getByText('PROFILE')).toBeInTheDocument()
  })

  it('keeps the Sync now CTA for a non-auth pending failure (sessionExpired false)', () => {
    useStatsStore.setState({
      pendingReports: [
        { opponent_type: 'ismcts', player_score: 80, opponent_score: 70, won: true, timestamp: 111 },
      ],
      sessionExpired: false,
    })

    render(<StatsDashboard onClose={() => {}} />)

    expect(screen.getByRole('button', { name: /sync now/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^log in$/i })).not.toBeInTheDocument()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { StatsDashboard } from '../../src/components/StatsDashboard'
import { useStatsStore } from '../../src/store/statsStore'
import type { LeaderboardResponse, MyStyleResponse, RivalryResponse } from '../../src/net/online'
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
// gamesWon/gamesLost mirror games/wins 1:1 in every fixture below EXCEPT
// GAMES_PRIMARY_FIXTURE (see the dedicated "games-primary rendering"
// describe block) — these toggle/family tests are about filter/fetch
// wiring, not the games-vs-matches split, so a games==matches fixture keeps
// them decoupled from that concern.
const UNFILTERED: LeaderboardResponse = {
  overall: [{ accountId: 'acct-1', displayName: 'Alice', games: 5, wins: 4, winRate: 0.8, gamesWon: 4, gamesLost: 1 }],
  verified: [{ accountId: 'acct-1', displayName: 'Alice', games: 3, wins: 2, winRate: 0.667, gamesWon: 2, gamesLost: 1 }],
  availableOpponents: ['online', 'medium', 'hard', 'fair', 'hard2', 'ismcts'],
}

const ONLINE_ONLY: LeaderboardResponse = {
  overall: [{ accountId: 'acct-2', displayName: 'Bob', games: 3, wins: 3, winRate: 1, gamesWon: 3, gamesLost: 0 }],
  verified: [{ accountId: 'acct-2', displayName: 'Bob', games: 3, wins: 3, winRate: 1, gamesWon: 3, gamesLost: 0 }],
}

// Only 'medium' itself has data (hard/fair don't) — used for the flat
// single-data-member-family scenario.
const MEDIUM_ONLY: LeaderboardResponse = {
  overall: [{ accountId: 'acct-3', displayName: 'Carol', games: 4, wins: 1, winRate: 0.25, gamesWon: 1, gamesLost: 3 }],
  verified: [],
}

// The "Medium" family's aggregate — all 3 members (medium, hard, fair).
const MEDIUM_FAMILY_AGGREGATE: LeaderboardResponse = {
  overall: [{ accountId: 'acct-4', displayName: 'Dave', games: 9, wins: 6, winRate: 0.667, gamesWon: 6, gamesLost: 3 }],
  verified: [],
}

// Drilled into just the 'hard' member (label "Hard (Classic)") within the
// Medium family drill-down.
const MEDIUM_CLASSIC_ONLY: LeaderboardResponse = {
  overall: [{ accountId: 'acct-5', displayName: 'Eve', games: 4, wins: 1, winRate: 0.25, gamesWon: 1, gamesLost: 3 }],
  verified: [],
}

// A snapshot where only hard2 (of the Hard family) has data — used for the
// flat single-data-member-family scenario.
const SOLO_HARD2_AVAILABLE: LeaderboardResponse = {
  overall: [{ accountId: 'acct-6', displayName: 'Frank', games: 2, wins: 2, winRate: 1, gamesWon: 2, gamesLost: 0 }],
  verified: [],
  availableOpponents: ['medium', 'hard2'],
}

// The "Hard" family's aggregate — both (now only) members: hard2, ismcts.
const HARD_FAMILY_AGGREGATE: LeaderboardResponse = {
  overall: [{ accountId: 'acct-7', displayName: 'Grace', games: 7, wins: 5, winRate: 0.714, gamesWon: 5, gamesLost: 2 }],
  verified: [],
}

// Drilled into just the 'ismcts' member (label "Hard (ISMCTS)") within the
// Hard family drill-down.
const ISMCTS_ONLY: LeaderboardResponse = {
  overall: [{ accountId: 'acct-8', displayName: 'Heidi', games: 5, wins: 4, winRate: 0.8, gamesWon: 4, gamesLost: 1 }],
  verified: [],
}

// Owner's 2026-07-28 GAMES-first ruling — gamesWon/gamesLost deliberately
// DIFFERENT from games/wins (the compat MATCH totals) so a test can prove
// the table renders the GAMES numbers as primary, not the match totals.
const GAMES_PRIMARY_FIXTURE: LeaderboardResponse = {
  overall: [{ accountId: 'acct-games-primary', displayName: 'Zara', games: 10, wins: 6, winRate: 0.6, gamesWon: 25, gamesLost: 9 }],
  verified: [],
  availableOpponents: ['online'],
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
      overall: [{ accountId: 'acct-9', displayName: 'Ivan', games: 6, wins: 2, winRate: 0.333, gamesWon: 2, gamesLost: 4 }],
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

// Owner's 2026-07-28 GAMES-first ruling — the GLOBAL board's W/L/Win% columns
// are now the per-account GAMES record (worker/src/do/stats.ts's
// gamesWon/gamesLost), with the compat MATCH totals (games/wins) demoted to a
// muted "m W-L" secondary line under the player name.
describe('StatsDashboard GLOBAL leaderboard — games-primary + matches-secondary rendering', () => {
  it('renders gamesWon/gamesLost as the primary W/L/Win% columns, with a muted "m W-L" matches line under the name', async () => {
    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue(GAMES_PRIMARY_FIXTURE)
    await openGlobal()
    await waitFor(() => expect(screen.getByText('Zara')).toBeInTheDocument())

    const row = screen.getByText('Zara').closest('tr')!
    // Primary: the GAMES record (25 won / 9 lost) — NOT the fixture's
    // matches totals (games:10, wins:6), which never appear as bare cells.
    expect(within(row).getByText('25')).toBeInTheDocument()
    expect(within(row).getByText('9')).toBeInTheDocument()
    expect(within(row).getByText('74%')).toBeInTheDocument() // 25/34 games, rounded
    expect(within(row).queryByText('10')).not.toBeInTheDocument()
    expect(within(row).queryByText('60%')).not.toBeInTheDocument() // the OLD matches-based win rate
    // Secondary: matches, muted, under the name — "m 6-4" (wins=6, matches-wins=10-6=4).
    expect(within(row).getByText('m 6-4')).toBeInTheDocument()
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

// Owner's 2026-07-28 GAMES-first ruling — the "VS ARTIFICIAL INTELLIGENCE"
// table's W/L/Win%/Avg Δ are computed on GAMES (statsStore.ts's
// resolveMatchGames), not matches: exact when a local record carries its own
// games_won/games_lost split, approximated "1 game by won" for a legacy
// record with no split at all.
describe('StatsDashboard MY RECORDS — GAMES-first vs-AI table', () => {
  it('renders game-based W/L/Win%/Avg Δ from a mix of an explicit split and a legacy no-split record', () => {
    useStatsStore.setState({
      matches: [
        // Explicit split (e.g. a matchLength-5 win, 3 games to 1) — the
        // exact per-game record this MatchRecord carries.
        { opponent_type: 'medium', player_score: 210, opponent_score: 140, won: true, timestamp: 1, games_won: 3, games_lost: 1 },
        // LEGACY record — no split at all (predates migration 0004) — falls
        // back to "1 game by won" (a loss here -> 0 won, 1 lost).
        { opponent_type: 'medium', player_score: 20, opponent_score: 45, won: false, timestamp: 2 },
      ],
    })

    render(<StatsDashboard onClose={() => {}} />)

    // A match-count-based table would have shown 1W-1L (50%) for these same
    // 2 records; the GAMES-based table sums 3+0 won / 1+1 lost = 3W-2L (60%).
    const row = screen.getByText('Medium').closest('tr')!
    expect(within(row).getByText('3')).toBeInTheDocument()
    expect(within(row).getByText('2')).toBeInTheDocument()
    expect(within(row).getByText('60%')).toBeInTheDocument()
    // Avg Δ: (70 + -25) / 5 games = +9.0 (divided by GAMES, not the 2 matches).
    expect(within(row).getByText('+9.0')).toBeInTheDocument()
  })
})

// BUG 3 fix (2026-07-27): "Online Rivals" was showing the rival's raw
// account UUID because MatchRecord never carried a resolved name — the
// worker's getHistory now LEFT JOINs `players` for it (opponent_name),
// threaded through statsStore's pullVGamesHistory onto MatchRecord.
describe('StatsDashboard MY RECORDS — ONLINE RIVALS shows a resolved name, not the raw UUID', () => {
  it('renders the rival\'s display name instead of their account_id', () => {
    useStatsStore.setState({
      matches: [
        { opponent_type: 'online', opponent_id: 'acct-rival-uuid-1234', opponent_name: 'Sureka', player_score: 40, opponent_score: 30, won: true, timestamp: 1 },
        { opponent_type: 'online', opponent_id: 'acct-rival-uuid-1234', opponent_name: 'Sureka', player_score: 20, opponent_score: 35, won: false, timestamp: 2 },
      ],
    })

    render(<StatsDashboard onClose={() => {}} />)

    expect(screen.getByText('Sureka')).toBeInTheDocument()
    expect(screen.queryByText('acct-rival-uuid-1234')).not.toBeInTheDocument()
  })

  it('falls back to a truncated id label when no name has ever resolved for that rival', () => {
    useStatsStore.setState({
      matches: [
        { opponent_type: 'online', opponent_id: 'acct-rival-uuid-5678', opponent_name: null, player_score: 10, opponent_score: 5, won: true, timestamp: 1 },
      ],
    })

    render(<StatsDashboard onClose={() => {}} />)

    expect(screen.getByText('Player acct-riv')).toBeInTheDocument()
    expect(screen.queryByText('acct-rival-uuid-5678')).not.toBeInTheDocument()
  })

  it('uses the FIRST non-null name seen for a rival even if an earlier-recorded local match predates the name field', () => {
    useStatsStore.setState({
      matches: [
        // Newest first (as pullVGamesHistory/local addMatch both prepend) —
        // an older match recorded before this field existed (undefined) must
        // not blank out a name a later-scanned match DOES carry.
        { opponent_type: 'online', opponent_id: 'acct-rival-uuid-9', opponent_name: undefined, player_score: 1, opponent_score: 2, won: false, timestamp: 2 },
        { opponent_type: 'online', opponent_id: 'acct-rival-uuid-9', opponent_name: 'Bob', player_score: 5, opponent_score: 1, won: true, timestamp: 1 },
      ],
    })

    render(<StatsDashboard onClose={() => {}} />)

    expect(screen.getByText('Bob')).toBeInTheDocument()
  })
})

// Owner's 2026-07-28 GAMES-first ruling — ONLINE RIVALS' W/L/Win%/Avg Δ are
// GAMES (resolveMatchGames, exact when a synced MatchRecord carries a
// split), with the MATCH totals demoted to a muted "m W-L" secondary line —
// same idiom as the GLOBAL board, and consistent with the shipped RivalryModal.
describe('StatsDashboard MY RECORDS — ONLINE RIVALS games-primary + matches-secondary', () => {
  it('sums per-match splits into a games-primary W/L, with matches shown as a muted secondary line', () => {
    useStatsStore.setState({
      matches: [
        // A synced 3-game match win, 2 games to 1.
        { opponent_type: 'online', opponent_id: 'acct-rival-games', opponent_name: 'Reks', player_score: 150, opponent_score: 110, won: true, timestamp: 1, games_won: 2, games_lost: 1 },
        // A second synced match, also won, 2-0.
        { opponent_type: 'online', opponent_id: 'acct-rival-games', opponent_name: 'Reks', player_score: 90, opponent_score: 40, won: true, timestamp: 2, games_won: 2, games_lost: 0 },
      ],
    })

    render(<StatsDashboard onClose={() => {}} />)

    const row = screen.getByText('Reks').closest('tr')!
    // Primary: GAMES — 2+2=4 won, 1+0=1 lost.
    expect(within(row).getByText('4')).toBeInTheDocument()
    expect(within(row).getByText('1')).toBeInTheDocument()
    expect(within(row).getByText('80%')).toBeInTheDocument() // 4/5
    // Secondary: MATCHES — both won, "m 2-0".
    expect(within(row).getByText('m 2-0')).toBeInTheDocument()
  })
})

// =============================================================================
// MY STYLE (You vs the Bot) — lazy fetch, <5-games gate, tug-of-war rendering.
// Server-side lazy + incrementally cached (worker/src/do/style.ts); this tab
// must never call myStyle() before it's opened, and must only ever call it
// once per tier per session.
// =============================================================================

// games=22 (>=15, so the hero win% shows), wins=10/losses=12 (both >=10, so
// the trajectory section shows). One row (bonus3Rate) is deliberately
// ineligible to exercise the dimmed-row rendering; one gap ('gap') tag per
// side (camelMajority ai-favored, tokensPerCard human-favored).
const STYLE_RESPONSE_FULL: MyStyleResponse = {
  tier: 'ismcts',
  games: 22,
  availableTiers: [{ tier: 'ismcts', games: 22 }],
  style: {
    games: 22,
    wins: 10,
    losses: 12,
    winPct: 45.45,
    rows: [
      {
        id: 'tokensPerCard',
        label: 'Tokens per card sold',
        sublabel: 'how much each card you sell is worth',
        human: 3.79,
        ai: 3.44,
        format: 'decimal',
        gapKind: 'relative',
        gapPct: 10.2,
        side: 'human',
        dead: false,
        tag: 'gap',
        eligible: true,
        sampleNote: '',
        pointImpact: 0.5,
      },
      {
        id: 'camelMajority',
        label: 'Camel majority at round end',
        human: 40,
        ai: 60,
        format: 'percent',
        gapKind: 'points',
        gapPct: 20,
        side: 'ai',
        dead: false,
        tag: 'gap',
        eligible: true,
        sampleNote: '',
        subCaption: '8 of 20 analyzed rounds · bot 12 · you take camels on 17% of your moves vs bot 21% (style, not verdict)',
        pointImpact: 0.6,
      },
      {
        id: 'bonus4Rate',
        label: '4-card bonus rate',
        human: 38,
        ai: 56,
        format: 'percent',
        gapKind: 'points',
        gapPct: 18,
        side: 'ai',
        dead: false,
        tag: null,
        eligible: true,
        sampleNote: '',
        subCaption: '5 of 13 bonus sales · bot 9 of 16',
        pointImpact: 0.3,
      },
      {
        id: 'bonus3Rate',
        label: '3-card bonus rate',
        human: 10,
        ai: 15,
        format: 'percent',
        gapKind: 'points',
        gapPct: 5,
        side: 'ai',
        dead: false,
        tag: null,
        eligible: false,
        sampleNote: 'needs more data (n=4, need 10)',
        pointImpact: 0.05,
      },
    ],
    notes: [],
    signatures: {
      cherryPicker: true,
      cherryPickerPct: 34,
      cherryPickerEligible: true,
      preciousTempo: true,
      preciousTempoHumanPct: 66,
      preciousTempoAiPct: 76,
      preciousTempoEligible: true,
      boomPlayer: true,
      boomPlayerEligible: true,
    },
    trajectoryWins: [
      { mean: -1, count: 5 },
      { mean: 2, count: 5 },
      { mean: 5, count: 5 },
      { mean: 9, count: 5 },
    ],
    trajectoryLosses: [
      { mean: -1, count: 6 },
      { mean: -2, count: 6 },
      { mean: -3, count: 6 },
      { mean: -6, count: 6 },
    ],
    coaching: 'The bot ends rounds holding camel majority more often — test coaching message.',
  },
}

describe('StatsDashboard MY STYLE — lazy fetch', () => {
  beforeEach(() => {
    vi.spyOn(onlineApi, 'myStyle').mockReset()
  })

  it('never calls myStyle() while MY RECORDS or GLOBAL is showing', async () => {
    vi.spyOn(onlineApi, 'myStyle').mockResolvedValue(STYLE_RESPONSE_FULL)
    vi.spyOn(onlineApi, 'leaderboard').mockResolvedValue({ overall: [], verified: [], availableOpponents: [] })
    useStatsStore.setState({
      matches: [{ opponent_type: 'ismcts', player_score: 10, opponent_score: 5, won: true, timestamp: 1 }],
    })
    render(<StatsDashboard onClose={() => {}} />)
    expect(onlineApi.myStyle).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'GLOBAL' }))
    await waitFor(() => expect(onlineApi.leaderboard).toHaveBeenCalled())
    expect(onlineApi.myStyle).not.toHaveBeenCalled()
  })

  it('fetches once MY STYLE is opened, defaulting to the most-played local vs-AI tier', async () => {
    vi.spyOn(onlineApi, 'myStyle').mockResolvedValue(STYLE_RESPONSE_FULL)
    useStatsStore.setState({
      matches: [
        { opponent_type: 'ismcts', player_score: 10, opponent_score: 5, won: true, timestamp: 1 },
        { opponent_type: 'ismcts', player_score: 10, opponent_score: 5, won: true, timestamp: 2 },
        { opponent_type: 'easy', player_score: 10, opponent_score: 5, won: true, timestamp: 3 },
        // 'online' matches must never be treated as a vs-AI tier candidate.
        { opponent_type: 'online', opponent_id: 'x', player_score: 10, opponent_score: 5, won: true, timestamp: 4 },
      ],
    })
    render(<StatsDashboard onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'MY STYLE' }))
    await waitFor(() => expect(onlineApi.myStyle).toHaveBeenCalledWith('ismcts'))
    expect(onlineApi.myStyle).toHaveBeenCalledTimes(1)
  })

  it('re-opening the tab (without switching tiers) does not re-fetch — cached for the session', async () => {
    vi.spyOn(onlineApi, 'myStyle').mockResolvedValue(STYLE_RESPONSE_FULL)
    useStatsStore.setState({
      matches: [{ opponent_type: 'ismcts', player_score: 10, opponent_score: 5, won: true, timestamp: 1 }],
    })
    render(<StatsDashboard onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'MY STYLE' }))
    await waitFor(() => expect(onlineApi.myStyle).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'MY RECORDS' }))
    fireEvent.click(screen.getByRole('button', { name: 'MY STYLE' }))
    // Give any errant effect a tick to fire before asserting it didn't.
    await new Promise((r) => setTimeout(r, 0))
    expect(onlineApi.myStyle).toHaveBeenCalledTimes(1)
  })

  it('with no local vs-AI matches at all, opening the tab shows an empty state and never calls myStyle', () => {
    vi.spyOn(onlineApi, 'myStyle').mockResolvedValue(STYLE_RESPONSE_FULL)
    useStatsStore.setState({ matches: [] })
    render(<StatsDashboard onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'MY STYLE' }))
    expect(screen.getByText(/unlock your style read/i)).toBeInTheDocument()
    expect(onlineApi.myStyle).not.toHaveBeenCalled()
  })
})

describe('StatsDashboard MY STYLE — <5-games gate', () => {
  it('shows a progress-framed placeholder ("Play N more games vs <tier>"), instead of the panel', async () => {
    vi.spyOn(onlineApi, 'myStyle').mockResolvedValue({
      ...STYLE_RESPONSE_FULL,
      games: 2,
      style: { ...STYLE_RESPONSE_FULL.style, games: 2 },
    })
    useStatsStore.setState({
      matches: [{ opponent_type: 'medium', player_score: 1, opponent_score: 0, won: true, timestamp: 1 }],
    })
    render(<StatsDashboard onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'MY STYLE' }))
    await waitFor(() => expect(screen.getByText(/Play 3 more games vs Medium/i)).toBeInTheDocument())
    expect(screen.queryByText(/YOU vs THE BOT/)).not.toBeInTheDocument()
  })
})

describe('StatsDashboard MY STYLE — full panel rendering', () => {
  it('renders tug-of-war rows (with sublabels/subCaptions), exactly one neutral "BIGGEST GAP" tag per side, dead-even styling, and signatures', async () => {
    vi.spyOn(onlineApi, 'myStyle').mockResolvedValue(STYLE_RESPONSE_FULL)
    useStatsStore.setState({
      matches: [{ opponent_type: 'ismcts', player_score: 1, opponent_score: 0, won: true, timestamp: 1 }],
    })
    render(<StatsDashboard onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'MY STYLE' }))

    await waitFor(() => expect(screen.getByText('Tokens per card sold')).toBeInTheDocument())
    expect(screen.getByText('how much each card you sell is worth')).toBeInTheDocument() // plain-language sublabel
    expect(screen.getByText('Camel majority at round end')).toBeInTheDocument()
    expect(screen.getByText('4-card bonus rate')).toBeInTheDocument()
    expect(screen.getByText('3-card bonus rate')).toBeInTheDocument()

    // Neutral "BIGGEST GAP" tag — exactly one per side (2 total), never the
    // old "THE DECIDER"/"YOUR CRAFT" editorializing.
    expect(screen.getAllByText('BIGGEST GAP')).toHaveLength(2)
    expect(screen.queryByText('THE DECIDER')).not.toBeInTheDocument()
    expect(screen.queryByText('YOUR CRAFT')).not.toBeInTheDocument()

    // subCaption raw-number context renders.
    expect(screen.getByText(/8 of 20 analyzed rounds/)).toBeInTheDocument()
    expect(screen.getByText(/5 of 13 bonus sales/)).toBeInTheDocument()

    // The ineligible row (bonus3Rate) shows its sampleNote.
    expect(screen.getByText('needs more data (n=4, need 10)')).toBeInTheDocument()

    expect(screen.getByText(/Cherry-picker/)).toBeInTheDocument()
    expect(screen.getByText(/Precious tempo/)).toBeInTheDocument()
    expect(screen.getByText(/you 66% \/ bot 76%/)).toBeInTheDocument() // both rates, neutral
    expect(screen.getByText(/losses drift late/)).toBeInTheDocument() // softened wording
    expect(screen.queryByText(/losses bleed slow/)).not.toBeInTheDocument()

    // Coaching text is present (rule-based, not canned per-render).
    expect(screen.getByText(STYLE_RESPONSE_FULL.style.coaching)).toBeInTheDocument()
  })

  it('the coaching card renders ABOVE the tug-of-war rows (design council item 9: moved directly under the hero)', async () => {
    vi.spyOn(onlineApi, 'myStyle').mockResolvedValue(STYLE_RESPONSE_FULL)
    useStatsStore.setState({
      matches: [{ opponent_type: 'ismcts', player_score: 1, opponent_score: 0, won: true, timestamp: 1 }],
    })
    const { container } = render(<StatsDashboard onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'MY STYLE' }))
    await waitFor(() => expect(screen.getByText(STYLE_RESPONSE_FULL.style.coaching)).toBeInTheDocument())

    const text = container.textContent ?? ''
    const coachingIndex = text.indexOf(STYLE_RESPONSE_FULL.style.coaching)
    const receiptsIndex = text.indexOf('Tokens per card sold')
    expect(coachingIndex).toBeGreaterThan(-1)
    expect(receiptsIndex).toBeGreaterThan(-1)
    expect(coachingIndex).toBeLessThan(receiptsIndex)
  })
})

describe('StatsDashboard MY STYLE — dead-even row rendering', () => {
  it('shows "dead even" wording for a row whose gap is under the threshold, and no tag on it', async () => {
    const deadRow = { ...STYLE_RESPONSE_FULL.style.rows[2], id: 'bonus4Rate' as const, dead: true, tag: null, gapPct: 2 }
    vi.spyOn(onlineApi, 'myStyle').mockResolvedValue({
      ...STYLE_RESPONSE_FULL,
      style: { ...STYLE_RESPONSE_FULL.style, rows: [STYLE_RESPONSE_FULL.style.rows[0], deadRow] },
    })
    useStatsStore.setState({
      matches: [{ opponent_type: 'ismcts', player_score: 1, opponent_score: 0, won: true, timestamp: 1 }],
    })
    render(<StatsDashboard onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'MY STYLE' }))

    await waitFor(() => expect(screen.getByText(/dead even/i)).toBeInTheDocument())
  })
})

describe('StatsDashboard MY STYLE — hero win% suppression below 15 games', () => {
  it('shows only the W-L count (no win%) when games < 15', async () => {
    vi.spyOn(onlineApi, 'myStyle').mockResolvedValue({
      ...STYLE_RESPONSE_FULL,
      games: 12,
      style: { ...STYLE_RESPONSE_FULL.style, games: 12, wins: 5, losses: 7, winPct: 41.67 },
    })
    useStatsStore.setState({
      matches: [{ opponent_type: 'ismcts', player_score: 1, opponent_score: 0, won: true, timestamp: 1 }],
    })
    render(<StatsDashboard onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'MY STYLE' }))

    await waitFor(() => expect(screen.getByText('5W – 7L')).toBeInTheDocument())
    expect(screen.queryByText('42%')).not.toBeInTheDocument()
    expect(screen.queryByText('41%')).not.toBeInTheDocument()
  })

  it('shows the bold win% once games >= 15 (STYLE_RESPONSE_FULL has 22)', async () => {
    vi.spyOn(onlineApi, 'myStyle').mockResolvedValue(STYLE_RESPONSE_FULL)
    useStatsStore.setState({
      matches: [{ opponent_type: 'ismcts', player_score: 1, opponent_score: 0, won: true, timestamp: 1 }],
    })
    render(<StatsDashboard onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'MY STYLE' }))

    await waitFor(() => expect(screen.getByText('10W – 12L')).toBeInTheDocument())
    expect(screen.getByText('45%')).toBeInTheDocument()
  })
})

describe('StatsDashboard MY STYLE — trajectory ("game shape") gate and shared sparkline scale', () => {
  it('shows a needs-more-games message instead of sparklines when wins or losses are under 10', async () => {
    vi.spyOn(onlineApi, 'myStyle').mockResolvedValue({
      ...STYLE_RESPONSE_FULL,
      style: { ...STYLE_RESPONSE_FULL.style, wins: 6, losses: 12, games: 18 },
    })
    useStatsStore.setState({
      matches: [{ opponent_type: 'ismcts', player_score: 1, opponent_score: 0, won: true, timestamp: 1 }],
    })
    render(<StatsDashboard onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'MY STYLE' }))

    await waitFor(() => expect(screen.getByText(/Needs at least 10 wins and 10 losses/)).toBeInTheDocument())
    expect(screen.queryByText('IN YOUR WINS')).not.toBeInTheDocument()
    expect(screen.queryByText('IN YOUR LOSSES')).not.toBeInTheDocument()
  })

  it('shows sparklines and an "n=X wins / Y losses" caption once both clear the floor', async () => {
    vi.spyOn(onlineApi, 'myStyle').mockResolvedValue(STYLE_RESPONSE_FULL) // wins=10, losses=12
    useStatsStore.setState({
      matches: [{ opponent_type: 'ismcts', player_score: 1, opponent_score: 0, won: true, timestamp: 1 }],
    })
    render(<StatsDashboard onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'MY STYLE' }))

    await waitFor(() => expect(screen.getByText('IN YOUR WINS')).toBeInTheDocument())
    expect(screen.getByText('IN YOUR LOSSES')).toBeInTheDocument()
    expect(screen.getByText('n=10 wins / 12 losses')).toBeInTheDocument()
  })
})

describe('StatsDashboard MY STYLE — hard-bot reassurance line', () => {
  it('shows the reassurance line for a hard-family tier (ismcts)', async () => {
    vi.spyOn(onlineApi, 'myStyle').mockResolvedValue(STYLE_RESPONSE_FULL)
    useStatsStore.setState({
      matches: [{ opponent_type: 'ismcts', player_score: 1, opponent_score: 0, won: true, timestamp: 1 }],
    })
    render(<StatsDashboard onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'MY STYLE' }))

    await waitFor(() => expect(screen.getByText(/Hard bots are built to beat most players/)).toBeInTheDocument())
  })

  it('omits the reassurance line for a non-hard tier (medium)', async () => {
    vi.spyOn(onlineApi, 'myStyle').mockResolvedValue({ ...STYLE_RESPONSE_FULL, tier: 'medium' })
    useStatsStore.setState({
      matches: [{ opponent_type: 'medium', player_score: 1, opponent_score: 0, won: true, timestamp: 1 }],
    })
    render(<StatsDashboard onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'MY STYLE' }))

    await waitFor(() => expect(screen.getByText('10W – 12L')).toBeInTheDocument())
    expect(screen.queryByText(/Hard bots are built to beat most players/)).not.toBeInTheDocument()
  })
})

// =============================================================================
// RIVALRY modal — click an Online Rival -> head-to-head panel (DELTA A/B,
// owner 2026-07-28: games-primary/matches-secondary record shape + the
// edgeFinder banter line). worker/src/do/rivalry.ts's RivalryResponse is the
// wire contract these fixtures mirror.
// =============================================================================

const RIVAL_MATCHES = [
  { opponent_type: 'online' as const, opponent_id: 'acct-rival-sureka', opponent_name: 'Sureka', player_score: 74, opponent_score: 67, won: true, timestamp: 1 },
]

const RIVALRY_RESPONSE_ELIGIBLE: RivalryResponse = {
  opponentName: 'Sureka',
  record: {
    games: { wins: 3, losses: 1, currentStreak: { who: 'me', n: 2 } },
    matches: { wins: 2, losses: 0 },
  },
  totals: {
    myPoints: 300,
    theirPoints: 250,
    gamesWon: [3, 1],
    camelMajorityGames: [3, 1],
  },
  biggestGame: { myScore: 85, theirScore: 64, matchCode: '6DRHAJ', gameNumber: 3 },
  perGame: [
    { matchCode: '6DRHAJ', gameNumberInMatch: 1, myScore: 70, theirScore: 60, won: true, endedAt: 5000 },
    { matchCode: '6DRHAJ', gameNumberInMatch: 2, myScore: 55, theirScore: 70, won: false, endedAt: 5000 },
    { matchCode: '6DRHAJ', gameNumberInMatch: 3, myScore: 85, theirScore: 64, won: true, endedAt: 5000 },
    { matchCode: 'AAAA11', gameNumberInMatch: 1, myScore: 90, theirScore: 56, won: true, endedAt: 3000 },
  ],
  craft: {
    tokensPerCard: { mine: 3.71, theirs: 3.35, myCards: 40, theirCards: 38, eligible: true },
    bonusSales: { mine3: 5, mine4: 2, mine5: 1, theirs3: 3, theirs4: 6, theirs5: 1, eligible: true },
  },
  edgeFinder: 'Edge finder: Sureka converts more 3+ sales into 4s (6 vs your 2) — hold a beat longer.',
}

const RIVALRY_RESPONSE_INELIGIBLE_CRAFT: RivalryResponse = {
  ...RIVALRY_RESPONSE_ELIGIBLE,
  craft: {
    tokensPerCard: { mine: 0, theirs: 0, myCards: 4, theirCards: 3, eligible: false },
    bonusSales: { mine3: 0, mine4: 0, mine5: 0, theirs3: 1, theirs4: 0, theirs5: 0, eligible: false },
  },
  edgeFinder: 'Edge finder: play a few more games to unlock.',
}

async function openRivalsTab() {
  useStatsStore.setState({ matches: RIVAL_MATCHES })
  render(<StatsDashboard onClose={() => {}} />)
  expect(screen.getByText('Sureka')).toBeInTheDocument()
}

describe('StatsDashboard RIVALRY modal — lazy fetch + session cache', () => {
  beforeEach(() => {
    vi.spyOn(onlineApi, 'rivalry').mockReset()
  })

  it('never calls rivalry() before a rival row is clicked', async () => {
    vi.spyOn(onlineApi, 'rivalry').mockResolvedValue(RIVALRY_RESPONSE_ELIGIBLE)
    await openRivalsTab()
    expect(onlineApi.rivalry).not.toHaveBeenCalled()
  })

  it('clicking a rival row fetches once, keyed by that opponent id', async () => {
    vi.spyOn(onlineApi, 'rivalry').mockResolvedValue(RIVALRY_RESPONSE_ELIGIBLE)
    await openRivalsTab()

    fireEvent.click(screen.getByText('Sureka'))
    await waitFor(() => expect(onlineApi.rivalry).toHaveBeenCalledWith('acct-rival-sureka'))
    expect(onlineApi.rivalry).toHaveBeenCalledTimes(1)
  })

  it('re-opening the same rival (close then click again) does not re-fetch — session-cached', async () => {
    vi.spyOn(onlineApi, 'rivalry').mockResolvedValue(RIVALRY_RESPONSE_ELIGIBLE)
    await openRivalsTab()

    fireEvent.click(screen.getByText('Sureka'))
    await waitFor(() => expect(onlineApi.rivalry).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByText('Sureka'))
    // Give any errant effect a tick to fire before asserting it didn't re-fetch.
    await new Promise((r) => setTimeout(r, 0))
    expect(onlineApi.rivalry).toHaveBeenCalledTimes(1)
  })
})

describe('StatsDashboard RIVALRY modal — rendering', () => {
  beforeEach(() => {
    vi.spyOn(onlineApi, 'rivalry').mockReset()
  })

  it('renders the games-primary record, streak, matches-secondary line, totals, and biggest-game callout', async () => {
    vi.spyOn(onlineApi, 'rivalry').mockResolvedValue(RIVALRY_RESPONSE_ELIGIBLE)
    await openRivalsTab()
    fireEvent.click(screen.getByText('Sureka'))

    await waitFor(() => expect(screen.getByText('YOU vs SUREKA')).toBeInTheDocument())
    // Games record is the hero (DELTA A: games primary, matches secondary).
    expect(screen.getByText(/3–1/)).toBeInTheDocument()
    expect(screen.getByText('in games')).toBeInTheDocument()
    expect(screen.getByText('won the last 2 games')).toBeInTheDocument()
    expect(screen.getByText(/across 2 matches \(2–0\)/)).toBeInTheDocument()

    // Biggest game — renamed from biggestRound, signed (not absolute-valued).
    expect(screen.getByText('Your 85–64 — game 3 of 6DRHAJ')).toBeInTheDocument()

    // The edgeFinder line (DELTA B) renders verbatim from the payload.
    expect(screen.getByText(RIVALRY_RESPONSE_ELIGIBLE.edgeFinder)).toBeInTheDocument()
  })

  it('renders eligible craft rows (tokens per card, bonus sales) as tug-of-war rows with real numbers', async () => {
    vi.spyOn(onlineApi, 'rivalry').mockResolvedValue(RIVALRY_RESPONSE_ELIGIBLE)
    await openRivalsTab()
    fireEvent.click(screen.getByText('Sureka'))

    await waitFor(() => expect(screen.getByText('Tokens per card')).toBeInTheDocument())
    expect(screen.getByText('3-card bonus sales')).toBeInTheDocument()
    expect(screen.getByText('4-card bonus sales')).toBeInTheDocument()
    expect(screen.getByText('5-card bonus sales')).toBeInTheDocument()
    expect(screen.queryByText('not enough sells yet to compare craft')).not.toBeInTheDocument()
  })

  it('shows the "not enough sells yet" fallback line for ineligible craft rows instead of a tug-of-war row', async () => {
    vi.spyOn(onlineApi, 'rivalry').mockResolvedValue(RIVALRY_RESPONSE_INELIGIBLE_CRAFT)
    await openRivalsTab()
    fireEvent.click(screen.getByText('Sureka'))

    await waitFor(() => expect(screen.getAllByText('not enough sells yet to compare craft')).toHaveLength(2))
    expect(screen.queryByText('Tokens per card')).not.toBeInTheDocument()
  })

  it('renders the per-game list grouped by match, newest match first, games ascending within a match', async () => {
    vi.spyOn(onlineApi, 'rivalry').mockResolvedValue(RIVALRY_RESPONSE_ELIGIBLE)
    useStatsStore.setState({ matches: RIVAL_MATCHES })
    const { container } = render(<StatsDashboard onClose={() => {}} />)
    fireEvent.click(screen.getByText('Sureka'))

    await waitFor(() => expect(screen.getByText(/MATCH 6DRHAJ/)).toBeInTheDocument())
    expect(screen.getByText(/MATCH AAAA11/)).toBeInTheDocument()
    // "Game 1" appears once per match group (6DRHAJ's game 1, AAAA11's game
    // 1) — only games 2/3 are unique to the 6DRHAJ group.
    expect(screen.getAllByText('Game 1')).toHaveLength(2)
    expect(screen.getByText('Game 2')).toBeInTheDocument()
    expect(screen.getByText('Game 3')).toBeInTheDocument()

    // Newest match (6DRHAJ, endedAt=5000) appears before the older one
    // (AAAA11, endedAt=3000) — same ordering convention as the coaching-
    // card-order test above (container.textContent index comparison).
    const text = container.textContent ?? ''
    expect(text.indexOf('6DRHAJ')).toBeLessThan(text.indexOf('AAAA11'))
  })

  it('shows a loading state while the fetch is in flight', async () => {
    let resolveFetch: (v: RivalryResponse) => void = () => {}
    vi.spyOn(onlineApi, 'rivalry').mockReturnValue(new Promise((resolve) => { resolveFetch = resolve }))
    await openRivalsTab()
    fireEvent.click(screen.getByText('Sureka'))

    expect(await screen.findByText(/Loading head-to-head/i)).toBeInTheDocument()
    resolveFetch(RIVALRY_RESPONSE_ELIGIBLE)
    await waitFor(() => expect(screen.getByText('YOU vs SUREKA')).toBeInTheDocument())
  })

  it('shows a friendly error state on fetch failure', async () => {
    vi.spyOn(onlineApi, 'rivalry').mockRejectedValue(new Error('http_404'))
    await openRivalsTab()
    fireEvent.click(screen.getByText('Sureka'))

    await waitFor(() => expect(screen.getByText(/Could not load head-to-head/i)).toBeInTheDocument())
  })
})

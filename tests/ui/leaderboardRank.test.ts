import { describe, it, expect } from 'vitest'
import { MIN_GAMES_FOR_RANK, rankBySkill, type RankableRow } from '../../src/components/leaderboardRank'

const row = (games: number, wins: number, avg_delta = 0): RankableRow => ({ games, wins, avg_delta })

describe('leaderboardRank', () => {
  it('uses a 3-game qualification floor', () => {
    expect(MIN_GAMES_FOR_RANK).toBe(3)
  })

  it('ranks a low-volume high-win% player above a high-volume low-win% player (both qualified)', () => {
    const lowVolHighPct = row(3, 3) // 100% over 3 games (just qualifies)
    const highVolLowPct = row(100, 40) // 40% over 100 games
    const sorted = [highVolLowPct, lowVolHighPct].sort(rankBySkill)
    expect(sorted[0]).toBe(lowVolHighPct)
  })

  it('sinks sub-floor players below qualified players but keeps them visible and ordered by win% among themselves', () => {
    const qualifiedMediocre = row(5, 1) // 20% but qualified
    const subFloorPerfect = row(2, 2) // 100% but only 2 games
    const subFloorZero = row(1, 0) // 0% and 1 game
    const sorted = [subFloorPerfect, qualifiedMediocre, subFloorZero].sort(rankBySkill)

    // Qualified always outranks any sub-floor player, even a perfect one...
    expect(sorted[0]).toBe(qualifiedMediocre)
    // ...and the sub-floor players stay visible, ordered by win% among themselves.
    expect(sorted[1]).toBe(subFloorPerfect)
    expect(sorted[2]).toBe(subFloorZero)
    expect(sorted).toHaveLength(3)
  })

  it('breaks a win-rate tie by wins, then by avg_delta', () => {
    const fewerWins = row(4, 2, 5) // 50%, 2 wins, +5 delta
    const moreWins = row(8, 4, 1) // 50%, 4 wins, +1 delta
    expect([fewerWins, moreWins].sort(rankBySkill)[0]).toBe(moreWins)

    const smallDelta = row(4, 2, 1)
    const bigDelta = row(4, 2, 9) // same games+wins, higher delta wins
    expect([smallDelta, bigDelta].sort(rankBySkill)[0]).toBe(bigDelta)
  })

  it('handles the 0-games edge case without dividing by zero (returns a finite comparison)', () => {
    const empty = row(0, 0)
    const other = row(3, 2)
    expect(Number.isNaN(rankBySkill(empty, other))).toBe(false)
    expect(Number.isNaN(rankBySkill(empty, row(0, 0)))).toBe(false)
    // A 0-games player is unqualified, so it sinks below a qualified one.
    expect([empty, other].sort(rankBySkill)[0]).toBe(other)
  })
})

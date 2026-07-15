// Skill-based leaderboard ordering. The global leaderboard previously sorted by
// games played, so grinding out matches beat winning them. Instead: qualified
// players (enough games to be meaningful) rank above unqualified ones, and
// within each bucket we rank by win rate, then wins, then average score delta.
//
// Unqualified players are never hidden — they simply sink below the qualified
// group while staying ordered among themselves.

// A small friend-pool floor: three games is enough to not be pure noise.
export const MIN_GAMES_FOR_RANK = 3

export interface RankableRow {
  games: number
  wins: number
  avg_delta: number
}

function winRate(row: RankableRow): number {
  // Guard the 0-games edge case so it never divides by zero (NaN would poison
  // Array.prototype.sort's ordering).
  return row.games > 0 ? row.wins / row.games : 0
}

/**
 * Array.prototype.sort comparator. Negative => a ranks before b.
 * Order: qualified-before-unqualified, then win rate desc, wins desc, avg_delta desc.
 */
export function rankBySkill(a: RankableRow, b: RankableRow): number {
  const aQualified = a.games >= MIN_GAMES_FOR_RANK
  const bQualified = b.games >= MIN_GAMES_FOR_RANK
  if (aQualified !== bQualified) return aQualified ? -1 : 1

  const rateDiff = winRate(b) - winRate(a)
  if (rateDiff !== 0) return rateDiff

  if (b.wins !== a.wins) return b.wins - a.wins

  return b.avg_delta - a.avg_delta
}

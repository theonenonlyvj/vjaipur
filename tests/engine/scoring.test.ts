import { describe, it, expect } from 'vitest'
import { scoreRound } from '../../src/engine/scoring'
import { setupRound } from '../../src/engine/setup'
import type { GameState } from '../../src/engine/types'

function makeRoundEnd(
  p0GoodsValues: number[],
  p1GoodsValues: number[],
  p0Herd: number,
  p1Herd: number,
  p0BonusValues: number[] = [],
  p1BonusValues: number[] = [],
): GameState {
  const base = setupRound([0, 0], undefined, () => 0)
  return {
    ...base,
    phase: 'round-end',
    players: [
      {
        ...base.players[0],
        herd: p0Herd,
        tokens: p0GoodsValues.map(value => ({ good: 'cloth' as const, value })),
        bonusTokens: p0BonusValues.map(value => ({ tier: 3 as const, value })),
      },
      {
        ...base.players[1],
        herd: p1Herd,
        tokens: p1GoodsValues.map(value => ({ good: 'cloth' as const, value })),
        bonusTokens: p1BonusValues.map(value => ({ tier: 3 as const, value })),
      },
    ],
  }
}

describe('scoreRound', () => {
  it('awards camel token to player with more camels', () => {
    const result = scoreRound(makeRoundEnd([10], [5], 5, 2))
    expect(result.camelWinner).toBe(0)
  })

  it('awards camel token to player 1 when they have more', () => {
    const result = scoreRound(makeRoundEnd([10], [5], 1, 4))
    expect(result.camelWinner).toBe(1)
  })

  it('camel token goes to nobody on camel tie', () => {
    const result = scoreRound(makeRoundEnd([10], [5], 3, 3))
    expect(result.camelWinner).toBeNull()
  })

  it('adds 5 pts to camel winner score', () => {
    const result = scoreRound(makeRoundEnd([10], [5], 5, 0))
    expect(result.scores[0]).toBe(15) // 10 goods + 5 camel
    expect(result.scores[1]).toBe(5)
  })

  it('seal goes to player with higher score', () => {
    const result = scoreRound(makeRoundEnd([10], [5], 5, 0))
    expect(result.sealAwardedTo).toBe(0)
  })

  it('seal uses bonus token count as tiebreaker on equal scores', () => {
    // Both score 10, but p0 has 3 bonus tokens and p1 has 1
    const result = scoreRound(makeRoundEnd([10], [10], 0, 0, [2, 2, 2], [2]))
    expect(result.sealAwardedTo).toBe(0)
  })

  it('seal is null on complete tie (same score and same bonus token count)', () => {
    const result = scoreRound(makeRoundEnd([10], [10], 0, 0, [2, 2], [2, 2]))
    expect(result.sealAwardedTo).toBeNull()
  })

  it('includes bonus token values in score totals', () => {
    const result = scoreRound(makeRoundEnd([10], [5], 0, 0, [3, 2], []))
    expect(result.scores[0]).toBe(15) // 10 goods + 3 + 2 bonus
    expect(result.scores[1]).toBe(5)
  })

  it('reports correct bonus token counts', () => {
    const result = scoreRound(makeRoundEnd([10], [10], 0, 0, [3, 3, 3], [2]))
    expect(result.bonusTokenCounts).toEqual([3, 1])
  })

  it('seal uses goods token count as third tiebreaker when score and bonus count both tie', () => {
    // Both score 5 (p0: 3+2, p1: 5), no bonus tokens for either (count 0-0 tie),
    // but p0 holds 2 goods tokens vs p1's 1 — rulebook's 3rd tiebreaker.
    const result = scoreRound(makeRoundEnd([3, 2], [5], 0, 0))
    expect(result.sealAwardedTo).toBe(0)
  })

  it('seal uses goods token count as third tiebreaker, reversed', () => {
    const result = scoreRound(makeRoundEnd([5], [3, 2], 0, 0))
    expect(result.sealAwardedTo).toBe(1)
  })

  it('seal stays null on a true tie across score, bonus count, and goods token count', () => {
    const result = scoreRound(makeRoundEnd([5], [5], 0, 0))
    expect(result.sealAwardedTo).toBeNull()
  })
})

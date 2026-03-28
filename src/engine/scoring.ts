import type { GameState, RoundResult } from './types'

const CAMEL_TOKEN_VALUE = 5

export function scoreRound(state: GameState): RoundResult {
  const [p0, p1] = state.players

  let camelWinner: 0 | 1 | null = null
  if (p0.herd > p1.herd) camelWinner = 0
  else if (p1.herd > p0.herd) camelWinner = 1

  const playerTotal = (player: typeof p0, camelBonus: number) =>
    player.tokens.reduce((s, t) => s + t.value, 0) +
    player.bonusTokens.reduce((s, t) => s + t.value, 0) +
    camelBonus

  const scores: [number, number] = [
    playerTotal(p0, camelWinner === 0 ? CAMEL_TOKEN_VALUE : 0),
    playerTotal(p1, camelWinner === 1 ? CAMEL_TOKEN_VALUE : 0),
  ]

  const bonusTokenCounts: [number, number] = [p0.bonusTokens.length, p1.bonusTokens.length]

  let sealAwardedTo: 0 | 1 | null = null
  if (scores[0] > scores[1]) sealAwardedTo = 0
  else if (scores[1] > scores[0]) sealAwardedTo = 1
  else if (bonusTokenCounts[0] > bonusTokenCounts[1]) sealAwardedTo = 0
  else if (bonusTokenCounts[1] > bonusTokenCounts[0]) sealAwardedTo = 1
  // Complete tie: sealAwardedTo stays null

  return { camelWinner, scores, bonusTokenCounts, sealAwardedTo }
}

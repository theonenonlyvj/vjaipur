import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { RoundEndScreen } from '../../src/screens/RoundEndScreen'
import { useGameStore } from '../../src/store/gameStore'
import { setupRound } from '../../src/engine'

function makeRoundEndState() {
  return { ...setupRound([0, 0], undefined, () => 0.5), phase: 'round-end' as const }
}

beforeEach(() => {
  useGameStore.setState({ state: makeRoundEndState(), mode: 'local', error: null, onlineStatus: 'idle' })
})

describe('RoundEndScreen', () => {
  it('shows Player 1 and Player 2 labels', () => {
    render(<MemoryRouter><RoundEndScreen /></MemoryRouter>)
    expect(screen.getByText(/Guest|You/i)).toBeInTheDocument()
    expect(screen.getByText(/Opponent/i)).toBeInTheDocument()
  })

  it('shows a Continue button', () => {
    render(<MemoryRouter><RoundEndScreen /></MemoryRouter>)
    expect(screen.getByText(/continue/i)).toBeInTheDocument()
  })

  it('renders nothing (navigates away) when state is null', () => {
    useGameStore.setState({ state: null })
    const { container } = render(<MemoryRouter><RoundEndScreen /></MemoryRouter>)
    expect(container.textContent).toBe('')
  })
})

// FORFEIT is gone online — see GameScreen.test.tsx's equivalent note. Match
// end now routes through the normal navigation guard above.
describe('online scoring uses the server view, not a local scoreRound() replay', () => {
  it('uses onlineView.lastRoundResult for the score total instead of recomputing from placeholder opponent tokens', () => {
    // viewToRenderState's opponent tokens are zero-value placeholders — a
    // LOCAL scoreRound(state) would (wrongly) credit the opponent 0 points.
    const onlineView = {
      mySeat: 0, phase: 'round_end', round: 1, seals: [0, 0], matchLength: 3, winnerSeat: null,
      lastRoundResult: { camelWinner: 0 as const, scores: [12, 47], bonusTokenCounts: [1, 2], sealAwardedTo: 1 as const },
      players: [
        { seat: 0, displayName: 'You', ownerType: 'human' as const, controlledByAi: false },
        { seat: 1, displayName: 'Rival', ownerType: 'human' as const, controlledByAi: false },
      ],
      game: {
        market: [], myHand: [], oppHandCount: 3, herds: [1, 1] as [number, number],
        tokens: { diamond: [], gold: [], silver: [], cloth: [], spice: [], leather: [] },
        bonusTokenCounts: { three: 0, four: 0, five: 0 },
        myGoodsTokens: [], oppGoodsTokenCount: 2, myBonusTokens: [], oppBonusTokens: [],
        deckCount: 10, myScore: 12, activePlayer: 0 as const,
      },
    }
    useGameStore.setState({
      state: { ...setupRound([0, 0], undefined, () => 0.5), phase: 'round-end' as const, seals: [0, 0] },
      mode: 'online', onlineView: onlineView as any, error: null, matchLength: 3,
    })

    render(<MemoryRouter><RoundEndScreen /></MemoryRouter>)

    // The opponent's real round score (47), not 0 (what a placeholder-token
    // replay would produce).
    expect(screen.getByText('47')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
  })

  it('does not double-count the seal star online (MatchState.seals is already post-award at round_end)', () => {
    const onlineView = {
      mySeat: 0, phase: 'round_end', round: 1, seals: [0, 1], matchLength: 3, winnerSeat: null,
      // seals[1] already reflects THIS round's award — sealAwardedTo:1 must
      // NOT add another +1 on top for seat 1's star count.
      lastRoundResult: { camelWinner: null, scores: [10, 20], bonusTokenCounts: [0, 0], sealAwardedTo: 1 as const },
      players: [
        { seat: 0, displayName: 'You', ownerType: 'human' as const, controlledByAi: false },
        { seat: 1, displayName: 'Rival', ownerType: 'human' as const, controlledByAi: false },
      ],
      game: {
        market: [], myHand: [], oppHandCount: 3, herds: [1, 1] as [number, number],
        tokens: { diamond: [], gold: [], silver: [], cloth: [], spice: [], leather: [] },
        bonusTokenCounts: { three: 0, four: 0, five: 0 },
        myGoodsTokens: [], oppGoodsTokenCount: 2, myBonusTokens: [], oppBonusTokens: [],
        deckCount: 10, myScore: 10, activePlayer: 0 as const,
      },
    }
    useGameStore.setState({
      state: { ...setupRound([0, 0], undefined, () => 0.5), phase: 'round-end' as const, seals: [0, 1] },
      mode: 'online', onlineView: onlineView as any, error: null, matchLength: 3,
    })

    render(<MemoryRouter><RoundEndScreen /></MemoryRouter>)

    // totalSeals for matchLength 3 is 2 (floor(3/2)+1) — seat 1 should show
    // exactly ★☆ (1 filled of 2), not ★★ (which double-counting would give).
    const stars = screen.getAllByText('★☆')
    expect(stars.length).toBeGreaterThan(0)
    expect(screen.queryByText('★★')).not.toBeInTheDocument()
  })
})

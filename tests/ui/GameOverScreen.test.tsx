import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { GameOverScreen } from '../../src/screens/GameOverScreen'
import { useGameStore } from '../../src/store/gameStore'
import { setupRound } from '../../src/engine'

function makeGameOverState() {
  return { ...setupRound([1, 0], undefined, () => 0.5), phase: 'game-over' as const }
}

beforeEach(() => {
  useGameStore.setState({
    state: makeGameOverState(),
    mode: 'online',
    onlinePlayerIndex: 0,
    matchScores: [30, 20],
    error: null,
  })
})

describe('GameOverScreen', () => {
  it('renders nothing (navigates away) when state is null', () => {
    useGameStore.setState({ state: null })
    const { container } = render(<MemoryRouter><GameOverScreen /></MemoryRouter>)
    expect(container.textContent).toBe('')
  })

  it('shows the Game Over heading and a Back to Menu button', () => {
    render(<MemoryRouter><GameOverScreen /></MemoryRouter>)
    expect(screen.getByText(/game over/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /back to menu/i })).toBeInTheDocument()
  })

  it('Back to Menu calls leaveOnline', () => {
    const leaveOnlineMock = vi.fn()
    const original = (useGameStore.getState() as any).leaveOnline
    useGameStore.setState({ leaveOnline: leaveOnlineMock } as any)

    render(<MemoryRouter><GameOverScreen /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /back to menu/i }))
    expect(leaveOnlineMock).toHaveBeenCalledTimes(1)

    // Restore so this mock doesn't leak into other tests in this file
    useGameStore.setState({ leaveOnline: original } as any)
  })
})

// ADDENDUM C: winnerSeat is ALWAYS seals[seat] >= sealsNeeded ? seat : other —
// a resign sets winnerSeat WITHOUT touching seals at all, so a seals-only
// formula gets a resign wrong. Online mode must trust the server's own
// onlineView.winnerSeat instead of re-deriving from state.seals.
describe('online winner uses onlineView.winnerSeat (handles resign correctly)', () => {
  it('a resign at seals [0,0] still shows the correct winner from winnerSeat', () => {
    useGameStore.setState({
      state: { ...makeGameOverState(), seals: [0, 0] },
      mode: 'online', onlinePlayerIndex: 0, matchLength: 3, matchScores: [10, 5],
      onlineView: {
        mySeat: 0, phase: 'match_over', round: 2, seals: [0, 0], matchLength: 3, winnerSeat: 1,
        lastRoundResult: null,
        players: [
          { seat: 0, displayName: 'You', ownerType: 'human', controlledByAi: false },
          { seat: 1, displayName: 'Rival', ownerType: 'human', controlledByAi: false },
        ],
        game: {} as any,
      } as any,
      error: null,
    })

    render(<MemoryRouter><GameOverScreen /></MemoryRouter>)

    // Seat 1 (the opponent, from my seat-0 perspective) won via resign —
    // I lost, even though seals are tied at [0,0].
    expect(screen.getByText(/defeat/i)).toBeInTheDocument()
  })
})

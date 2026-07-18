import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DisconnectBanner } from '../../src/components/DisconnectBanner'
import { useGameStore } from '../../src/store/gameStore'

// DisconnectBanner is now the "opponent away" banner (there is no more
// AI-cover/reclaim — owner's 2026-07-18 no-AI-takeover ruling replaced it
// with a pause + present-player-resolves model). It reads
// opponentPresent/claimWinAvailable directly off the store, no countdown
// timer, and its "Leave & resume later" button navigates home — it needs a
// Router.
function renderBanner() {
  return render(<MemoryRouter><DisconnectBanner /></MemoryRouter>)
}

beforeEach(() => {
  useGameStore.setState({
    onlineView: null, opponentName: null, opponentPresent: true, claimWinAvailable: false,
  })
})

describe('DisconnectBanner', () => {
  it('renders nothing when the opponent is present', () => {
    const { container } = renderBanner()
    expect(container.textContent).toBe('')
  })

  it('renders nothing once the match is over, even if opponentPresent is stale-false', () => {
    useGameStore.setState({ opponentPresent: false, onlineView: { phase: 'match_over' } as never })
    const { container } = renderBanner()
    expect(container.textContent).toBe('')
  })

  it('shows a waiting message (named) when the opponent is away but not yet claimable', () => {
    useGameStore.setState({ opponentPresent: false, opponentName: 'Rival', claimWinAvailable: false })
    renderBanner()
    expect(screen.getByText(/waiting for rival to return/i)).toBeInTheDocument()
  })

  it('falls back to a generic label when opponentName is unset', () => {
    useGameStore.setState({ opponentPresent: false, opponentName: null })
    renderBanner()
    expect(screen.getByText(/waiting for your opponent to return/i)).toBeInTheDocument()
  })

  it('always offers "Leave & resume later" once the opponent is away, even before claimWinAvailable', () => {
    useGameStore.setState({ opponentPresent: false, claimWinAvailable: false })
    renderBanner()
    expect(screen.getByRole('button', { name: /leave.*resume later/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /claim win/i })).not.toBeInTheDocument()
  })

  it('adds a "Claim win" button once claimWinAvailable is true', () => {
    useGameStore.setState({ opponentPresent: false, claimWinAvailable: true })
    renderBanner()
    expect(screen.getByRole('button', { name: /claim win/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /leave.*resume later/i })).toBeInTheDocument()
  })

  it('never renders a forfeit countdown — no numeric/seconds copy anywhere', () => {
    useGameStore.setState({ opponentPresent: false, claimWinAvailable: true })
    renderBanner()
    expect(screen.queryByText(/forfeit/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/seconds?/i)).not.toBeInTheDocument()
  })

  it('the Claim win button calls claimWin', () => {
    const claimWinMock = vi.fn()
    const original = useGameStore.getState().claimWin
    useGameStore.setState({ opponentPresent: false, claimWinAvailable: true, claimWin: claimWinMock } as never)

    renderBanner()
    fireEvent.click(screen.getByRole('button', { name: /claim win/i }))
    expect(claimWinMock).toHaveBeenCalledTimes(1)

    useGameStore.setState({ claimWin: original } as never)
  })

  it('the Leave & resume later button calls leaveOnline and navigates home (the game stays saved)', () => {
    const leaveOnlineMock = vi.fn()
    const original = useGameStore.getState().leaveOnline
    useGameStore.setState({ opponentPresent: false, claimWinAvailable: true, leaveOnline: leaveOnlineMock } as never)

    renderBanner()
    fireEvent.click(screen.getByRole('button', { name: /leave.*resume later/i }))
    expect(leaveOnlineMock).toHaveBeenCalledTimes(1)

    useGameStore.setState({ leaveOnline: original } as never)
  })
})

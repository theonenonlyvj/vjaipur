import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DisconnectBanner } from '../../src/components/DisconnectBanner'
import { useGameStore } from '../../src/store/gameStore'

// DisconnectBanner is now the cover/reclaim banner (there is no more online
// forfeit — an absent seat is AI-covered, never forfeited; see
// worker/src/do/presence.ts). It reads coveredSeat/opponentCovered directly,
// no countdown timer.
beforeEach(() => {
  useGameStore.setState({ coveredSeat: false, opponentCovered: false })
})

describe('DisconnectBanner', () => {
  it('renders nothing when nobody is covered', () => {
    const { container } = render(<DisconnectBanner />)
    expect(container.textContent).toBe('')
  })

  it('shows an away/AI-covering message when the OPPONENT is covered', () => {
    useGameStore.setState({ opponentCovered: true })
    render(<DisconnectBanner />)
    expect(screen.getByText(/opponent away/i)).toBeInTheDocument()
    expect(screen.getByText(/ai is playing for them/i)).toBeInTheDocument()
  })

  it('shows a reclaim affordance when MY OWN seat is covered', () => {
    useGameStore.setState({ coveredSeat: true })
    render(<DisconnectBanner />)
    expect(screen.getByText(/ai covered your seat/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /take back my seat/i })).toBeInTheDocument()
  })

  it('the reclaim button calls reclaimSeat', () => {
    const reclaimSeatMock = vi.fn()
    const original = useGameStore.getState().reclaimSeat
    useGameStore.setState({ coveredSeat: true, reclaimSeat: reclaimSeatMock } as never)

    render(<DisconnectBanner />)
    fireEvent.click(screen.getByRole('button', { name: /take back my seat/i }))
    expect(reclaimSeatMock).toHaveBeenCalledTimes(1)

    useGameStore.setState({ reclaimSeat: original } as never)
  })

  it('my own coveredSeat takes priority over opponentCovered if somehow both are true', () => {
    useGameStore.setState({ coveredSeat: true, opponentCovered: true })
    render(<DisconnectBanner />)
    expect(screen.getByRole('button', { name: /take back my seat/i })).toBeInTheDocument()
    expect(screen.queryByText(/opponent away/i)).not.toBeInTheDocument()
  })
})

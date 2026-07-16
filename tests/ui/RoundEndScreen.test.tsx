import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

describe('Forfeit outcome (online)', () => {
  it('does not show a Back to Menu control when onlineStatus is not forfeited', () => {
    render(<MemoryRouter><RoundEndScreen /></MemoryRouter>)
    expect(screen.queryByRole('button', { name: /back to menu/i })).not.toBeInTheDocument()
  })

  it('shows a Back to Menu control and calls leaveOnline when a forfeit lands while round-end is showing', () => {
    const leaveOnlineMock = vi.fn()
    const original = (useGameStore.getState() as any).leaveOnline
    useGameStore.setState({ mode: 'online', onlineStatus: 'forfeited', leaveOnline: leaveOnlineMock } as any)

    render(<MemoryRouter><RoundEndScreen /></MemoryRouter>)
    expect(screen.getByText(/opponent left.*you win/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /back to menu/i }))
    expect(leaveOnlineMock).toHaveBeenCalledTimes(1)

    // Restore so this mock doesn't leak into other tests in this file
    useGameStore.setState({ mode: 'local', onlineStatus: 'idle', leaveOnline: original } as any)
  })
})

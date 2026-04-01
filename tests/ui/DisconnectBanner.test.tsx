import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DisconnectBanner } from '../../src/components/DisconnectBanner'
import { useGameStore } from '../../src/store/gameStore'

beforeEach(() => {
  useGameStore.setState({ onlineStatus: 'idle' })
})

describe('DisconnectBanner', () => {
  it('renders nothing when status is idle', () => {
    const { container } = render(<DisconnectBanner />)
    expect(container.textContent).toBe('')
  })

  it('shows disconnect message and countdown when opponent disconnects', () => {
    useGameStore.setState({ onlineStatus: 'opponent-disconnected' })
    render(<DisconnectBanner />)
    expect(screen.getByText(/opponent disconnected/i)).toBeInTheDocument()
    expect(screen.getByText(/180s/i)).toBeInTheDocument()
  })

  it('shows forfeit win message when opponent forfeits', () => {
    useGameStore.setState({ onlineStatus: 'forfeited' })
    render(<DisconnectBanner />)
    expect(screen.getByText(/forfeit/i)).toBeInTheDocument()
    expect(screen.getByText(/you win/i)).toBeInTheDocument()
  })
})

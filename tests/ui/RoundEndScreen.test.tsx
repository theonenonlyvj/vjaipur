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
  useGameStore.setState({ state: makeRoundEndState(), mode: 'local', error: null })
})

describe('RoundEndScreen', () => {
  it('shows Player 1 and Player 2 labels', () => {
    render(<MemoryRouter><RoundEndScreen /></MemoryRouter>)
    expect(screen.getByText(/player 1/i)).toBeInTheDocument()
    expect(screen.getByText(/player 2/i)).toBeInTheDocument()
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

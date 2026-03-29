import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { GameScreen } from '../../src/screens/GameScreen'
import { useGameStore } from '../../src/store/gameStore'

beforeEach(() => {
  useGameStore.getState().startGame('local')
})

describe('GameScreen', () => {
  it('renders without crashing with an active game', () => {
    render(<MemoryRouter><GameScreen /></MemoryRouter>)
    // Market always has 5 cards — at least one should be a known good or camel
    const goodLabels = ['Diamond', 'Gold', 'Silver', 'Cloth', 'Spice', 'Leather', 'Camel']
    const found = goodLabels.filter(l => screen.queryAllByText(l).length > 0)
    expect(found.length).toBeGreaterThan(0)
  })

  it('shows YOUR TURN indicator when game is active', () => {
    render(<MemoryRouter><GameScreen /></MemoryRouter>)
    expect(screen.getByText('YOUR TURN')).toBeInTheDocument()
  })

  it('renders nothing (navigates away) when state is null', () => {
    useGameStore.setState({ state: null })
    const { container } = render(
      <MemoryRouter initialEntries={['/game']}>
        <GameScreen />
      </MemoryRouter>
    )
    expect(container.textContent).toBe('')
  })
})

describe('AI thinking indicator', () => {
  it('is absent when aiThinking is false', () => {
    render(<MemoryRouter><GameScreen /></MemoryRouter>)
    expect(screen.queryByText(/ai is thinking/i)).not.toBeInTheDocument()
  })

  it('shows "AI is thinking…" when aiThinking is true', () => {
    useGameStore.setState({ aiThinking: true })
    render(<MemoryRouter><GameScreen /></MemoryRouter>)
    expect(screen.getByText(/ai is thinking/i)).toBeInTheDocument()
  })
})

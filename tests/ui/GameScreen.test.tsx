import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { GameScreen } from '../../src/screens/GameScreen'
import { useGameStore } from '../../src/store/gameStore'
import type { BonusToken } from '../../src/engine'

beforeEach(() => {
  useGameStore.getState().startGame('local')
})

describe('GameScreen', () => {
  it('renders without crashing with an active game', () => {
    render(<MemoryRouter><GameScreen /></MemoryRouter>)
    // Market always has 5 cards — at least one should be a known good or camel
    const goodLabels = ['DIAMOND', 'GOLD', 'SILVER', 'CLOTH', 'SPICE', 'LEATHER', 'CAMEL']
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

describe('Forfeit outcome (online)', () => {
  it('does not show a Back to Menu control when onlineStatus is not forfeited', () => {
    render(<MemoryRouter><GameScreen /></MemoryRouter>)
    expect(screen.queryByRole('button', { name: /back to menu/i })).not.toBeInTheDocument()
  })

  it('shows a Back to Menu control and calls leaveOnline when onlineStatus is forfeited', () => {
    const leaveOnlineMock = vi.fn()
    const original = (useGameStore.getState() as any).leaveOnline
    useGameStore.setState({ mode: 'online', onlineStatus: 'forfeited', leaveOnline: leaveOnlineMock } as any)

    render(<MemoryRouter><GameScreen /></MemoryRouter>)
    expect(screen.getByText(/opponent left.*you win/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /back to menu/i }))
    expect(leaveOnlineMock).toHaveBeenCalledTimes(1)

    // Restore so this mock doesn't leak into other tests in this file
    useGameStore.setState({ mode: 'local', onlineStatus: 'idle', leaveOnline: original } as any)
  })
})

describe('BonusReveal', () => {
  it('does not show the bonus celebration on a fresh game', () => {
    render(<MemoryRouter><GameScreen /></MemoryRouter>)
    expect(screen.queryByText('BONUS!')).not.toBeInTheDocument()
  })

  it('mounts and shows BonusReveal when the active player already holds a new bonus token on mount', () => {
    const s = useGameStore.getState().state!
    const myIndex = s.activePlayer
    const bonus: BonusToken = { tier: 3, value: 2 }
    const players: [typeof s.players[0], typeof s.players[1]] = [...s.players]
    players[myIndex] = { ...players[myIndex], bonusTokens: [...players[myIndex].bonusTokens, bonus] }
    useGameStore.setState({ state: { ...s, players } })

    render(<MemoryRouter><GameScreen /></MemoryRouter>)
    expect(screen.getByText('BONUS!')).toBeInTheDocument()
  })
})

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
    expect(screen.queryByText(/bot is thinking/i)).not.toBeInTheDocument()
  })

  it('shows "Bot is thinking…" when aiThinking is true', () => {
    useGameStore.setState({ aiThinking: true })
    render(<MemoryRouter><GameScreen /></MemoryRouter>)
    expect(screen.getByText(/bot is thinking/i)).toBeInTheDocument()
  })
})

// FORFEIT is gone online (an absent seat is AI-covered, never forfeited —
// worker/src/do/presence.ts). Match end (however it happens, incl. a
// resign) now routes through the normal phase -> '/game-over' navigation
// guard above, so there's no special in-GameScreen overlay to test anymore;
// what replaces it is the Resign affordance below and the cover/away
// banner (see tests/ui/DisconnectBanner.test.tsx).
describe('Resign (online)', () => {
  it('does not show a resign control outside online mode', () => {
    render(<MemoryRouter><GameScreen /></MemoryRouter>)
    expect(screen.queryByRole('button', { name: /resign match/i })).not.toBeInTheDocument()
  })

  it('shows a resign control in online mode, behind a confirm', () => {
    useGameStore.setState({ mode: 'online' })
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)

    render(<MemoryRouter><GameScreen /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /resign match/i }))

    expect(confirmSpy).toHaveBeenCalled()
    confirmSpy.mockRestore()
    useGameStore.setState({ mode: 'local' })
  })

  it('calls resignMatch only when the confirm is accepted', () => {
    const resignMatchMock = vi.fn()
    const original = useGameStore.getState().resignMatch
    useGameStore.setState({ mode: 'online', resignMatch: resignMatchMock } as any)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<MemoryRouter><GameScreen /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /resign match/i }))

    expect(resignMatchMock).toHaveBeenCalledTimes(1)
    confirmSpy.mockRestore()
    useGameStore.setState({ mode: 'local', resignMatch: original } as any)
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

// Deck-count warning color: a round ends the instant the deck empties, so a
// shrinking deck is a real "wrap it up" signal. Amber <=6, red <=3, normal
// (unstyled, i.e. the base #888) otherwise. deck contents don't matter here —
// only .length — so a same-length slice of the freshly-dealt deck is fine.
describe('Deck count warning color', () => {
  function setDeckLength(n: number) {
    const s = useGameStore.getState().state!
    useGameStore.setState({ state: { ...s, deck: s.deck.slice(0, n) } })
  }

  it.each([6, 5, 4])('renders amber (#f09030, bold) at %i cards left', (n) => {
    setDeckLength(n)
    render(<MemoryRouter><GameScreen /></MemoryRouter>)
    expect(screen.getByText(`Deck: ${n}`)).toHaveStyle({ color: '#f09030', fontWeight: 800 })
  })

  it.each([3, 2, 1, 0])('renders red (#e05050, bold) at %i cards left', (n) => {
    setDeckLength(n)
    render(<MemoryRouter><GameScreen /></MemoryRouter>)
    expect(screen.getByText(`Deck: ${n}`)).toHaveStyle({ color: '#e05050', fontWeight: 800 })
  })

  it('renders the normal (unstyled) color at 7+ cards left', () => {
    setDeckLength(7)
    render(<MemoryRouter><GameScreen /></MemoryRouter>)
    expect(screen.getByText('Deck: 7')).toHaveStyle({ color: '#888' })
  })
})

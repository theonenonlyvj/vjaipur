import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SessionBanner } from '../../src/components/SessionBanner'
import { useStatsStore } from '../../src/store/statsStore'

// ProfileOverlay (rendered by SessionBanner's own Log In button) transitively
// pulls in socketService — mirrors ProfileOverlay.test.tsx/StatsDashboard.
// test.tsx's own mock.
vi.mock('../../src/socket/socketService', () => ({
  socketService: {
    connect: vi.fn(),
    connected: false,
    setAuthToken: vi.fn(),
    updateProfile: vi.fn(),
    secureAccount: vi.fn(),
    restoreAccount: vi.fn(),
    pullHistory: vi.fn(),
  },
}))

beforeEach(() => {
  useStatsStore.getState().clearStats()
})

describe('SessionBanner', () => {
  it('renders nothing when sessionExpired is false', () => {
    useStatsStore.setState({ sessionExpired: false })
    const { container } = render(<SessionBanner />)
    expect(container.textContent).toBe('')
  })

  it('shows the signed-out banner + Log In button when sessionExpired is true', () => {
    useStatsStore.setState({ sessionExpired: true })
    render(<SessionBanner />)
    expect(
      screen.getByText("You're signed out — log in to keep syncing your games and stats.")
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument()
  })

  it('Log In opens ProfileOverlay', () => {
    useStatsStore.setState({ sessionExpired: true })
    render(<SessionBanner />)
    fireEvent.click(screen.getByRole('button', { name: /log in/i }))
    expect(screen.getByText('PROFILE')).toBeInTheDocument()
  })

  it('dismiss (×) hides the banner', () => {
    useStatsStore.setState({ sessionExpired: true })
    render(<SessionBanner />)
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(
      screen.queryByText("You're signed out — log in to keep syncing your games and stats.")
    ).not.toBeInTheDocument()
  })

  it('re-shows on a NEW expiry episode after being dismissed', () => {
    useStatsStore.setState({ sessionExpired: true })
    const { rerender } = render(<SessionBanner />)
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(
      screen.queryByText("You're signed out — log in to keep syncing your games and stats.")
    ).not.toBeInTheDocument()

    // Flip false -> true again (e.g. a fresh login then a later re-expiry).
    useStatsStore.setState({ sessionExpired: false })
    rerender(<SessionBanner />)
    useStatsStore.setState({ sessionExpired: true })
    rerender(<SessionBanner />)

    expect(
      screen.getByText("You're signed out — log in to keep syncing your games and stats.")
    ).toBeInTheDocument()
  })
})

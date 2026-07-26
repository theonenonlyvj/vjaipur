import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ProfileOverlay } from '../../src/components/ProfileOverlay'
import { useStatsStore } from '../../src/store/statsStore'

vi.mock('../../src/socket/socketService', () => ({
  socketService: {
    connect: vi.fn(),
    secureAccount: vi.fn(),
    restoreAccount: vi.fn(),
    pullHistory: vi.fn(),
  },
}))

describe('ProfileOverlay', () => {
  it('renders correctly for a guest', () => {
    useStatsStore.getState().clearStats()
    useStatsStore.getState().ensureAccount()

    render(<ProfileOverlay onClose={() => {}} />)

    expect(screen.getByText('PROFILE')).toBeDefined()
    expect(screen.getByText('GUEST ACCOUNT')).toBeDefined()
    // Post-flip labels: Secure Account -> Create Account, Restore Account -> Log In
    expect(screen.getByRole('button', { name: 'Create Account' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Log In' })).toBeDefined()
  })

  it('shows the create-account form when Create Account is clicked', () => {
    useStatsStore.getState().ensureAccount()
    render(<ProfileOverlay onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }))

    expect(screen.getByPlaceholderText('Username')).toBeDefined()
    expect(screen.getByPlaceholderText('Password')).toBeDefined()
    // the form title h3 also reads "Create Account", so scope to the submit button role
    expect(screen.getByRole('button', { name: 'Create Account' })).toBeDefined()
  })

  it('shows the log-in form when Log In is clicked', () => {
    useStatsStore.getState().ensureAccount()
    render(<ProfileOverlay onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Log In' }))

    expect(screen.getByPlaceholderText('Username')).toBeDefined()
    expect(screen.getByPlaceholderText('Password')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Log In' })).toBeDefined()
  })

  // ── Claim state (the renamed-guest dead-end bug) ───────────────────────────
  it('keeps Create Account + GUEST badge for a renamed-but-unclaimed account', () => {
    // The bug: a guest who renamed to a real name (non-Guest_) used to lose
    // "Create Account" forever and falsely show "SECURED ACCOUNT". With explicit
    // claim state (claimed === false) they must still read as a guest.
    useStatsStore.getState().clearStats()
    useStatsStore.setState({ displayName: 'Veera', friendCode: 'VJ-1234', claimed: false })

    render(<ProfileOverlay onClose={() => {}} />)

    expect(screen.getByText('GUEST ACCOUNT')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Create Account' })).toBeDefined()
  })

  it('hides Create Account + shows SECURED badge for a claimed account', () => {
    useStatsStore.getState().clearStats()
    useStatsStore.setState({ displayName: 'Veera', friendCode: 'VJ-1234', claimed: true })

    render(<ProfileOverlay onClose={() => {}} />)

    expect(screen.getByText('SECURED ACCOUNT')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Create Account' })).toBeNull()
  })

  it('legacy fallback (claimed undefined): a Guest_ name still reads as a guest', () => {
    useStatsStore.getState().clearStats()
    useStatsStore.setState({ displayName: 'Guest_1234', friendCode: 'VJ-1234', claimed: undefined })

    render(<ProfileOverlay onClose={() => {}} />)

    expect(screen.getByText('GUEST ACCOUNT')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Create Account' })).toBeDefined()
  })

  it("legacy fallback (claimed undefined): a real name reads as secured (today's behavior preserved)", () => {
    useStatsStore.getState().clearStats()
    useStatsStore.setState({ displayName: 'Veera', friendCode: 'VJ-1234', claimed: undefined })

    render(<ProfileOverlay onClose={() => {}} />)

    expect(screen.getByText('SECURED ACCOUNT')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Create Account' })).toBeNull()
  })

  // ── sessionExpired (the "you were signed out" signal) ──────────────────────
  describe('sessionExpired', () => {
    it('shows the expired strip when sessionExpired is true', () => {
      useStatsStore.getState().clearStats()
      useStatsStore.getState().ensureAccount()
      useStatsStore.setState({ sessionExpired: true })

      render(<ProfileOverlay onClose={() => {}} />)

      expect(screen.getByText(/session expired — log in again/i)).toBeInTheDocument()
    })

    it('does not show the expired strip when sessionExpired is false', () => {
      useStatsStore.getState().clearStats()
      useStatsStore.getState().ensureAccount()
      useStatsStore.setState({ sessionExpired: false })

      render(<ProfileOverlay onClose={() => {}} />)

      expect(screen.queryByText(/session expired — log in again/i)).not.toBeInTheDocument()
    })

    it('auto-expands the login form on mount when sessionExpired is true — no separate tap needed', () => {
      useStatsStore.getState().clearStats()
      useStatsStore.getState().ensureAccount()
      useStatsStore.setState({ sessionExpired: true })

      render(<ProfileOverlay onClose={() => {}} />)

      expect(screen.getByPlaceholderText('Username')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('Password')).toBeInTheDocument()
    })

    it('does NOT auto-expand the login form when sessionExpired is false (today\'s behavior preserved)', () => {
      useStatsStore.getState().clearStats()
      useStatsStore.getState().ensureAccount()
      useStatsStore.setState({ sessionExpired: false })

      render(<ProfileOverlay onClose={() => {}} />)

      expect(screen.queryByPlaceholderText('Username')).not.toBeInTheDocument()
    })
  })
})

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
})

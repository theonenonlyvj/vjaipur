import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ProfileOverlay } from '../../src/components/ProfileOverlay'
import { useStatsStore } from '../../src/store/statsStore'

vi.mock('../../src/socket/socketService', () => ({
  socketService: {
    connect: vi.fn(),
    secureAccount: vi.fn(),
    restoreAccount: vi.fn(),
  },
}))

describe('ProfileOverlay', () => {
  it('renders correctly for a guest', () => {
    useStatsStore.getState().clearStats()
    useStatsStore.getState().ensureAccount()
    
    render(<ProfileOverlay onClose={() => {}} />)
    
    expect(screen.getByText('PROFILE')).toBeDefined()
    expect(screen.getByText('GUEST ACCOUNT')).toBeDefined()
    expect(screen.getByText('Secure Account')).toBeDefined()
    expect(screen.getByText('Restore Account')).toBeDefined()
  })

  it('shows secure form when Secure Account is clicked', () => {
    render(<ProfileOverlay onClose={() => {}} />)
    
    fireEvent.click(screen.getByText('Secure Account'))
    
    expect(screen.getByPlaceholderText('Username')).toBeDefined()
    expect(screen.getByPlaceholderText('Password')).toBeDefined()
    expect(screen.getByText('Secure')).toBeDefined()
  })

  it('shows restore form when Restore Account is clicked', () => {
    render(<ProfileOverlay onClose={() => {}} />)
    
    fireEvent.click(screen.getByText('Restore Account'))
    
    expect(screen.getByPlaceholderText('Username')).toBeDefined()
    expect(screen.getByPlaceholderText('Password')).toBeDefined()
    expect(screen.getByText('Restore')).toBeDefined()
  })
})

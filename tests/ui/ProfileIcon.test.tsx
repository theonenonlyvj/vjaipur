import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProfileIcon } from '../../src/components/ProfileIcon'
import { useStatsStore } from '../../src/store/statsStore'

describe('ProfileIcon', () => {
  it('shows no badge when sessionExpired is false', () => {
    useStatsStore.getState().clearStats()
    useStatsStore.getState().ensureAccount()
    useStatsStore.setState({ sessionExpired: false })

    const { container } = render(<ProfileIcon onClick={() => {}} />)

    expect(container.querySelector('[data-testid="session-expired-badge"]')).toBeNull()
  })

  it('shows a badge when sessionExpired is true', () => {
    useStatsStore.getState().clearStats()
    useStatsStore.getState().ensureAccount()
    useStatsStore.setState({ sessionExpired: true })

    const { container } = render(<ProfileIcon onClick={() => {}} />)

    expect(container.querySelector('[data-testid="session-expired-badge"]')).not.toBeNull()
  })

  it('renders correctly (button still clickable, avatar initial shown)', () => {
    useStatsStore.getState().clearStats()
    useStatsStore.setState({ displayName: 'Veera', friendCode: 'VJ-1234', claimed: true, sessionExpired: true })

    render(<ProfileIcon onClick={() => {}} />)

    expect(screen.getByRole('button')).toBeInTheDocument()
    expect(screen.getByText('V')).toBeInTheDocument()
  })
})

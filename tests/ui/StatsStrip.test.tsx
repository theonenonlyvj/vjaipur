import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StatsStrip } from '../../src/components/StatsStrip'
import { useStatsStore } from '../../src/store/statsStore'

// Mock socket service as it's used in statsStore
vi.mock('../../src/socket/socketService', () => ({
  socketService: {
    syncMatch: vi.fn(),
  },
}))

describe('StatsStrip', () => {
  it('renders record and delta correctly', () => {
    // Setup some matches
    useStatsStore.getState().clearStats()
    useStatsStore.getState().addMatch({
      opponent_type: 'easy',
      player_score: 50,
      opponent_score: 30,
      won: true,
    })
    useStatsStore.getState().addMatch({
      opponent_type: 'medium',
      player_score: 20,
      opponent_score: 40,
      won: false,
    })
    
    render(<StatsStrip onClick={() => {}} />)
    
    expect(screen.getByText('RECORD')).toBeDefined()
    expect(screen.getByText('1W - 1L')).toBeDefined()
    expect(screen.getByText('TOTAL Δ')).toBeDefined()
    // 50-30 = 20, 20-40 = -20. Total delta = 0
    expect(screen.getByText('0')).toBeDefined()
  })

  it('renders positive delta correctly', () => {
    useStatsStore.getState().clearStats()
    useStatsStore.getState().addMatch({
      opponent_type: 'easy',
      player_score: 60,
      opponent_score: 20,
      won: true,
    })
    
    render(<StatsStrip onClick={() => {}} />)
    
    expect(screen.getByText('1W - 0L')).toBeDefined()
    expect(screen.getByText('+40')).toBeDefined()
  })

  it('renders negative delta correctly', () => {
    useStatsStore.getState().clearStats()
    useStatsStore.getState().addMatch({
      opponent_type: 'easy',
      player_score: 10,
      opponent_score: 50,
      won: false,
    })
    
    render(<StatsStrip onClick={() => {}} />)
    
    expect(screen.getByText('0W - 1L')).toBeDefined()
    expect(screen.getByText('-40')).toBeDefined()
  })

  it('calls onClick when clicked', () => {
    const onClick = vi.fn()
    render(<StatsStrip onClick={onClick} />)
    
    // Click on the RECORD text, it should bubble up to the container
    fireEvent.click(screen.getByText('RECORD'))
    
    expect(onClick).toHaveBeenCalled()
  })
})

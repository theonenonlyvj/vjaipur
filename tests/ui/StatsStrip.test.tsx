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

  // Owner's 2026-07-28 GAMES-first ruling — RECORD is GAMES-primary, not
  // match count. A mix of an explicit split (a matchLength-5 win, 3 games to
  // 1) and a legacy no-split record proves the badge sums GAMES, not matches.
  it('sums the games record (not the match count) from a mix of an explicit split and a legacy no-split record', () => {
    useStatsStore.getState().clearStats()
    useStatsStore.getState().addMatch({
      opponent_type: 'medium',
      player_score: 210,
      opponent_score: 140,
      won: true,
      games_won: 3,
      games_lost: 1,
    })
    useStatsStore.getState().addMatch({
      opponent_type: 'medium',
      player_score: 20,
      opponent_score: 45,
      won: false,
      // no games_won/games_lost — legacy record, falls back to 1 game by won.
    })

    render(<StatsStrip onClick={() => {}} />)

    // 2 matches would read 1W-1L; GAMES sums 3+0=3 won, 1+1=2 lost.
    expect(screen.getByText('3W - 2L')).toBeDefined()
    expect(screen.queryByText('1W - 1L')).toBeNull()
    // TOTAL Δ is unchanged (a raw sum, already game-derived): 70 + -25 = 45.
    expect(screen.getByText('+45')).toBeDefined()
  })
})

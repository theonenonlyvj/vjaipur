import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TokenRail } from '../../src/components/TokenRail'
import { initialTokenPiles, initialBonusPiles } from '../../src/engine'

const tokens = initialTokenPiles()
const bonusTokens = initialBonusPiles(() => 0.5)

describe('TokenRail', () => {
  it('renders all 6 good labels', () => {
    render(<TokenRail tokens={tokens} bonusTokens={bonusTokens} />)
    expect(screen.getByText(/diamond/i)).toBeInTheDocument()
    expect(screen.getByText(/gold/i)).toBeInTheDocument()
    expect(screen.getByText(/silver/i)).toBeInTheDocument()
    expect(screen.getByText(/cloth/i)).toBeInTheDocument()
    expect(screen.getByText(/spice/i)).toBeInTheDocument()
    expect(screen.getByText(/leather/i)).toBeInTheDocument()
  })

  it('shows the top token value for diamond (7)', () => {
    render(<TokenRail tokens={tokens} bonusTokens={bonusTokens} />)
    // Diamond pile top is 7; there should be at least one '7' rendered
    expect(screen.getAllByText('7').length).toBeGreaterThanOrEqual(1)
  })

  it('shows remaining token counts with × prefix', () => {
    render(<TokenRail tokens={tokens} bonusTokens={bonusTokens} />)
    // Diamond pile has 5 tokens → ×5
    expect(screen.getAllByText('×5').length).toBeGreaterThanOrEqual(1)
  })

  it('shows bonus pile counts', () => {
    render(<TokenRail tokens={tokens} bonusTokens={bonusTokens} />)
    // three-pile has 7 bonus tokens
    expect(screen.getAllByText('×7').length).toBeGreaterThanOrEqual(1)
  })
})

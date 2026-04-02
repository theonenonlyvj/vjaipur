import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { RulesScreen } from '../../src/screens/RulesScreen'

function renderScreen() {
  return render(<MemoryRouter><RulesScreen /></MemoryRouter>)
}

describe('RulesScreen', () => {
  it('renders 3 tabs', () => {
    renderScreen()
    expect(screen.getByText('Gameplay')).toBeInTheDocument()
    expect(screen.getByText('Scoring')).toBeInTheDocument()
    expect(screen.getByText('Strategy')).toBeInTheDocument()
  })

  it('shows Gameplay tab content by default', () => {
    renderScreen()
    expect(screen.getByText('Your Turn')).toBeInTheDocument()
    expect(screen.getByText('Hand Limit')).toBeInTheDocument()
  })

  it('switches to Scoring tab on click', () => {
    renderScreen()
    fireEvent.click(screen.getByText('Scoring'))
    expect(screen.getByText('Token Values')).toBeInTheDocument()
    expect(screen.getByText('Bonus Tokens')).toBeInTheDocument()
    expect(screen.getByText('Diamond')).toBeInTheDocument()
  })

  it('switches to Strategy tab on click', () => {
    renderScreen()
    fireEvent.click(screen.getByText('Strategy'))
    expect(screen.getByText('Sell Early')).toBeInTheDocument()
    expect(screen.getByText('Read Your Opponent')).toBeInTheDocument()
  })

  it('renders Start Tutorial button', () => {
    renderScreen()
    expect(screen.getByText('Start Tutorial')).toBeInTheDocument()
  })

  it('renders back button', () => {
    renderScreen()
    expect(screen.getByText('← Back')).toBeInTheDocument()
  })
})

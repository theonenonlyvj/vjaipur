import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { TutorialOverlay } from '../../src/components/TutorialOverlay'
import { useGameStore } from '../../src/store/gameStore'

beforeEach(() => {
  useGameStore.getState().startGame('local')
})

/** Advance through chapter 1's action-triggered steps by simulating state changes */
function advanceToStep6() {
  // Steps 1→2→3 via Next
  fireEvent.click(screen.getByText('Next →'))
  fireEvent.click(screen.getByText('Next →'))
  fireEvent.click(screen.getByText('Next →')) // now on step 4 (took-card banner)

  // Simulate taking a card → advances step 4→5
  const s1 = useGameStore.getState().state!
  act(() => {
    useGameStore.setState({
      state: { ...s1, players: [{ ...s1.players[0], hand: [...s1.players[0].hand, { id: 999, type: 'gold' as const }] }, s1.players[1]] }
    })
  })

  // Simulate selling → advances step 5→6
  const s2 = useGameStore.getState().state!
  act(() => {
    useGameStore.setState({
      state: { ...s2, players: [{ ...s2.players[0], tokens: [...s2.players[0].tokens, { good: 'gold' as const, value: 6 }] }, s2.players[1]] }
    })
  })
  // Now on step 6 (Exchanges) — button-triggered
}

describe('TutorialOverlay', () => {
  it('renders step 1 title on mount', () => {
    render(<TutorialOverlay onDone={() => {}} />)
    expect(screen.getByText('Welcome to Jaipur!')).toBeInTheDocument()
  })

  it('shows chapter progress indicator', () => {
    render(<TutorialOverlay onDone={() => {}} />)
    expect(screen.getByText(/Chapter 1/)).toBeInTheDocument()
    expect(screen.getByText(/1 \/ 6/)).toBeInTheDocument()
  })

  it('advances to next step on Next click', () => {
    render(<TutorialOverlay onDone={() => {}} />)
    fireEvent.click(screen.getByText('Next →'))
    expect(screen.getByText('The Market')).toBeInTheDocument()
    expect(screen.getByText(/2 \/ 6/)).toBeInTheDocument()
  })

  it('shows chapter transition after completing chapter 1', () => {
    render(<TutorialOverlay onDone={() => {}} />)
    advanceToStep6()
    fireEvent.click(screen.getByText('Next →'))
    expect(screen.getByText('Chapter 1 complete!')).toBeInTheDocument()
  })

  it('chapter transition Skip calls onDone', () => {
    const onDone = vi.fn()
    render(<TutorialOverlay onDone={onDone} />)
    advanceToStep6()
    fireEvent.click(screen.getByText('Next →'))
    fireEvent.click(screen.getByText('Skip — Start Playing'))
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('chapter transition Continue advances to chapter 2', () => {
    render(<TutorialOverlay onDone={() => {}} />)
    advanceToStep6()
    fireEvent.click(screen.getByText('Next →'))
    fireEvent.click(screen.getByText('Continue →'))
    expect(screen.getByText('Token Values')).toBeInTheDocument()
    expect(screen.getByText(/Chapter 2/)).toBeInTheDocument()
  })

  it('calls onDone when Skip Tutorial is clicked', () => {
    const onDone = vi.fn()
    render(<TutorialOverlay onDone={onDone} />)
    fireEvent.click(screen.getByText('Skip Tutorial'))
    expect(onDone).toHaveBeenCalledOnce()
  })
})

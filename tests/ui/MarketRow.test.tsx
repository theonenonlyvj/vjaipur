import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MarketRow } from '../../src/components/MarketRow'
import type { Card } from '../../src/engine'

const market: Card[] = [
  { id: 1, type: 'gold' },
  { id: 2, type: 'camel' },
  { id: 3, type: 'spice' },
  { id: 4, type: 'leather' },
  { id: 5, type: 'diamond' },
]

describe('MarketRow', () => {
  it('renders 5 cards', () => {
    const { unmount } = render(
      <MarketRow
        market={market}
        selectedIndices={[]}
        onToggleSelect={vi.fn()}
      />
    )
    expect(screen.getByText('Gold')).toBeInTheDocument()
    expect(screen.getByText('Camel')).toBeInTheDocument()
    expect(screen.getByText('Spice')).toBeInTheDocument()
    expect(screen.getByText('Leather')).toBeInTheDocument()
    expect(screen.getByText('Diamond')).toBeInTheDocument()
    unmount()
  })

  it('calls onToggleSelect with correct index when clicking a non-camel card', () => {
    const onToggle = vi.fn()
    const { unmount } = render(
      <MarketRow
        market={market}
        selectedIndices={[]}
        onToggleSelect={onToggle}
      />
    )
    fireEvent.click(screen.getAllByText('Gold')[0])
    expect(onToggle).toHaveBeenCalledWith(0)
    unmount()
  })

  it('does not call onToggleSelect for camels', () => {
    const onToggle = vi.fn()
    const { unmount } = render(
      <MarketRow
        market={market}
        selectedIndices={[]}
        onToggleSelect={onToggle}
      />
    )
    fireEvent.click(screen.getAllByText('Camel')[0])
    expect(onToggle).not.toHaveBeenCalled()
    unmount()
  })

  it('calls onToggleSelect for any non-camel card (no separate exchange mode)', () => {
    const onToggle = vi.fn()
    const { unmount } = render(
      <MarketRow
        market={market}
        selectedIndices={[]}
        onToggleSelect={onToggle}
      />
    )
    fireEvent.click(screen.getAllByText('Spice')[0])
    expect(onToggle).toHaveBeenCalledWith(2)
    unmount()
  })
})

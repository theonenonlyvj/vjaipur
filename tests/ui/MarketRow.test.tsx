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
    expect(screen.getByText('GOLD')).toBeInTheDocument()
    expect(screen.getByText('CAMEL')).toBeInTheDocument()
    expect(screen.getByText('SPICE')).toBeInTheDocument()
    expect(screen.getByText('LEATHER')).toBeInTheDocument()
    expect(screen.getByText('DIAMOND')).toBeInTheDocument()
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
    fireEvent.click(screen.getAllByText('GOLD')[0])
    expect(onToggle).toHaveBeenCalledWith(0)
    unmount()
  })

  it('calls onToggleSelect for camels', () => {
    const onToggle = vi.fn()
    const { unmount } = render(
      <MarketRow
        market={market}
        selectedIndices={[]}
        onToggleSelect={onToggle}
      />
    )
    fireEvent.click(screen.getAllByText('CAMEL')[0])
    expect(onToggle).toHaveBeenCalledWith(1)
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
    fireEvent.click(screen.getAllByText('SPICE')[0])
    expect(onToggle).toHaveBeenCalledWith(2)
    unmount()
  })
})

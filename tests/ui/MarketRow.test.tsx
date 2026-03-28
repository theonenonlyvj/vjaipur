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
        exchangeMode={false}
        selectedIndices={[]}
        onTakeSingle={vi.fn()}
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

  it('calls onTakeSingle with correct index in normal mode', () => {
    const onTakeSingle = vi.fn()
    const { unmount } = render(
      <MarketRow
        market={market}
        exchangeMode={false}
        selectedIndices={[]}
        onTakeSingle={onTakeSingle}
        onToggleSelect={vi.fn()}
      />
    )
    fireEvent.click(screen.getAllByText('Gold')[0])
    expect(onTakeSingle).toHaveBeenCalledWith(0)
    unmount()
  })

  it('does not call onTakeSingle for camels in normal mode', () => {
    const onTakeSingle = vi.fn()
    const { unmount } = render(
      <MarketRow
        market={market}
        exchangeMode={false}
        selectedIndices={[]}
        onTakeSingle={onTakeSingle}
        onToggleSelect={vi.fn()}
      />
    )
    fireEvent.click(screen.getAllByText('Camel')[0])
    expect(onTakeSingle).not.toHaveBeenCalled()
    unmount()
  })

  it('calls onToggleSelect in exchange mode (not onTakeSingle)', () => {
    const onTakeSingle = vi.fn()
    const onToggle = vi.fn()
    const { unmount } = render(
      <MarketRow
        market={market}
        exchangeMode={true}
        selectedIndices={[]}
        onTakeSingle={onTakeSingle}
        onToggleSelect={onToggle}
      />
    )
    fireEvent.click(screen.getAllByText('Spice')[0])
    expect(onToggle).toHaveBeenCalledWith(2)
    expect(onTakeSingle).not.toHaveBeenCalled()
    unmount()
  })
})

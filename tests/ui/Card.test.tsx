import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CardView } from '../../src/components/Card'

describe('CardView', () => {
  it('renders the card type label', () => {
    render(<CardView card={{ id: 1, type: 'gold' }} />)
    expect(screen.getByText('Gold')).toBeInTheDocument()
  })

  it('renders camel type', () => {
    render(<CardView card={{ id: 2, type: 'camel' }} />)
    expect(screen.getByText('Camel')).toBeInTheDocument()
  })

  it('renders all good types', () => {
    const goods = ['diamond', 'silver', 'cloth', 'spice', 'leather'] as const
    for (const type of goods) {
      const { unmount } = render(<CardView card={{ id: 0, type }} />)
      const label = type.charAt(0).toUpperCase() + type.slice(1)
      expect(screen.getByText(label)).toBeInTheDocument()
      unmount()
    }
  })

  it('applies selection outline when selected=true', () => {
    const { container } = render(<CardView card={{ id: 1, type: 'gold' }} selected />)
    const div = container.firstChild as HTMLElement
    expect(div.style.outline).toContain('2px solid')
  })

  it('has outline none when selected=false', () => {
    const { container } = render(<CardView card={{ id: 1, type: 'gold' }} selected={false} />)
    const div = container.firstChild as HTMLElement
    expect(div.style.outline).toBe('none')
  })
})

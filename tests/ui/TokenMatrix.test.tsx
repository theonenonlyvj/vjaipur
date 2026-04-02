import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TokenMatrix } from '../../src/components/TokenMatrix'

describe('TokenMatrix', () => {
  it('renders all 6 good names', () => {
    render(<TokenMatrix />)
    expect(screen.getByText('Diamond')).toBeInTheDocument()
    expect(screen.getByText('Gold')).toBeInTheDocument()
    expect(screen.getByText('Silver')).toBeInTheDocument()
    expect(screen.getByText('Cloth')).toBeInTheDocument()
    expect(screen.getByText('Spice')).toBeInTheDocument()
    expect(screen.getByText('Leather')).toBeInTheDocument()
  })

  it('renders diamond token values', () => {
    render(<TokenMatrix />)
    const row = screen.getByText('Diamond').closest('tr')!
    expect(row.textContent).toContain('7')
    expect(row.textContent).toContain('5')
  })

  it('renders leather token values', () => {
    render(<TokenMatrix />)
    const row = screen.getByText('Leather').closest('tr')!
    expect(row.textContent).toContain('4')
    expect(row.textContent).toContain('3')
    expect(row.textContent).toContain('1')
  })

  it('does not render camel row', () => {
    render(<TokenMatrix />)
    expect(screen.queryByText('Camel')).toBeNull()
  })
})

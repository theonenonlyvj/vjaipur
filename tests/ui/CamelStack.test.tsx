import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CamelStack } from '../../src/components/CamelStack'

const noop = () => {}

describe('CamelStack', () => {
  it('does not render when herd is 0', () => {
    const { container } = render(
      <CamelStack herd={0} camelsUsed={0} inExchange={false} onUseHerdCamel={noop} onRemoveCamel={noop} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders badge with herd count when herd > 0', () => {
    render(
      <CamelStack herd={5} camelsUsed={0} inExchange={false} onUseHerdCamel={noop} onRemoveCamel={noop} />
    )
    expect(screen.getByText('x5')).toBeInTheDocument()
  })

  it('badge shows available count (herd - camelsUsed)', () => {
    render(
      <CamelStack herd={5} camelsUsed={2} inExchange={true} onUseHerdCamel={noop} onRemoveCamel={noop} />
    )
    expect(screen.getByText('x3')).toBeInTheDocument()
  })

  it('does not show +/- controls when not in exchange', () => {
    render(
      <CamelStack herd={3} camelsUsed={0} inExchange={false} onUseHerdCamel={noop} onRemoveCamel={noop} />
    )
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows + control after tapping stack during exchange', () => {
    render(
      <CamelStack herd={3} camelsUsed={0} inExchange={true} onUseHerdCamel={noop} onRemoveCamel={noop} />
    )
    fireEvent.click(screen.getByTestId('camel-stack'))
    expect(screen.getByText('+')).toBeInTheDocument()
    expect(screen.getByText('(use 1)')).toBeInTheDocument()
  })

  it('hides - button when camelsUsed is 0', () => {
    render(
      <CamelStack herd={3} camelsUsed={0} inExchange={true} onUseHerdCamel={noop} onRemoveCamel={noop} />
    )
    fireEvent.click(screen.getByTestId('camel-stack'))
    expect(screen.queryByText('(remove 1)')).toBeNull()
  })

  it('shows - button when camelsUsed > 0', () => {
    render(
      <CamelStack herd={3} camelsUsed={1} inExchange={true} onUseHerdCamel={noop} onRemoveCamel={noop} />
    )
    fireEvent.click(screen.getByTestId('camel-stack'))
    expect(screen.getByText('(remove 1)')).toBeInTheDocument()
  })

  it('calls onUseHerdCamel when + is clicked', () => {
    const onUse = vi.fn()
    render(
      <CamelStack herd={3} camelsUsed={0} inExchange={true} onUseHerdCamel={onUse} onRemoveCamel={noop} />
    )
    fireEvent.click(screen.getByTestId('camel-stack'))
    fireEvent.click(screen.getByText('+'))
    expect(onUse).toHaveBeenCalledOnce()
  })

  it('calls onRemoveCamel when - is clicked', () => {
    const onRemove = vi.fn()
    render(
      <CamelStack herd={3} camelsUsed={2} inExchange={true} onUseHerdCamel={noop} onRemoveCamel={onRemove} />
    )
    fireEvent.click(screen.getByTestId('camel-stack'))
    fireEvent.click(screen.getByText('-'))
    expect(onRemove).toHaveBeenCalledOnce()
  })

  it('disables + when all camels are used', () => {
    render(
      <CamelStack herd={2} camelsUsed={2} inExchange={true} onUseHerdCamel={noop} onRemoveCamel={noop} />
    )
    fireEvent.click(screen.getByTestId('camel-stack'))
    const plusBtn = screen.getByText('+').closest('button')!
    expect(plusBtn.disabled).toBe(true)
  })

  it('renders no offset layers when herd is 1', () => {
    const { container } = render(
      <CamelStack herd={1} camelsUsed={0} inExchange={false} onUseHerdCamel={noop} onRemoveCamel={noop} />
    )
    const layers = container.querySelectorAll('[data-testid="stack-layer"]')
    expect(layers.length).toBe(0)
  })

  it('renders 1 offset layer when herd is 2', () => {
    const { container } = render(
      <CamelStack herd={2} camelsUsed={0} inExchange={false} onUseHerdCamel={noop} onRemoveCamel={noop} />
    )
    const layers = container.querySelectorAll('[data-testid="stack-layer"]')
    expect(layers.length).toBe(1)
  })

  it('renders 2 offset layers when herd is 3+', () => {
    const { container } = render(
      <CamelStack herd={5} camelsUsed={0} inExchange={false} onUseHerdCamel={noop} onRemoveCamel={noop} />
    )
    const layers = container.querySelectorAll('[data-testid="stack-layer"]')
    expect(layers.length).toBe(2)
  })

  it('controls auto-show when camelsUsed > 0 in exchange (already tapped)', () => {
    render(
      <CamelStack herd={3} camelsUsed={1} inExchange={true} onUseHerdCamel={noop} onRemoveCamel={noop} />
    )
    expect(screen.getByText('+')).toBeInTheDocument()
    expect(screen.getByText('(remove 1)')).toBeInTheDocument()
  })

  it('controls disappear when exchange ends', () => {
    const { rerender } = render(
      <CamelStack herd={3} camelsUsed={0} inExchange={true} onUseHerdCamel={noop} onRemoveCamel={noop} />
    )
    fireEvent.click(screen.getByTestId('camel-stack'))
    expect(screen.getByText('+')).toBeInTheDocument()

    rerender(
      <CamelStack herd={3} camelsUsed={0} inExchange={false} onUseHerdCamel={noop} onRemoveCamel={noop} />
    )
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('front card has white border when camelsUsed > 0', () => {
    const { container } = render(
      <CamelStack herd={3} camelsUsed={1} inExchange={true} onUseHerdCamel={noop} onRemoveCamel={noop} />
    )
    const frontCard = container.querySelector('[data-testid="camel-front-card"]') as HTMLElement
    expect(frontCard).not.toBeNull()
    expect(frontCard.style.border).toMatch(/^3px solid (white|#fff|rgb\(255,\s*255,\s*255\))$/)
  })
})

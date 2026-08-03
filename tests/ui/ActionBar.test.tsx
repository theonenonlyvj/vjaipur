// BUG 7 (2026-08-03): GameScreen.tsx now clamps hand/herd-camel additions so
// selHandCount can never outrun selMarketCount, but ActionBar itself is the
// last line of defense — if it's ever handed a selHandIndices longer than
// selMarketIndices anyway (a future regression, or some other caller), it
// must render a graceful message rather than a nonsensical negative need.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ActionBar } from '../../src/components/ActionBar'
import { setupRound } from '../../src/engine/setup'
import type { Card, GameState } from '../../src/engine/types'

function makeState(market: Card[], hand: Card[]): GameState {
  const base = setupRound([0, 0], undefined, () => 0)
  return {
    ...base,
    market,
    activePlayer: 0,
    players: [
      { ...base.players[0], hand },
      base.players[1],
    ],
  }
}

const noop = () => vi.fn()

describe('ActionBar exchange label — over-selected defense in depth', () => {
  it('renders "remove N" instead of a negative "need" when selHandIndices outruns selMarketIndices', () => {
    const market: Card[] = [
      { id: 1, type: 'gold' },
      { id: 2, type: 'silver' },
      { id: 3, type: 'leather' },
    ]
    const hand: Card[] = [
      { id: 10, type: 'cloth' },
      { id: 11, type: 'spice' },
      { id: 12, type: 'diamond' },
    ]
    const state = makeState(market, hand)

    render(
      <ActionBar
        state={state}
        playerIndex={0}
        selMarketIndices={[0, 1]} // needs 2
        selHandIndices={[0, 1, 2]} // over-selected: 3 hand cards
        onTakeCamels={noop()}
        onTake={noop()}
        onConfirmExchange={noop()}
        onClearSelection={noop()}
        onSell={noop()}
        onUpdateHandSelection={noop()}
      />,
    )

    expect(screen.getByText('Exchange (remove 1 more)')).toBeInTheDocument()
    expect(screen.queryByText(/need -/)).not.toBeInTheDocument()
    const btn = screen.getByText('Exchange (remove 1 more)').closest('button')
    expect(btn).toBeDisabled() // still not a confirmable exchange
  })

  it('at exact parity still renders the normal confirm label (no regression)', () => {
    const market: Card[] = [
      { id: 1, type: 'gold' },
      { id: 2, type: 'silver' },
    ]
    const hand: Card[] = [
      { id: 10, type: 'cloth' },
      { id: 11, type: 'spice' },
    ]
    const state = makeState(market, hand)

    render(
      <ActionBar
        state={state}
        playerIndex={0}
        selMarketIndices={[0, 1]}
        selHandIndices={[0, 1]}
        onTakeCamels={noop()}
        onTake={noop()}
        onConfirmExchange={noop()}
        onClearSelection={noop()}
        onSell={noop()}
        onUpdateHandSelection={noop()}
      />,
    )

    const btn = screen.getByText('Exchange 2↔2').closest('button')
    expect(btn).toBeEnabled()
  })

  it('under-selected still renders the normal positive "need" message (no regression)', () => {
    const market: Card[] = [
      { id: 1, type: 'gold' },
      { id: 2, type: 'silver' },
    ]
    const hand: Card[] = [{ id: 10, type: 'cloth' }]
    const state = makeState(market, hand)

    render(
      <ActionBar
        state={state}
        playerIndex={0}
        selMarketIndices={[0, 1]}
        selHandIndices={[0]}
        onTakeCamels={noop()}
        onTake={noop()}
        onConfirmExchange={noop()}
        onClearSelection={noop()}
        onSell={noop()}
        onUpdateHandSelection={noop()}
      />,
    )

    expect(screen.getByText('Exchange (need 1 more)')).toBeInTheDocument()
  })
})

// Regression coverage for the id-keyed selection fix in GameScreen.tsx.
//
// Root causes fixed (see the surgical fix plan for full detail):
//   Cause A — selMarket/selHand were raw array INDICES. Nothing gates
//     MarketRow/HandRow clicks on whose turn it is (intentional — pre-
//     selecting during the opponent's turn is a feature), so a pre-selected
//     index could silently re-point at a different card once the opponent's
//     move landed (compaction in takeCamels, in-place patch in takeSingle),
//     and the mismatched action would dispatch with no error.
//   Cause B — handleToggleHand's "am I mid-exchange" gate was
//     `selMarket.length < 2`, which does not exclude an all-camels market
//     selection (always length>=2). So clicking a hand card right after
//     selecting all camels wrongly fell into "exchange: just append"
//     instead of clearing the stale camel selection.
//
// The fix keys selection by stable Card.id and re-resolves ids -> indices
// every render, with a fail-safe collapse rule: a multi-card (Exchange)
// selection that loses ANY of its ids collapses entirely to empty rather
// than silently narrowing into a smaller/different action.
//
// This file is kept separate from tests/ui/GameScreen.test.tsx because its
// beforeEach seeds a randomized deal via startGame(), which would fight
// these deterministic fixtures.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { GameScreen } from '../../src/screens/GameScreen'
import { useGameStore } from '../../src/store/gameStore'
import { setupRound } from '../../src/engine/setup'
import type { Card, GameState } from '../../src/engine/types'

function makeState(market: Card[], myHand: Card[], overrides: Partial<GameState> = {}): GameState {
  const base = setupRound([0, 0], undefined, () => 0)
  return {
    ...base,
    market,
    deck: [{ id: 900, type: 'gold' }, { id: 901, type: 'leather' }, { id: 902, type: 'spice' }],
    players: [
      { ...base.players[0], hand: myHand, herd: 0 },
      { ...base.players[1], hand: [], herd: 0 },
    ],
    activePlayer: 0,
    ...overrides,
  }
}

// Adaptation note: GameScreen subscribes to the store via the plain
// `useGameStore()` hook (useSyncExternalStore under the hood). A setState
// call issued mid-test, outside a React event handler, needs to be wrapped
// in `act()` for the resulting re-render to flush synchronously before the
// next assertion — otherwise the DOM the test inspects is one render stale.
// (fireEvent already wraps its own updates in act(); this is only needed
// for our own direct store mutations that simulate "the opponent moved.")
function setState(s: GameState) {
  act(() => {
    useGameStore.setState({ state: s })
  })
}

function currentState(): GameState {
  const s = useGameStore.getState().state
  if (!s) throw new Error('expected state to be set')
  return s
}

describe('GameScreen selection — Group A: cross-turn staleness (vs-ai, myIndex fixed at 0)', () => {
  beforeEach(() => {
    useGameStore.getState().startGame('vs-ai')
  })

  it('A1: drops a market pre-selection when the opponent\'s move replaces that exact card', () => {
    const market: Card[] = [
      { id: 1, type: 'gold' },
      { id: 2, type: 'camel' },
      { id: 3, type: 'spice' },
      { id: 4, type: 'leather' },
      { id: 5, type: 'diamond' },
    ]
    setState(makeState(market, [], { activePlayer: 1 }))
    render(<MemoryRouter><GameScreen /></MemoryRouter>)

    // Pre-select while it's the opponent's turn ("Waiting for opponent…" is shown)
    fireEvent.click(screen.getAllByText('LEATHER')[0])

    // Opponent's move lands: index 3 (leather) is replaced by a new card (silver),
    // and the turn flips back to us.
    const cur = currentState()
    const newMarket = [...cur.market]
    newMarket[3] = { id: 999, type: 'silver' }
    setState({ ...cur, market: newMarket, activePlayer: 0 })

    expect(screen.queryByText(/take silver/i)).not.toBeInTheDocument()
    expect(screen.getByText('Select from Market or Hand')).toBeInTheDocument()
  })

  it('A2: does not retarget via a compacting reorder even when a same-type card lands back at the old index', () => {
    const market: Card[] = [
      { id: 11, type: 'leather' },
      { id: 12, type: 'camel' },
      { id: 13, type: 'diamond' },
      { id: 14, type: 'spice' },
      { id: 15, type: 'gold' },
    ]
    setState(makeState(market, [], { activePlayer: 1 }))
    render(<MemoryRouter><GameScreen /></MemoryRouter>)

    fireEvent.click(screen.getAllByText('DIAMOND')[0])

    // Simulate a compacting rebuild where index 2 is AGAIN a diamond, but a
    // different physical card (different id) — a naive type-only staleness
    // check would wrongly treat this as "still valid."
    const cur = currentState()
    const newMarket = [...cur.market]
    newMarket[2] = { id: 777, type: 'diamond' }
    setState({ ...cur, market: newMarket, activePlayer: 0 })

    expect(screen.queryByText(/take diamond/i)).not.toBeInTheDocument()
    expect(screen.getByText('Select from Market or Hand')).toBeInTheDocument()
  })

  it('A3: keeps a still-valid selection alive across an opponent move that doesn\'t touch it', () => {
    const market: Card[] = [
      { id: 11, type: 'leather' },
      { id: 12, type: 'camel' },
      { id: 13, type: 'diamond' },
      { id: 14, type: 'spice' },
      { id: 15, type: 'gold' },
    ]
    setState(makeState(market, [], { activePlayer: 1 }))
    render(<MemoryRouter><GameScreen /></MemoryRouter>)

    fireEvent.click(screen.getAllByText('DIAMOND')[0])

    // Opponent's move is a SELL, which per engine.ts never touches
    // state.market or the human's own player slot — only activePlayer flips.
    const cur = currentState()
    setState({ ...cur, activePlayer: 0 })

    expect(screen.getByText(/take diamond/i)).toBeInTheDocument()
  })

  it('A4: collapses a 2-good Exchange to empty, not a 1-good Take, when one selected card is taken', () => {
    const market: Card[] = [
      { id: 1, type: 'gold' },
      { id: 2, type: 'silver' },
      { id: 3, type: 'leather' },
      { id: 4, type: 'diamond' },
      { id: 5, type: 'camel' },
    ]
    const hand: Card[] = [
      { id: 10, type: 'cloth' },
      { id: 11, type: 'spice' },
    ]
    setState(makeState(market, hand, { activePlayer: 1 }))
    render(<MemoryRouter><GameScreen /></MemoryRouter>)

    // Build "Exchange 2<->2" during the opponent's turn.
    fireEvent.click(screen.getAllByText('GOLD')[0])
    fireEvent.click(screen.getAllByText('SILVER')[0])
    fireEvent.click(screen.getAllByText('CLOTH')[0])
    fireEvent.click(screen.getAllByText('SPICE')[0])

    // Opponent replaces the gold slot (index 0) with a new card.
    const cur = currentState()
    const newMarket = [...cur.market]
    newMarket[0] = { id: 999, type: 'leather' }
    setState({ ...cur, market: newMarket, activePlayer: 0 })

    expect(screen.queryByText(/take /i)).not.toBeInTheDocument()
    expect(screen.queryByText(/exchange/i)).not.toBeInTheDocument()
    expect(screen.getByText('Select from Market or Hand')).toBeInTheDocument()
  })
})

describe('GameScreen selection — Group B: same-turn ambiguity (local, activePlayer 0)', () => {
  beforeEach(() => {
    useGameStore.getState().startGame('local')
  })

  it('B1: clicking a hand card after selecting all camels drops Take Camels and reflects the hand click', () => {
    const market: Card[] = [
      { id: 1, type: 'camel' },
      { id: 2, type: 'camel' },
      { id: 3, type: 'leather' },
      { id: 4, type: 'spice' },
      { id: 5, type: 'diamond' },
    ]
    const hand: Card[] = [
      { id: 10, type: 'gold' },
      { id: 11, type: 'gold' },
    ]
    setState(makeState(market, hand, { activePlayer: 0 }))
    render(<MemoryRouter><GameScreen /></MemoryRouter>)

    fireEvent.click(screen.getAllByText('CAMEL')[0])
    expect(screen.getByText('Take Camels')).toBeInTheDocument()

    fireEvent.click(screen.getAllByText('GOLD')[0])

    expect(screen.queryByText('Take Camels')).not.toBeInTheDocument()
    expect(screen.getByText(/sell 2 gold|need \d+ gold/i)).toBeInTheDocument()
  })

  it('B2: does not reset an in-progress non-camel Exchange when extending the hand side', () => {
    const market: Card[] = [
      { id: 1, type: 'gold' },
      { id: 2, type: 'silver' },
      { id: 3, type: 'leather' },
      { id: 4, type: 'camel' },
      { id: 5, type: 'diamond' },
    ]
    const hand: Card[] = [
      { id: 10, type: 'cloth' },
      { id: 11, type: 'spice' },
    ]
    setState(makeState(market, hand, { activePlayer: 0 }))
    render(<MemoryRouter><GameScreen /></MemoryRouter>)

    fireEvent.click(screen.getAllByText('GOLD')[0])
    fireEvent.click(screen.getAllByText('SILVER')[0])
    fireEvent.click(screen.getAllByText('CLOTH')[0])
    fireEvent.click(screen.getAllByText('SPICE')[0])

    const exchangeBtn = screen.getByText('Exchange 2↔2')
    expect(exchangeBtn).toBeInTheDocument()
    expect(exchangeBtn.closest('button')).toBeEnabled()
  })

  // BUG 7 (2026-08-03): nothing clamped selHandCount to selMarketCount, so
  // over-clicking during a multi-good Exchange made ActionBar's
  // `need = selMarketCount - selHandCount` go negative ("need -1 more").
  it('B3: over-clicking hand cards during a 2-good exchange is clamped — a 3rd click is ignored, never producing a negative need', () => {
    const market: Card[] = [
      { id: 1, type: 'gold' },
      { id: 2, type: 'silver' },
      { id: 3, type: 'leather' },
      { id: 4, type: 'camel' },
      { id: 5, type: 'diamond' },
    ]
    const hand: Card[] = [
      { id: 10, type: 'cloth' },
      { id: 11, type: 'spice' },
      { id: 12, type: 'spice' },
    ]
    setState(makeState(market, hand, { activePlayer: 0 }))
    render(<MemoryRouter><GameScreen /></MemoryRouter>)

    fireEvent.click(screen.getAllByText('GOLD')[0])
    fireEvent.click(screen.getAllByText('SILVER')[0])
    fireEvent.click(screen.getAllByText('CLOTH')[0])
    fireEvent.click(screen.getAllByText('SPICE')[0])

    expect(screen.getByText('Exchange 2↔2')).toBeInTheDocument()

    // A 3rd hand click (the second spice card) must be IGNORED — still
    // 2<->2, never 2<->3, and no negative-need label ever appears.
    fireEvent.click(screen.getAllByText('SPICE')[1])

    expect(screen.getByText('Exchange 2↔2')).toBeInTheDocument()
    expect(screen.queryByText(/need -/)).not.toBeInTheDocument()
    expect(screen.queryByText(/remove/i)).not.toBeInTheDocument()
  })

  it('B4: offering herd camels during an exchange is clamped to what the market selection still needs, even with a bigger herd available', () => {
    const market: Card[] = [
      { id: 1, type: 'gold' },
      { id: 2, type: 'silver' },
      { id: 3, type: 'leather' },
      { id: 4, type: 'camel' },
      { id: 5, type: 'diamond' },
    ]
    const hand: Card[] = [{ id: 10, type: 'cloth' }]
    const base = makeState(market, hand, { activePlayer: 0 })
    setState({ ...base, players: [{ ...base.players[0], herd: 3 }, base.players[1]] })
    render(<MemoryRouter><GameScreen /></MemoryRouter>)

    fireEvent.click(screen.getAllByText('GOLD')[0])
    fireEvent.click(screen.getAllByText('SILVER')[0])

    // Exchange needs 2; offer herd camels only (no hand cards selected).
    fireEvent.click(screen.getByTestId('camel-stack')) // 1 camel offered
    fireEvent.click(screen.getByTestId('camel-stack')) // 2 camels offered -> parity
    fireEvent.click(screen.getByTestId('camel-stack')) // 3rd click ignored: herd has 3, but market only needs 2

    expect(screen.getByText('Exchange 2↔2')).toBeInTheDocument()
    expect(screen.queryByText(/need -/)).not.toBeInTheDocument()
  })
})

describe('GameScreen selection — Group C: herd-camel -1 sentinel integrity (local, activePlayer 0)', () => {
  const originalDispatch = useGameStore.getState().dispatch

  beforeEach(() => {
    useGameStore.getState().startGame('local')
  })

  afterEach(() => {
    useGameStore.setState({ dispatch: originalDispatch })
  })

  it('C1: dispatches TAKE_EXCHANGE with exactly one real -1 sentinel when a herd camel is used, never an incidental one', () => {
    const market: Card[] = [
      { id: 1, type: 'gold' },
      { id: 2, type: 'silver' },
      { id: 3, type: 'leather' },
      { id: 4, type: 'camel' },
      { id: 5, type: 'diamond' },
    ]
    const hand: Card[] = [{ id: 10, type: 'cloth' }]
    const base = makeState(market, hand, { activePlayer: 0 })
    setState({ ...base, players: [{ ...base.players[0], herd: 1 }, base.players[1]] })

    const dispatchSpy = vi.fn()
    useGameStore.setState({ dispatch: dispatchSpy })

    render(<MemoryRouter><GameScreen /></MemoryRouter>)

    fireEvent.click(screen.getAllByText('GOLD')[0])
    fireEvent.click(screen.getAllByText('SILVER')[0])
    fireEvent.click(screen.getAllByText('CLOTH')[0])
    fireEvent.click(screen.getByTestId('camel-stack'))

    const exchangeBtn = screen.getByText('Exchange 2↔2')
    fireEvent.click(exchangeBtn)

    expect(dispatchSpy).toHaveBeenCalledTimes(1)
    const call = dispatchSpy.mock.calls[0][0]
    expect(call.type).toBe('TAKE_EXCHANGE')
    expect(call.marketIndices).toEqual([0, 1])
    expect(call.handIndices.filter((i: number) => i === -1)).toHaveLength(1)
    expect(call.handIndices).toContain(0)
    expect(call.handIndices).toHaveLength(2)
  })
})

describe('camel group self-heal (2026-08-03: bot GIVES camels to the market mid-preselect)', () => {
  it('expands a preselected camel group to include camels the opponent just added', () => {
    const market: Card[] = [
      { id: 1, type: 'camel' }, { id: 2, type: 'camel' }, { id: 3, type: 'camel' },
      { id: 4, type: 'silver' }, { id: 5, type: 'cloth' },
    ]
    const state = makeState(market, [{ id: 50, type: 'diamond' }], { activePlayer: 1 })
    useGameStore.setState({ state, mode: 'vs-ai', error: null })
    render(<MemoryRouter><GameScreen /></MemoryRouter>)

    // Preselect the (3-camel) herd during the opponent's turn.
    fireEvent.click(screen.getAllByText('CAMEL')[0])

    // Opponent's exchange gives TWO more camels and takes the silver+cloth.
    const grown: Card[] = [
      { id: 1, type: 'camel' }, { id: 2, type: 'camel' }, { id: 3, type: 'camel' },
      { id: 90, type: 'camel' }, { id: 91, type: 'camel' },
    ]
    act(() => {
      useGameStore.setState({ state: { ...state, market: grown, activePlayer: 0 } })
    })

    // ALL five camels must render selected — the group followed the herd, and
    // Take Camels is offered (all-or-nothing move stays correct either way).
    const camelCards = screen.getAllByText('CAMEL')
    expect(camelCards).toHaveLength(5)
    expect(screen.getByText('Take Camels')).toBeInTheDocument()
    // CardView renders selection as a 3px solid #fff border (Card.tsx:75) on
    // an ancestor container — walk up until we find a bordered element.
    const selectedCount = camelCards.filter((el) => {
      let node: HTMLElement | null = el as HTMLElement
      for (let hops = 0; node && hops < 5; hops++) {
        if (node.style?.border?.includes('3px')) return true
        node = node.parentElement
      }
      return false
    }).length
    expect(selectedCount).toBe(5)
    expect(screen.queryByText(/need \d+ more/)).not.toBeInTheDocument()
  })
})

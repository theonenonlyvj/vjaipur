import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { RoundEndScreen } from '../../src/screens/RoundEndScreen'
import { useGameStore, viewToRenderState } from '../../src/store/gameStore'
import { setupRound } from '../../src/engine'

function makeRoundEndState() {
  return { ...setupRound([0, 0], undefined, () => 0.5), phase: 'round-end' as const }
}

/** ScoreCard renders `{n} pts` as two adjacent TEXT nodes ("n" then " pts")
 *  inside one <span> — RTL's default getByText matcher only ever compares a
 *  SINGLE text node's content, so a plain string query never matches here
 *  (its own "This could be because the text is broken up..." hint). This is
 *  RTL's documented workaround: match on the element's full textContent
 *  while requiring none of its children ALSO match (so an ancestor whose
 *  textContent happens to contain the same substring isn't picked instead). */
function withPts(n: number) {
  const want = `${n} pts`
  return (_content: string, element: Element | null) => {
    if (!element) return false
    const ownMatch = element.textContent === want
    const noChildMatch = Array.from(element.children).every((c) => c.textContent !== want)
    return ownMatch && noChildMatch
  }
}

beforeEach(() => {
  useGameStore.setState({ state: makeRoundEndState(), mode: 'local', error: null, onlineStatus: 'idle' })
})

describe('RoundEndScreen', () => {
  it('shows Player 1 and Player 2 labels', () => {
    render(<MemoryRouter><RoundEndScreen /></MemoryRouter>)
    expect(screen.getByText(/Guest|You/i)).toBeInTheDocument()
    expect(screen.getByText(/Opponent/i)).toBeInTheDocument()
  })

  it('shows a Continue button', () => {
    render(<MemoryRouter><RoundEndScreen /></MemoryRouter>)
    expect(screen.getByText(/continue/i)).toBeInTheDocument()
  })

  it('renders nothing (navigates away) when state is null', () => {
    useGameStore.setState({ state: null })
    const { container } = render(<MemoryRouter><RoundEndScreen /></MemoryRouter>)
    expect(container.textContent).toBe('')
  })
})

// FORFEIT is gone online — see GameScreen.test.tsx's equivalent note. Match
// end now routes through the normal navigation guard above.
describe('online scoring uses the server view, not a local scoreRound() replay', () => {
  it('uses onlineView.lastRoundResult for the score total instead of recomputing from placeholder opponent tokens', () => {
    // viewToRenderState's opponent tokens are zero-value placeholders — a
    // LOCAL scoreRound(state) would (wrongly) credit the opponent 0 points.
    const onlineView = {
      mySeat: 0, phase: 'round_end', round: 1, seals: [0, 0], matchLength: 3, winnerSeat: null,
      lastRoundResult: { camelWinner: 0 as const, scores: [12, 47], bonusTokenCounts: [1, 2], sealAwardedTo: 1 as const },
      players: [
        { seat: 0, displayName: 'You', ownerType: 'human' as const, controlledByAi: false },
        { seat: 1, displayName: 'Rival', ownerType: 'human' as const, controlledByAi: false },
      ],
      game: {
        market: [], myHand: [], oppHandCount: 3, herds: [1, 1] as [number, number],
        tokens: { diamond: [], gold: [], silver: [], cloth: [], spice: [], leather: [] },
        bonusTokenCounts: { three: 0, four: 0, five: 0 },
        myGoodsTokens: [], oppGoodsTokenCount: 2, myBonusTokens: [], oppBonusTokens: [],
        deckCount: 10, myScore: 12, activePlayer: 0 as const,
      },
    }
    useGameStore.setState({
      state: { ...setupRound([0, 0], undefined, () => 0.5), phase: 'round-end' as const, seals: [0, 0] },
      mode: 'online', onlineView: onlineView as any, error: null, matchLength: 3,
    })

    render(<MemoryRouter><RoundEndScreen /></MemoryRouter>)

    // The opponent's real round score (47), not 0 (what a placeholder-token
    // replay would produce).
    expect(screen.getByText('47')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
  })

  it('does not double-count the seal star online (MatchState.seals is already post-award at round_end)', () => {
    const onlineView = {
      mySeat: 0, phase: 'round_end', round: 1, seals: [0, 1], matchLength: 3, winnerSeat: null,
      // seals[1] already reflects THIS round's award — sealAwardedTo:1 must
      // NOT add another +1 on top for seat 1's star count.
      lastRoundResult: { camelWinner: null, scores: [10, 20], bonusTokenCounts: [0, 0], sealAwardedTo: 1 as const },
      players: [
        { seat: 0, displayName: 'You', ownerType: 'human' as const, controlledByAi: false },
        { seat: 1, displayName: 'Rival', ownerType: 'human' as const, controlledByAi: false },
      ],
      game: {
        market: [], myHand: [], oppHandCount: 3, herds: [1, 1] as [number, number],
        tokens: { diamond: [], gold: [], silver: [], cloth: [], spice: [], leather: [] },
        bonusTokenCounts: { three: 0, four: 0, five: 0 },
        myGoodsTokens: [], oppGoodsTokenCount: 2, myBonusTokens: [], oppBonusTokens: [],
        deckCount: 10, myScore: 10, activePlayer: 0 as const,
      },
    }
    useGameStore.setState({
      state: { ...setupRound([0, 0], undefined, () => 0.5), phase: 'round-end' as const, seals: [0, 1] },
      mode: 'online', onlineView: onlineView as any, error: null, matchLength: 3,
    })

    render(<MemoryRouter><RoundEndScreen /></MemoryRouter>)

    // totalSeals for matchLength 3 is 2 (floor(3/2)+1) — seat 1 should show
    // exactly ★☆ (1 filled of 2), not ★★ (which double-counting would give).
    const stars = screen.getAllByText('★☆')
    expect(stars.length).toBeGreaterThan(0)
    expect(screen.queryByText('★★')).not.toBeInTheDocument()
  })
})

// BUG 1 fix (2026-07-27): the round-end screen was showing a FAKE opponent
// bonus breakdown ("Bonuses (2) 0 pts") because ScoreCard always summed
// playerState.bonusTokens — which, for a redacted opponent, are value-0
// tier-only placeholders even at round end (individual bonus VALUES must
// stay hidden — see worker/src/do/view.ts's lastRoundReveal docstring).
// ScoreCard's new bonusPointsOverride prop lets RoundEndScreen substitute the
// server-revealed SUM for the opponent's card only.
describe('ScoreCard bonusPointsOverride wiring (BUG 1 — opponent bonus reveal)', () => {
  it('shows the server-revealed bonus SUM for the opponent card, and leaves the self card summing its own real tokens', () => {
    const onlineView = {
      mySeat: 0, phase: 'round_end', round: 1, seals: [0, 0], matchLength: 3, winnerSeat: null,
      lastRoundResult: { camelWinner: null, scores: [14, 40], bonusTokenCounts: [1, 2], sealAwardedTo: 1 as const },
      // Deliberately a wrong/obviously-distinguishable value at index 0 (my
      // own seat) — if RoundEndScreen ever mistakenly overrode the SELF
      // card too, this test would catch it showing "999 pts" instead of the
      // real "4 pts" summed from myBonusTokens.
      lastRoundReveal: { goodsTokens: [[], []], bonusPoints: [999, 15] },
      players: [
        { seat: 0, displayName: 'You', ownerType: 'human' as const, controlledByAi: false },
        { seat: 1, displayName: 'Rival', ownerType: 'human' as const, controlledByAi: false },
      ],
      game: {
        market: [], myHand: [], oppHandCount: 3, herds: [1, 1] as [number, number],
        tokens: { diamond: [], gold: [], silver: [], cloth: [], spice: [], leather: [] },
        bonusTokenCounts: { three: 0, four: 0, five: 0 },
        myGoodsTokens: [], oppGoodsTokenCount: 2,
        myBonusTokens: [{ tier: 3, value: 4 }],
        // Redacted placeholders — tier-only, value 0 — same as any mid-round
        // opponent view; the reveal must override the DISPLAYED sum without
        // this array itself ever carrying real values.
        oppBonusTokens: [{ tier: 4 }, { tier: 3 }],
        deckCount: 10, myScore: 4, activePlayer: 0 as const,
      },
    }
    useGameStore.setState({
      // viewToRenderState — the SAME projection applyServerView uses in real
      // online play — so the fixture's game.myBonusTokens/oppBonusTokens
      // (and the lastRoundReveal-aware opponent goods) actually reach the
      // rendered ScoreCards, not a disconnected fresh local round.
      state: viewToRenderState(onlineView as any),
      mode: 'online', onlineView: onlineView as any, onlinePlayerIndex: 0, error: null, matchLength: 3,
    })

    render(<MemoryRouter><RoundEndScreen /></MemoryRouter>)

    // Opponent (seat 1): the revealed sum, not the placeholder-derived 0.
    expect(screen.getByText(withPts(15))).toBeInTheDocument()
    // Self (seat 0): its own real bonusTokens sum, NOT the reveal's [0] slot.
    expect(screen.getByText(withPts(4))).toBeInTheDocument()
    expect(screen.queryByText(withPts(999))).not.toBeInTheDocument()
  })

  it('falls back to the placeholder sum (0) for the opponent when lastRoundReveal is absent (older server during deploy skew)', () => {
    const onlineView = {
      mySeat: 0, phase: 'round_end', round: 1, seals: [0, 0], matchLength: 3, winnerSeat: null,
      lastRoundResult: { camelWinner: null, scores: [4, 0], bonusTokenCounts: [1, 2], sealAwardedTo: 0 as const },
      lastRoundReveal: null,
      players: [
        { seat: 0, displayName: 'You', ownerType: 'human' as const, controlledByAi: false },
        { seat: 1, displayName: 'Rival', ownerType: 'human' as const, controlledByAi: false },
      ],
      game: {
        market: [], myHand: [], oppHandCount: 3, herds: [1, 1] as [number, number],
        tokens: { diamond: [], gold: [], silver: [], cloth: [], spice: [], leather: [] },
        bonusTokenCounts: { three: 0, four: 0, five: 0 },
        // Self goods nonzero so its "pts" text is unambiguous against the
        // placeholder opponent goods/bonus rows, both of which render "0
        // pts" (two rows on the SAME card — see the getAllByText below).
        myGoodsTokens: [{ good: 'spice', value: 9 }], oppGoodsTokenCount: 2,
        myBonusTokens: [{ tier: 3, value: 4 }],
        oppBonusTokens: [{ tier: 4 }, { tier: 3 }],
        deckCount: 10, myScore: 13, activePlayer: 0 as const,
      },
    }
    useGameStore.setState({
      state: viewToRenderState(onlineView as any),
      mode: 'online', onlineView: onlineView as any, onlinePlayerIndex: 0, error: null, matchLength: 3,
    })

    render(<MemoryRouter><RoundEndScreen /></MemoryRouter>)

    // Self's real totals render as before.
    expect(screen.getByText(withPts(9))).toBeInTheDocument()
    expect(screen.getByText(withPts(4))).toBeInTheDocument()
    // Opponent's goods AND bonus rows both fall back to the placeholder "0
    // pts" (no reveal to draw from) — current pre-fix behavior preserved.
    expect(screen.getAllByText(withPts(0)).length).toBe(2)
  })
})

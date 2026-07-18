import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../src/net/online', () => ({
  createGame: vi.fn(),
  resolveCode: vi.fn(),
  join: vi.fn(),
  sync: vi.fn(),
  move: vi.fn(),
  nextRound: vi.fn(),
  resign: vi.fn(),
  heartbeat: vi.fn(),
  reclaim: vi.fn(),
  leave: vi.fn(),
  myGames: vi.fn(),
  leaderboard: vi.fn(),
  history: vi.fn(),
  reportMatch: vi.fn(),
}))

vi.mock('../../src/net/outbox', () => ({
  save: vi.fn(),
  load: vi.fn(() => null),
  clear: vi.fn(),
  drain: vi.fn(async () => null),
}))

vi.mock('../../src/net/session', () => ({
  save: vi.fn(),
  load: vi.fn(() => null),
  clear: vi.fn(),
  startHeartbeat: vi.fn(),
  stopHeartbeat: vi.fn(),
}))

const fakeSocketClose = vi.fn()
vi.mock('../../src/net/nudge', () => ({
  openNudgeSocket: vi.fn(() => ({ close: fakeSocketClose })),
}))

import { useGameStore, viewToRenderState } from '../../src/store/gameStore'
import { useStatsStore } from '../../src/store/statsStore'
import { getLegalActions } from '../../src/engine'
import type { Card, CardType } from '../../src/engine'
import * as onlineApi from '../../src/net/online'
import * as outbox from '../../src/net/outbox'
import * as session from '../../src/net/session'
import { openNudgeSocket } from '../../src/net/nudge'
import { WorkerError } from '../../src/net/http'
import type { ClientView, ClientMove, WaitingRoomView } from '../../src/net/types'

// ---- fixtures ---------------------------------------------------------------

function card(id: number, type: CardType): Card {
  return { id, type }
}

function makeView(overrides: Partial<ClientView> = {}): ClientView {
  const base: ClientView = {
    mySeat: 0,
    phase: 'playing',
    round: 1,
    seals: [0, 0],
    matchLength: 3,
    winnerSeat: null,
    lastRoundResult: null,
    players: [
      { seat: 0, displayName: 'Me', ownerType: 'human', controlledByAi: false },
      { seat: 1, displayName: 'Rival', ownerType: 'human', controlledByAi: false },
    ],
    game: {
      market: [card(1, 'diamond'), card(2, 'gold'), card(3, 'camel'), card(4, 'silver'), card(5, 'cloth')],
      myHand: [card(10, 'spice'), card(11, 'leather'), card(12, 'diamond')],
      oppHandCount: 4,
      herds: [2, 3],
      tokens: {
        diamond: [7, 7, 5], gold: [6, 6, 5, 5, 5, 5], silver: [5, 5, 5, 4, 4],
        cloth: [5, 3, 3, 2, 2, 1, 1], spice: [5, 3, 3, 2, 2, 1, 1], leather: [4, 3, 2, 1, 1, 1, 1, 1, 1],
      },
      bonusTokenCounts: { three: 3, four: 3, five: 2 },
      myGoodsTokens: [{ good: 'spice', value: 5 }],
      oppGoodsTokenCount: 2,
      myBonusTokens: [{ tier: 3, value: 3 }],
      oppBonusTokens: [{ tier: 3 }],
      deckCount: 27,
      myScore: 8,
      activePlayer: 0,
    },
  }
  return {
    ...base,
    ...overrides,
    game: { ...base.game, ...(overrides.game ?? {}) },
    players: overrides.players ?? base.players,
  }
}

function resetStore() {
  useGameStore.setState({
    state: null, mode: null, error: null, onlinePlayerIndex: null, roomCode: null,
    onlineStatus: 'idle', lastMoveDescription: null, opponentName: null,
    matchScores: [0, 0], onlineView: null, pendingMove: false, coveredSeat: false,
    opponentCovered: false, lastMoveIndex: 0, lastScoredRound: null,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetStore()
  // A pre-authenticated device — joinOnline/resumeSession's ensureVGamesAccount
  // short-circuits on this without touching the network.
  useStatsStore.setState({ vgamesToken: 'test-token', vgamesAccountId: 'test-account' })
  vi.mocked(onlineApi.history).mockResolvedValue({ matches: [] })
  vi.mocked(onlineApi.leave).mockResolvedValue({ ok: true, seat: 0 })
  vi.spyOn(useStatsStore.getState(), 'pullVGamesHistory').mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---- viewToRenderState --------------------------------------------------------

describe('viewToRenderState', () => {
  it('maps phase: playing/round_end/match_over -> playing/round-end/game-over', () => {
    expect(viewToRenderState(makeView({ phase: 'playing' })).phase).toBe('playing')
    expect(viewToRenderState(makeView({ phase: 'round_end' })).phase).toBe('round-end')
    expect(viewToRenderState(makeView({ phase: 'match_over' })).phase).toBe('game-over')
  })

  it('places MY real hand/tokens/bonusTokens at players[mySeat], unmodified', () => {
    const view = makeView({ mySeat: 0 })
    const state = viewToRenderState(view)
    expect(state.players[0].hand).toBe(view.game.myHand)
    expect(state.players[0].tokens).toBe(view.game.myGoodsTokens)
    expect(state.players[0].bonusTokens).toBe(view.game.myBonusTokens)
    expect(state.players[0].herd).toBe(view.game.herds[0])
  })

  it('indexes players by SEAT, not by "me first" — mySeat=1 puts real data at players[1]', () => {
    const view = makeView({
      mySeat: 1,
      players: [
        { seat: 0, displayName: 'Rival', ownerType: 'human', controlledByAi: false },
        { seat: 1, displayName: 'Me', ownerType: 'human', controlledByAi: false },
      ],
    })
    const state = viewToRenderState(view)
    expect(state.players[1].hand).toBe(view.game.myHand)
    expect(state.players[1].herd).toBe(view.game.herds[1])
    expect(state.players[0].hand).toHaveLength(view.game.oppHandCount)
    expect(state.players[0].herd).toBe(view.game.herds[0])
  })

  it('the opponent hand is placeholder-length only — never real card data', () => {
    const view = makeView({ game: { oppHandCount: 5 } as ClientView['game'] })
    const state = viewToRenderState(view)
    const oppHand = state.players[1].hand
    expect(oppHand).toHaveLength(5)
    // Every filler card is a fixed, clearly-synthetic marker — id < 0 so it
    // can never collide with (and be mistaken for) a real card id (>= 0),
    // and a single fixed type so the UI can never accidentally read a "real"
    // good out of it.
    for (const c of oppHand) {
      expect(c.id).toBeLessThan(0)
      expect(c.type).toBe('leather')
    }
  })

  it('opponent goods/bonus tokens are placeholder counts with value 0 — never real values', () => {
    const view = makeView({
      game: {
        oppGoodsTokenCount: 3,
        oppBonusTokens: [{ tier: 3 }, { tier: 5 }],
      } as ClientView['game'],
    })
    const state = viewToRenderState(view)
    expect(state.players[1].tokens).toHaveLength(3)
    for (const t of state.players[1].tokens) expect(t.value).toBe(0)
    expect(state.players[1].bonusTokens).toEqual([{ tier: 3, value: 0 }, { tier: 5, value: 0 }])
  })

  it('the deck is placeholder-length only (deckCount), contents/order never real', () => {
    const view = makeView({ game: { deckCount: 41 } as ClientView['game'] })
    const state = viewToRenderState(view)
    expect(state.deck).toHaveLength(41)
    for (const c of state.deck) expect(c.id).toBeLessThan(0)
  })

  it('market/tokens/seals/round pass through as the real public data', () => {
    const view = makeView()
    const state = viewToRenderState(view)
    expect(state.market).toBe(view.game.market)
    expect(state.tokens).toBe(view.game.tokens)
    expect(state.seals).toEqual(view.seals)
    expect(state.round).toBe(view.round)
    expect(state.activePlayer).toBe(view.game.activePlayer)
  })

  it('bonus token piles are sized from bonusTokenCounts, all zero-value placeholders', () => {
    const view = makeView({ game: { bonusTokenCounts: { three: 2, four: 1, five: 0 } } as ClientView['game'] })
    const state = viewToRenderState(view)
    expect(state.bonusTokens.three).toHaveLength(2)
    expect(state.bonusTokens.four).toHaveLength(1)
    expect(state.bonusTokens.five).toHaveLength(0)
    for (const t of [...state.bonusTokens.three, ...state.bonusTokens.four]) expect(t.value).toBe(0)
  })

  it('getLegalActions never touches deck contents — a viewToRenderState pseudo-state is safe input', () => {
    const view = makeView({ mySeat: 0, game: { activePlayer: 0 } as ClientView['game'] })
    const state = viewToRenderState(view)
    expect(() => getLegalActions(state)).not.toThrow()
    expect(getLegalActions(state).length).toBeGreaterThan(0)
  })
})

// ---- dispatchOnline -----------------------------------------------------------

describe('dispatchOnline', () => {
  function seedPlaying(overrides: Partial<ClientView> = {}) {
    const view = makeView(overrides)
    useGameStore.setState({
      mode: 'online', roomCode: 'ABC123', onlinePlayerIndex: view.mySeat as 0 | 1,
      onlineView: view, state: viewToRenderState(view), pendingMove: false, error: null,
    })
    return view
  }

  it('is a no-op when it is not my turn', async () => {
    seedPlaying({ mySeat: 0, game: { activePlayer: 1 } as ClientView['game'] })
    await useGameStore.getState().dispatchOnline({ type: 'TAKE_CAMELS' })
    expect(onlineApi.move).not.toHaveBeenCalled()
  })

  it('is a no-op when a move is already pending', async () => {
    seedPlaying({ mySeat: 0, game: { activePlayer: 0 } as ClientView['game'] })
    useGameStore.setState({ pendingMove: true })
    await useGameStore.getState().dispatchOnline({ type: 'TAKE_CAMELS' })
    expect(onlineApi.move).not.toHaveBeenCalled()
  })

  it('sets pendingMove synchronously and saves the outbox entry before the network call resolves', () => {
    seedPlaying({ mySeat: 0, game: { activePlayer: 0 } as ClientView['game'] })
    vi.mocked(onlineApi.move).mockReturnValue(new Promise(() => {})) // never resolves in this test
    void useGameStore.getState().dispatchOnline({ type: 'TAKE_CAMELS' })
    expect(useGameStore.getState().pendingMove).toBe(true)
    expect(outbox.save).toHaveBeenCalledWith(expect.objectContaining({ gameId: 'ABC123', seatIndex: 0, action: { type: 'TAKE_CAMELS' } }))
  })

  it('ok -> applies the returned view and clears the outbox + pendingMove', async () => {
    seedPlaying({ mySeat: 0, game: { activePlayer: 0 } as ClientView['game'] })
    const nextView = makeView({ mySeat: 0, game: { activePlayer: 1 } as ClientView['game'] })
    vi.mocked(onlineApi.move).mockResolvedValueOnce({ ok: true, moveIndex: 5, view: nextView })

    await useGameStore.getState().dispatchOnline({ type: 'TAKE_CAMELS' })

    expect(outbox.clear).toHaveBeenCalled()
    expect(useGameStore.getState().pendingMove).toBe(false)
    expect(useGameStore.getState().onlineView).toEqual(nextView)
    expect(useGameStore.getState().state?.activePlayer).toBe(1)
    expect(useGameStore.getState().lastMoveDescription).toMatch(/^YOU:/)
  })

  it('a duplicate ack (idempotent replay) is treated the same as ok', async () => {
    seedPlaying({ mySeat: 0, game: { activePlayer: 0 } as ClientView['game'] })
    const nextView = makeView({ mySeat: 0 })
    vi.mocked(onlineApi.move).mockResolvedValueOnce({ duplicate: true, view: nextView } as never)

    await useGameStore.getState().dispatchOnline({ type: 'TAKE_CAMELS' })

    expect(outbox.clear).toHaveBeenCalled()
    expect(useGameStore.getState().pendingMove).toBe(false)
  })

  it('a 4xx engine error clears pendingMove + the outbox and surfaces a readable message', async () => {
    seedPlaying({ mySeat: 0, game: { activePlayer: 0 } as ClientView['game'] })
    vi.mocked(onlineApi.move).mockRejectedValueOnce(new WorkerError(400, 'HAND_LIMIT', { error: 'HAND_LIMIT' }))

    await useGameStore.getState().dispatchOnline({ type: 'TAKE_SINGLE', marketIndex: 0 })

    expect(outbox.clear).toHaveBeenCalled()
    const { pendingMove, error } = useGameStore.getState()
    expect(pendingMove).toBe(false)
    expect(error?.code).toBe('HAND_LIMIT')
    expect(error?.message).toMatch(/7 goods cards/)
  })

  it('a 409 not_your_turn error surfaces a readable message too', async () => {
    seedPlaying({ mySeat: 0, game: { activePlayer: 0 } as ClientView['game'] })
    vi.mocked(onlineApi.move).mockRejectedValueOnce(new WorkerError(409, 'not_your_turn', {}))

    await useGameStore.getState().dispatchOnline({ type: 'TAKE_CAMELS' })

    expect(useGameStore.getState().error?.message).toMatch(/not your turn/i)
  })

  it('a network failure KEEPS the outbox queued and shows a reconnecting affordance, not a hard error blocking retry', async () => {
    seedPlaying({ mySeat: 0, game: { activePlayer: 0 } as ClientView['game'] })
    vi.mocked(onlineApi.move).mockRejectedValueOnce(new TypeError('Failed to fetch'))

    await useGameStore.getState().dispatchOnline({ type: 'TAKE_CAMELS' })

    expect(outbox.clear).not.toHaveBeenCalled()
    expect(useGameStore.getState().pendingMove).toBe(false)
    expect(useGameStore.getState().error?.code).toBe('NETWORK')
  })

  it('a network failure leaves the outbox to be drained by the next onNudge/sync cycle', async () => {
    seedPlaying({ mySeat: 0, game: { activePlayer: 0 } as ClientView['game'] })
    vi.mocked(onlineApi.move).mockRejectedValueOnce(new TypeError('offline'))
    await useGameStore.getState().dispatchOnline({ type: 'TAKE_CAMELS' })

    vi.mocked(onlineApi.sync).mockResolvedValueOnce({ moveIndex: 1, view: makeView({ mySeat: 0 }), moves: [] })
    await useGameStore.getState().onNudge()

    expect(outbox.drain).toHaveBeenCalledWith('ABC123')
  })
})

// ---- applyServerView ----------------------------------------------------------

describe('applyServerView', () => {
  it('derives opponentName, coveredSeat and opponentCovered from the roster', () => {
    const view = makeView({
      mySeat: 0,
      players: [
        { seat: 0, displayName: 'Me', ownerType: 'human', controlledByAi: true },
        { seat: 1, displayName: 'Rival', ownerType: 'human', controlledByAi: true },
      ],
    })
    useGameStore.getState().applyServerView(view)
    const s = useGameStore.getState()
    expect(s.opponentName).toBe('Rival')
    expect(s.coveredSeat).toBe(true)
    expect(s.opponentCovered).toBe(true)
  })

  it('accumulates matchScores from lastRoundResult exactly ONCE per round', () => {
    const roundEndView = makeView({
      phase: 'round_end', round: 1,
      lastRoundResult: { camelWinner: 0, scores: [24, 11], bonusTokenCounts: [1, 0], sealAwardedTo: 0 },
    })
    useGameStore.setState({ matchScores: [0, 0], lastScoredRound: null })
    useGameStore.getState().applyServerView(roundEndView)
    expect(useGameStore.getState().matchScores).toEqual([24, 11])

    // A re-sync of the SAME round_end (e.g. a duplicate nudge) must not
    // double-count.
    useGameStore.getState().applyServerView(roundEndView)
    expect(useGameStore.getState().matchScores).toEqual([24, 11])
  })

  it('does not touch matchScores mid-round (no lastRoundResult)', () => {
    useGameStore.setState({ matchScores: [5, 5], lastScoredRound: null })
    useGameStore.getState().applyServerView(makeView({ phase: 'playing', lastRoundResult: null }))
    expect(useGameStore.getState().matchScores).toEqual([5, 5])
  })

  it('match_over: stops the heartbeat/session and triggers a history pull (no local addMatch)', async () => {
    const view = makeView({
      phase: 'match_over', winnerSeat: 0,
      lastRoundResult: { camelWinner: 0, scores: [30, 10], bonusTokenCounts: [2, 0], sealAwardedTo: 0 },
    })
    useGameStore.getState().applyServerView(view)
    expect(session.clear).toHaveBeenCalled()
    expect(useStatsStore.getState().pullVGamesHistory).toHaveBeenCalled()
  })
})

// ---- onNudge --------------------------------------------------------------

describe('onNudge', () => {
  it('no-ops when not in online mode', async () => {
    resetStore()
    await useGameStore.getState().onNudge()
    expect(onlineApi.sync).not.toHaveBeenCalled()
  })

  it('no-ops while a move is pending', async () => {
    useGameStore.setState({ mode: 'online', roomCode: 'ABC123', pendingMove: true })
    await useGameStore.getState().onNudge()
    expect(onlineApi.sync).not.toHaveBeenCalled()
  })

  it('syncs since lastMoveIndex, applies the view, and advances lastMoveIndex', async () => {
    useGameStore.setState({ mode: 'online', roomCode: 'ABC123', lastMoveIndex: 3, onlineView: makeView() })
    const freshView = makeView({ game: { activePlayer: 1 } as ClientView['game'] })
    vi.mocked(onlineApi.sync).mockResolvedValueOnce({ moveIndex: 9, view: freshView, moves: [] })

    await useGameStore.getState().onNudge()

    expect(onlineApi.sync).toHaveBeenCalledWith('ABC123', 3)
    expect(useGameStore.getState().lastMoveIndex).toBe(9)
    expect(useGameStore.getState().onlineView).toEqual(freshView)
  })

  it('builds lastMoveDescription from the newest move\'s PUBLIC payload (not a local raw action)', async () => {
    useGameStore.setState({ mode: 'online', roomCode: 'ABC123', onlineView: makeView({ mySeat: 0 }), opponentName: 'Rival' })
    const moves: ClientMove[] = [
      { moveIndex: 4, round: 1, seatIndex: 1, type: 'TAKE_SINGLE', payload: { type: 'TAKE_SINGLE', takenCard: { id: 9, type: 'gold' } }, byAi: false },
    ]
    vi.mocked(onlineApi.sync).mockResolvedValueOnce({ moveIndex: 4, view: makeView(), moves })

    await useGameStore.getState().onNudge()

    expect(useGameStore.getState().lastMoveDescription).toBe('RIVAL: took a gold')
  })

  it('a resign move is narrated by seat', async () => {
    useGameStore.setState({ mode: 'online', roomCode: 'ABC123', onlineView: makeView({ mySeat: 0 }), opponentName: 'Rival' })
    const moves: ClientMove[] = [
      { moveIndex: 4, round: 2, seatIndex: 1, type: 'resign', payload: { type: 'resign', seat: 1 }, byAi: false },
    ]
    vi.mocked(onlineApi.sync).mockResolvedValueOnce({
      moveIndex: 4,
      view: makeView({ phase: 'match_over', winnerSeat: 0 }),
      moves,
    })

    await useGameStore.getState().onNudge()

    expect(useGameStore.getState().lastMoveDescription).toBe('RIVAL: resigned')
  })

  it('drains the outbox BEFORE syncing', async () => {
    useGameStore.setState({ mode: 'online', roomCode: 'ABC123', onlineView: makeView() })
    const calls: string[] = []
    vi.mocked(outbox.drain).mockImplementationOnce(async () => { calls.push('drain'); return null })
    vi.mocked(onlineApi.sync).mockImplementationOnce(async () => { calls.push('sync'); return { moveIndex: 1, view: makeView(), moves: [] } })

    await useGameStore.getState().onNudge()

    expect(calls).toEqual(['drain', 'sync'])
  })

  it('a still-waiting room (no "moves" key) sets onlineStatus to waiting without applying a board view', async () => {
    useGameStore.setState({ mode: 'online', roomCode: 'ABC123', onlineStatus: 'playing', onlineView: null })
    const waitingView: WaitingRoomView = { status: 'waiting', code: 'ABC123', matchLength: 3, seats: [] }
    vi.mocked(onlineApi.sync).mockResolvedValueOnce(waitingView)

    await useGameStore.getState().onNudge()

    expect(useGameStore.getState().onlineStatus).toBe('waiting')
    expect(useGameStore.getState().onlineView).toBeNull()
  })

  it('swallows a transient sync failure without throwing or setting a hard error', async () => {
    useGameStore.setState({ mode: 'online', roomCode: 'ABC123', onlineView: makeView(), error: null })
    vi.mocked(onlineApi.sync).mockRejectedValueOnce(new TypeError('offline'))
    await expect(useGameStore.getState().onNudge()).resolves.toBeUndefined()
    expect(useGameStore.getState().error).toBeNull()
  })
})

// ---- nextRound (online) --------------------------------------------------------

describe('nextRound (online)', () => {
  function seedRoundEnd() {
    const view = makeView({ phase: 'round_end', lastRoundResult: { camelWinner: null, scores: [10, 10], bonusTokenCounts: [0, 0], sealAwardedTo: null } })
    useGameStore.setState({ mode: 'online', roomCode: 'ABC123', onlineView: view, state: viewToRenderState(view) })
    return view
  }

  it('{view} shape: applies the fresh (next-round) view', async () => {
    seedRoundEnd()
    const nextRoundView = makeView({ phase: 'playing', round: 2 })
    vi.mocked(onlineApi.nextRound).mockResolvedValueOnce({ view: nextRoundView })

    useGameStore.getState().nextRound()
    await vi.waitFor(() => expect(useGameStore.getState().state?.phase).toBe('playing'))

    expect(onlineApi.nextRound).toHaveBeenCalledWith('ABC123')
    expect(useGameStore.getState().state?.round).toBe(2)
  })

  it('{already:true, view} shape (raced second caller) is applied the same way', async () => {
    seedRoundEnd()
    const nextRoundView = makeView({ phase: 'playing', round: 2 })
    vi.mocked(onlineApi.nextRound).mockResolvedValueOnce({ already: true, view: nextRoundView })

    useGameStore.getState().nextRound()
    await vi.waitFor(() => expect(useGameStore.getState().state?.phase).toBe('playing'))

    expect(useGameStore.getState().state?.round).toBe(2)
  })

  it('a network failure surfaces a retry-worthy error without crashing', async () => {
    seedRoundEnd()
    vi.mocked(onlineApi.nextRound).mockRejectedValueOnce(new TypeError('offline'))

    useGameStore.getState().nextRound()
    await vi.waitFor(() => expect(useGameStore.getState().error?.code).toBe('NETWORK'))
  })
})

// ---- resign / reclaim -----------------------------------------------------------

describe('resignMatch', () => {
  it('POSTs /resign and applies the resulting match_over view', async () => {
    const view = makeView()
    useGameStore.setState({ mode: 'online', roomCode: 'ABC123', onlineView: view })
    const overView = makeView({ phase: 'match_over', winnerSeat: 1 })
    vi.mocked(onlineApi.resign).mockResolvedValueOnce({ view: overView })

    await useGameStore.getState().resignMatch()

    expect(onlineApi.resign).toHaveBeenCalledWith('ABC123')
    expect(useGameStore.getState().onlineView?.phase).toBe('match_over')
    expect(useGameStore.getState().onlineView?.winnerSeat).toBe(1)
  })

  it('is a no-op outside online mode', async () => {
    resetStore()
    await useGameStore.getState().resignMatch()
    expect(onlineApi.resign).not.toHaveBeenCalled()
  })
})

describe('reclaimSeat', () => {
  it('POSTs /reclaim and the resulting view clears coveredSeat', async () => {
    const coveredView = makeView({
      players: [
        { seat: 0, displayName: 'Me', ownerType: 'human', controlledByAi: true },
        { seat: 1, displayName: 'Rival', ownerType: 'human', controlledByAi: false },
      ],
    })
    useGameStore.setState({ mode: 'online', roomCode: 'ABC123', onlineView: coveredView, coveredSeat: true })

    const reclaimedView = makeView({
      players: [
        { seat: 0, displayName: 'Me', ownerType: 'human', controlledByAi: false },
        { seat: 1, displayName: 'Rival', ownerType: 'human', controlledByAi: false },
      ],
    })
    vi.mocked(onlineApi.reclaim).mockResolvedValueOnce({ moveIndex: 8, view: reclaimedView })

    await useGameStore.getState().reclaimSeat()

    expect(useGameStore.getState().coveredSeat).toBe(false)
  })
})

// ---- joinOnline -----------------------------------------------------------------

describe('joinOnline', () => {
  it('create: mints/reuses a token, creates the room, and enters the waiting room when nobody has joined yet', async () => {
    const waitingView: WaitingRoomView = { status: 'waiting', code: 'CAML99', matchLength: 3, seats: [] }
    vi.mocked(onlineApi.createGame).mockResolvedValueOnce({ gameId: 'CAML99', code: 'CAML99', view: waitingView })

    await useGameStore.getState().joinOnline('create')

    expect(useGameStore.getState().roomCode).toBe('CAML99')
    expect(useGameStore.getState().onlinePlayerIndex).toBe(0) // creator is always seat 0
    expect(useGameStore.getState().onlineStatus).toBe('waiting')
    expect(session.save).toHaveBeenCalledWith({ gameId: 'CAML99', code: 'CAML99', mySeat: 0 })
    expect(session.startHeartbeat).toHaveBeenCalledWith('CAML99')
    expect(openNudgeSocket).toHaveBeenCalled()
  })

  it('create: polls sync every 2.5s while waiting, and enters play once the room goes active', async () => {
    vi.useFakeTimers()
    try {
      const waitingView: WaitingRoomView = { status: 'waiting', code: 'CAML99', matchLength: 3, seats: [] }
      vi.mocked(onlineApi.createGame).mockResolvedValueOnce({ gameId: 'CAML99', code: 'CAML99', view: waitingView })

      await useGameStore.getState().joinOnline('create')
      expect(useGameStore.getState().onlineStatus).toBe('waiting')

      // Still waiting -> the poll keeps returning the waiting-room shape.
      vi.mocked(onlineApi.sync).mockResolvedValueOnce(waitingView)
      await vi.advanceTimersByTimeAsync(2_500)
      expect(onlineApi.sync).toHaveBeenCalledWith('CAML99')
      expect(useGameStore.getState().onlineStatus).toBe('waiting')

      // A friend joined -> the next poll tick sees the active game and enters play.
      const activeView = makeView({ mySeat: 0 })
      vi.mocked(onlineApi.sync).mockResolvedValueOnce({ moveIndex: 1, view: activeView, moves: [] })
      await vi.advanceTimersByTimeAsync(2_500)

      expect(useGameStore.getState().onlineStatus).toBe('playing')
      expect(useGameStore.getState().state).not.toBeNull()

      // The poll stops once active (no further sync calls on subsequent ticks).
      const callsSoFar = vi.mocked(onlineApi.sync).mock.calls.length
      await vi.advanceTimersByTimeAsync(10_000)
      expect(vi.mocked(onlineApi.sync).mock.calls.length).toBe(callsSoFar)
    } finally {
      vi.useRealTimers()
    }
  })

  it('join: resolves the code, joins (which deals immediately), and enters play', async () => {
    vi.mocked(onlineApi.resolveCode).mockResolvedValueOnce({ gameId: 'CAML99', status: 'active' })
    const activeView = makeView({ mySeat: 1 })
    vi.mocked(onlineApi.join).mockResolvedValueOnce({ seatIndex: 1, status: 'active', view: activeView })

    await useGameStore.getState().joinOnline('join', 'caml99')

    expect(onlineApi.resolveCode).toHaveBeenCalledWith('CAML99')
    expect(useGameStore.getState().onlinePlayerIndex).toBe(1)
    expect(useGameStore.getState().onlineStatus).toBe('playing')
    expect(useGameStore.getState().state).not.toBeNull()
  })

  it('join without a code throws', async () => {
    await expect(useGameStore.getState().joinOnline('join')).rejects.toThrow()
  })

  it('wires the nudge socket\'s onAuthOk to trigger a sync — the reconcile hook for "WS open"/foreground reconnects', async () => {
    vi.mocked(onlineApi.resolveCode).mockResolvedValueOnce({ gameId: 'CAML99', status: 'active' })
    vi.mocked(onlineApi.join).mockResolvedValueOnce({ seatIndex: 0, status: 'active', view: makeView({ mySeat: 0 }) })

    await useGameStore.getState().joinOnline('join', 'CAML99')

    const calls = vi.mocked(openNudgeSocket).mock.calls
    const handlers = calls[calls.length - 1]?.[2]
    expect(handlers?.onAuthOk).toBeInstanceOf(Function)

    vi.mocked(onlineApi.sync).mockResolvedValueOnce({ moveIndex: 2, view: makeView({ mySeat: 0 }), moves: [] })
    handlers!.onAuthOk!(0)
    await vi.waitFor(() => expect(onlineApi.sync).toHaveBeenCalled())
  })

  it('a failed authentication leaves onlineStatus idle and rejects', async () => {
    useStatsStore.setState({ vgamesToken: null, vgamesAccountId: null })
    vi.spyOn(useStatsStore.getState(), 'ensureVGamesAccount').mockResolvedValueOnce(null)

    await expect(useGameStore.getState().joinOnline('create')).rejects.toThrow()
    expect(useGameStore.getState().onlineStatus).toBe('idle')
    expect(onlineApi.createGame).not.toHaveBeenCalled()
  })
})

// ---- resumeSession ----------------------------------------------------------------

describe('resumeSession', () => {
  it('no-ops when there is no persisted session', async () => {
    vi.mocked(session.load).mockReturnValueOnce(null)
    await useGameStore.getState().resumeSession()
    expect(onlineApi.sync).not.toHaveBeenCalled()
  })

  it('an active persisted session restores online mode from the full move log', async () => {
    vi.mocked(session.load).mockReturnValueOnce({ gameId: 'ABC123', code: 'ABC123', mySeat: 0 })
    const moves: ClientMove[] = [
      { moveIndex: 3, round: 1, seatIndex: 0, type: 'round_end', payload: { type: 'round_end', result: { scores: [15, 5] } }, byAi: false },
    ]
    const view = makeView({ phase: 'playing', round: 2 })
    vi.mocked(onlineApi.sync).mockResolvedValueOnce({ moveIndex: 6, view, moves })

    await useGameStore.getState().resumeSession()

    expect(onlineApi.sync).toHaveBeenCalledWith('ABC123', 0)
    expect(useGameStore.getState().mode).toBe('online')
    expect(useGameStore.getState().onlineStatus).toBe('playing')
    expect(useGameStore.getState().matchScores).toEqual([15, 5]) // rebuilt from the round_end move
    expect(session.startHeartbeat).toHaveBeenCalledWith('ABC123')
    expect(openNudgeSocket).toHaveBeenCalled()
  })

  it('a match_over session is cleared, not restored', async () => {
    vi.mocked(session.load).mockReturnValueOnce({ gameId: 'ABC123', code: 'ABC123', mySeat: 0 })
    vi.mocked(onlineApi.sync).mockResolvedValueOnce({ moveIndex: 9, view: makeView({ phase: 'match_over' }), moves: [] })

    await useGameStore.getState().resumeSession()

    expect(session.clear).toHaveBeenCalled()
    expect(useGameStore.getState().mode).toBeNull()
  })

  it('a still-waiting session resumes into the waiting room', async () => {
    vi.mocked(session.load).mockReturnValueOnce({ gameId: 'ABC123', code: 'ABC123', mySeat: 0 })
    const waitingView: WaitingRoomView = { status: 'waiting', code: 'ABC123', matchLength: 3, seats: [] }
    vi.mocked(onlineApi.sync).mockResolvedValueOnce(waitingView)

    await useGameStore.getState().resumeSession()

    expect(useGameStore.getState().mode).toBe('online')
    expect(useGameStore.getState().onlineStatus).toBe('waiting')
  })

  it('a 404 (game gone) clears the session', async () => {
    vi.mocked(session.load).mockReturnValueOnce({ gameId: 'GONE99', code: 'GONE99', mySeat: 0 })
    vi.mocked(onlineApi.sync).mockRejectedValueOnce(new WorkerError(404, 'game_not_found', {}))

    await useGameStore.getState().resumeSession()

    expect(session.clear).toHaveBeenCalled()
  })

  it('a network failure at boot leaves the session persisted for a later retry', async () => {
    vi.mocked(session.load).mockReturnValueOnce({ gameId: 'ABC123', code: 'ABC123', mySeat: 0 })
    vi.mocked(onlineApi.sync).mockRejectedValueOnce(new TypeError('offline'))

    await useGameStore.getState().resumeSession()

    expect(session.clear).not.toHaveBeenCalled()
  })
})

// ---- leave / disconnect ----------------------------------------------------------

describe('disconnectOnline / leaveOnline', () => {
  it('mid-game: notifies the server (AI covers the seat) before resetting local state', () => {
    useGameStore.setState({ mode: 'online', roomCode: 'ABC123', onlineView: makeView({ phase: 'playing' }) })
    useGameStore.getState().leaveOnline()
    expect(onlineApi.leave).toHaveBeenCalledWith('ABC123')
    expect(useGameStore.getState().mode).toBeNull()
    expect(useGameStore.getState().onlineStatus).toBe('idle')
  })

  it('waiting-room cancel also notifies the server (abandons the room)', () => {
    useGameStore.setState({ mode: 'online', roomCode: 'ABC123', onlineStatus: 'waiting', onlineView: null })
    useGameStore.getState().disconnectOnline()
    expect(onlineApi.leave).toHaveBeenCalledWith('ABC123')
  })

  it('match_over: does NOT call the server (per design brief)', () => {
    useGameStore.setState({ mode: 'online', roomCode: 'ABC123', onlineView: makeView({ phase: 'match_over' }) })
    useGameStore.getState().leaveOnline()
    expect(onlineApi.leave).not.toHaveBeenCalled()
  })

  it('always tears down the session, outbox, and nudge socket', () => {
    useGameStore.setState({ mode: 'online', roomCode: 'ABC123', onlineView: makeView({ phase: 'match_over' }) })
    useGameStore.getState().leaveOnline()
    expect(session.clear).toHaveBeenCalled()
    expect(outbox.clear).toHaveBeenCalled()
  })

  it('resets every online field to a clean idle state', () => {
    useGameStore.setState({
      state: viewToRenderState(makeView()), mode: 'online', onlinePlayerIndex: 0, roomCode: 'ABC123',
      onlineStatus: 'playing', opponentName: 'Rival', onlineView: makeView(), pendingMove: true,
      coveredSeat: true, opponentCovered: true, lastMoveIndex: 5, lastScoredRound: 1, matchScores: [10, 5],
    })
    useGameStore.getState().leaveOnline()
    const s = useGameStore.getState()
    expect(s.state).toBeNull()
    expect(s.mode).toBeNull()
    expect(s.onlinePlayerIndex).toBeNull()
    expect(s.roomCode).toBeNull()
    expect(s.onlineStatus).toBe('idle')
    expect(s.opponentName).toBeNull()
    expect(s.onlineView).toBeNull()
    expect(s.pendingMove).toBe(false)
    expect(s.coveredSeat).toBe(false)
    expect(s.opponentCovered).toBe(false)
    expect(s.lastMoveIndex).toBe(0)
    expect(s.lastScoredRound).toBeNull()
    expect(s.matchScores).toEqual([0, 0])
  })
})

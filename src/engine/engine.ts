import type { GameState, Action, Result, Card, Good, BonusToken } from './types'
import { Errors } from './errors'

// Precious goods require a minimum 2-card sale
const PRECIOUS: ReadonlySet<Good> = new Set(['diamond', 'gold', 'silver'])

export function applyAction(state: GameState, action: Action): Result<GameState> {
  if (state.phase !== 'playing') {
    return { ok: false, error: Errors.WRONG_PHASE }
  }
  switch (action.type) {
    case 'TAKE_SINGLE':   return takeSingle(state, action.marketIndex)
    case 'TAKE_CAMELS':   return takeCamels(state)
    case 'TAKE_EXCHANGE': return takeExchange(state, action.marketIndices, action.handIndices)
    case 'SELL':          return sell(state, action.good, action.quantity)
  }
}

function nextPlayer(state: GameState): 0 | 1 {
  return state.activePlayer === 0 ? 1 : 0
}

function setPlayer(state: GameState, p: typeof state.players[0]): GameState['players'] {
  return state.activePlayer === 0
    ? [p, state.players[1]]
    : [state.players[0], p]
}

// After any action that may change market size or token piles, check if round is over
function checkRoundEnd(state: GameState): GameState {
  if (state.market.length < 5 && state.deck.length === 0) {
    return { ...state, phase: 'round-end' }
  }
  const depleted = (Object.values(state.tokens) as number[][]).filter(p => p.length === 0).length
  if (depleted >= 3) {
    return { ...state, phase: 'round-end' }
  }
  return state
}

function takeSingle(state: GameState, marketIndex: number): Result<GameState> {
  if (marketIndex < 0 || marketIndex >= state.market.length) {
    return { ok: false, error: Errors.MARKET_INDEX_OOB }
  }
  const card = state.market[marketIndex]
  if (card.type === 'camel') {
    return { ok: false, error: Errors.CANNOT_TAKE_CAMEL }
  }
  const player = state.players[state.activePlayer]
  if (player.hand.length + 1 > 7) {
    return { ok: false, error: Errors.HAND_LIMIT }
  }

  const newMarket = [...state.market]
  const newDeck = [...state.deck]
  if (newDeck.length > 0) {
    newMarket[marketIndex] = newDeck.shift()!
  } else {
    newMarket.splice(marketIndex, 1)
  }

  const newPlayer = { ...player, hand: [...player.hand, card] }
  const next: GameState = {
    ...state,
    market: newMarket,
    deck: newDeck,
    players: setPlayer(state, newPlayer),
    activePlayer: nextPlayer(state),
  }
  return { ok: true, value: checkRoundEnd(next) }
}

function takeCamels(state: GameState): Result<GameState> {
  const camelsInMarket = state.market.filter(c => c.type === 'camel')
  if (camelsInMarket.length === 0) {
    return { ok: false, error: Errors.NO_CAMELS_IN_MARKET }
  }

  const camelCount = camelsInMarket.length
  const nonCamels = state.market.filter(c => c.type !== 'camel')
  const newDeck = [...state.deck]
  const refills = newDeck.splice(0, camelCount)
  const newMarket = [...nonCamels, ...refills]

  const player = state.players[state.activePlayer]
  const newPlayer = { ...player, herd: player.herd + camelCount }
  const next: GameState = {
    ...state,
    market: newMarket,
    deck: newDeck,
    players: setPlayer(state, newPlayer),
    activePlayer: nextPlayer(state),
  }
  return { ok: true, value: checkRoundEnd(next) }
}

function takeExchange(_state: GameState, _marketIndices: number[], _handIndices: number[]): Result<GameState> {
  return { ok: false, error: { code: 'NOT_IMPLEMENTED', message: 'Not yet implemented' } }
}

function sell(_state: GameState, _good: Good, _quantity: number): Result<GameState> {
  return { ok: false, error: { code: 'NOT_IMPLEMENTED', message: 'Not yet implemented' } }
}

export function getLegalActions(_state: GameState): Action[] {
  return []
}

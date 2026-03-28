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

function takeExchange(
  state: GameState,
  marketIndices: number[],
  handIndices: number[], // -1 means: give one camel from herd
): Result<GameState> {
  if (marketIndices.length < 2) {
    return { ok: false, error: Errors.EXCHANGE_TOO_FEW }
  }
  if (marketIndices.length !== handIndices.length) {
    return { ok: false, error: Errors.EXCHANGE_COUNT_MISMATCH }
  }

  // Validate market indices and reject camels
  for (const i of marketIndices) {
    if (i < 0 || i >= state.market.length) {
      return { ok: false, error: Errors.MARKET_INDEX_OOB }
    }
    if (state.market[i].type === 'camel') {
      return { ok: false, error: Errors.EXCHANGE_CANNOT_TAKE_CAMEL }
    }
  }
  if (new Set(marketIndices).size !== marketIndices.length) {
    return { ok: false, error: Errors.MARKET_INDEX_OOB }
  }

  const player = state.players[state.activePlayer]
  const camelsUsed = handIndices.filter(i => i === -1).length

  // Validate herd has enough camels
  if (camelsUsed > player.herd) {
    return { ok: false, error: Errors.NOT_ENOUGH_CAMELS }
  }

  // Validate non-camel hand indices
  for (const i of handIndices) {
    if (i !== -1 && (i < 0 || i >= player.hand.length)) {
      return { ok: false, error: Errors.HAND_INDEX_OOB }
    }
  }

  // Reject duplicate non-camel hand indices (would allow card duplication)
  const nonCamelHandIndices = handIndices.filter(i => i !== -1)
  if (new Set(nonCamelHandIndices).size !== nonCamelHandIndices.length) {
    return { ok: false, error: Errors.EXCHANGE_DUPLICATE_CARD }
  }

  const takenFromMarket = marketIndices.map(i => state.market[i])
  const takenTypes = new Set(takenFromMarket.map(c => c.type))

  const handCardsReturned = handIndices
    .filter(i => i !== -1)
    .map(i => player.hand[i])
  const returnedGoodTypes = new Set(handCardsReturned.map(c => c.type))

  // No same-type swap
  for (const type of takenTypes) {
    if (returnedGoodTypes.has(type as Good)) {
      return { ok: false, error: Errors.EXCHANGE_SAME_TYPE }
    }
  }

  // Remove returned hand cards, add taken cards
  const returnedIds = new Set(handCardsReturned.map(c => c.id))
  const handAfterRemoval = player.hand.filter(c => !returnedIds.has(c.id))
  const newHandGoods = [...handAfterRemoval, ...takenFromMarket]

  // Post-resolution hand limit check
  if (newHandGoods.length > 7) {
    return { ok: false, error: Errors.HAND_LIMIT }
  }

  // Build new market: replace taken slots with returned goods, then fill with camel placeholders
  const newMarket = [...state.market]
  const returnCards: Card[] = [...handCardsReturned]
  // Add placeholder camel cards for each herd camel given (they go into market as camels)
  // Derive fresh IDs by scanning all cards in state to ensure uniqueness across exchanges
  const allIds = [
    ...state.market.map(c => c.id),
    ...state.deck.map(c => c.id),
    ...state.discard.map(c => c.id),
    ...state.players[0].hand.map(c => c.id),
    ...state.players[1].hand.map(c => c.id),
  ]
  let nextId = Math.max(0, ...allIds) + 1
  for (let i = 0; i < camelsUsed; i++) {
    returnCards.push({ id: nextId++, type: 'camel' })
  }
  for (let i = 0; i < marketIndices.length; i++) {
    newMarket[marketIndices[i]] = returnCards[i]
  }

  const newPlayer = {
    ...player,
    hand: newHandGoods,
    herd: player.herd - camelsUsed,
  }

  const next: GameState = {
    ...state,
    market: newMarket,
    players: setPlayer(state, newPlayer),
    activePlayer: nextPlayer(state),
  }
  return { ok: true, value: checkRoundEnd(next) }
}

function sell(_state: GameState, _good: Good, _quantity: number): Result<GameState> {
  return { ok: false, error: { code: 'NOT_IMPLEMENTED', message: 'Not yet implemented' } }
}

export function getLegalActions(_state: GameState): Action[] {
  return []
}

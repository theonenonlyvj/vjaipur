import type { EngineError } from './types'

function err(code: string, message: string): EngineError {
  return { code, message }
}

export const Errors = {
  HAND_LIMIT:               err('HAND_LIMIT',               "You can't hold more than 7 goods cards"),
  EXCHANGE_TOO_FEW:         err('EXCHANGE_TOO_FEW',         "You can't exchange just 1 card — minimum 2"),
  EXCHANGE_SAME_TYPE:       err('EXCHANGE_SAME_TYPE',       "You can't take and return the same type of good in one exchange"),
  EXCHANGE_COUNT_MISMATCH:  err('EXCHANGE_COUNT_MISMATCH',  "You must return exactly as many cards as you take"),
  EXCHANGE_CANNOT_TAKE_CAMEL: err('EXCHANGE_CANNOT_TAKE_CAMEL', "You can't take camels in an exchange — use Take Camels instead"),
  SELL_TOO_FEW:             err('SELL_TOO_FEW',             "Diamonds, gold, and silver require selling at least 2 at a time"),
  SELL_NONE:                err('SELL_NONE',                "You must sell at least 1 card"),
  SELL_NOT_IN_HAND:         err('SELL_NOT_IN_HAND',         "You don't have enough of that good to sell"),
  NO_CAMELS_IN_MARKET:      err('NO_CAMELS_IN_MARKET',      "There are no camels in the market to take"),
  MARKET_INDEX_OOB:         err('MARKET_INDEX_OOB',         "That market card doesn't exist"),
  HAND_INDEX_OOB:           err('HAND_INDEX_OOB',           "That hand card doesn't exist"),
  EXCHANGE_DUPLICATE_CARD:  err('EXCHANGE_DUPLICATE_CARD',  "You can't use the same card twice in one exchange"),
  NOT_ENOUGH_CAMELS:        err('NOT_ENOUGH_CAMELS',        "You don't have enough camels in your herd for that exchange"),
  WRONG_PHASE:              err('WRONG_PHASE',              "You can't take an action right now"),
  CANNOT_TAKE_CAMEL:        err('CANNOT_TAKE_CAMEL',        "Use Take Camels to take camels — TAKE_SINGLE is for goods only"),
} as const

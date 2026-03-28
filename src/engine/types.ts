export type Good = 'diamond' | 'gold' | 'silver' | 'cloth' | 'spice' | 'leather'
export type CardType = Good | 'camel'

export interface Card {
  id: number        // unique per card instance, stable across state copies — used for animations
  type: CardType
}

export interface GoodsToken {
  good: Good
  value: number
}

export interface BonusToken {
  tier: 3 | 4 | 5  // which sale size earned this
  value: number     // revealed only at round scoring
}

// Remaining token values per good, in descending order (index 0 = next to be taken)
export type TokenPiles = Record<Good, number[]>

export interface BonusPiles {
  three: BonusToken[]   // 3-card sale pile (face-down; .length = count remaining)
  four: BonusToken[]
  five: BonusToken[]
}

export interface PlayerState {
  hand: Card[]              // goods only — max 7 at turn end
  herd: number              // camel count (not shown to opponent unless taunting)
  tokens: GoodsToken[]      // goods tokens earned this round
  bonusTokens: BonusToken[] // bonus tokens earned this round
}

export type Phase = 'playing' | 'round-end' | 'game-over'

export interface GameState {
  phase: Phase
  round: number                        // 1-indexed; max 3
  activePlayer: 0 | 1
  market: Card[]                       // always 5 cards (goods or camels)
  deck: Card[]                         // face-down draw pile
  discard: Card[]                      // sold cards, face-up; used by UI and AI reasoning
  players: [PlayerState, PlayerState]
  tokens: TokenPiles                   // board token piles (remaining)
  bonusTokens: BonusPiles              // board bonus token piles (remaining)
  seals: [number, number]              // seals won per player across all rounds
}

export type Action =
  | { type: 'TAKE_SINGLE'; marketIndex: number }
  | {
      type: 'TAKE_EXCHANGE'
      marketIndices: number[]  // which market cards to take
      handIndices: number[]    // which hand cards to return; -1 = give one camel from herd
    }
  | { type: 'TAKE_CAMELS' }
  | { type: 'SELL'; good: Good; quantity: number }

export interface EngineError {
  code: string
  message: string  // shown directly to the player as a toast
}

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: EngineError }

export interface RoundResult {
  camelWinner: 0 | 1 | null        // null = tie, nobody gets camel token
  scores: [number, number]          // total rupees per player (including camel token)
  bonusTokenCounts: [number, number]
  sealAwardedTo: 0 | 1 | null      // null only on complete tie (extremely rare)
}

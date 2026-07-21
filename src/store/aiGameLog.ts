// Per-move GAME LOGGING for local vs-AI matches (AI-tuning data capture).
//
// Kept in its own module rather than inline in gameStore.ts so statsStore.ts
// (and net/types.ts) can share these types without a gameStore<->statsStore
// import cycle — gameStore.ts already imports statsStore.ts for addMatch.
//
// Design: local vs-AI play is fully client-authoritative (no server
// redaction — contrast the online ClientView, which hides the opponent's
// hand/deck), so a per-move snapshot here is genuinely FULL information:
// both hands, not just "my" hand. `preState` is intentionally TYPES ONLY (no
// card ids) — ids exist purely for React animation keys and carry no signal
// for AI tuning, and dropping them is most of what keeps a snapshot small.
import type { Action, Card, GameState, Good } from '../engine'
import type { TierId } from '../ai/tiers'

const GOOD_ORDER: Good[] = ['diamond', 'gold', 'silver', 'cloth', 'spice', 'leather']

/** Types-only, id-free snapshot of a GameState at decision time. Target
 *  <500B JSON-encoded per move (see capLogForReport for the wire-size cap on
 *  top of this). */
export interface CompactSnapshot {
  /** Market card types, left-to-right slot order. */
  mkt: string[]
  /** Player 0's hand, card types only. */
  h0: string[]
  /** Player 1's hand, card types only. */
  h1: string[]
  herd: [number, number]
  /** Face-down draw pile count. */
  deck: number
  /** Remaining goods-token pile VALUES per good, in GOOD_ORDER (index 0 =
   *  next value to be taken). An array-of-arrays (not a keyed object) to
   *  skip 6 repeated good-name keys per move. */
  tok: number[][]
  /** Remaining bonus-token counts: [three-pile, four-pile, five-pile]. */
  bonus: [number, number, number]
  /** Realized round score so far per player (sum of earned goods-token +
   *  bonus-token values; camel majority bonus is round-end-only, so it's
   *  never included here) — same formula as worker/src/do/view.ts's
   *  ownScore, kept in sync by hand since this module never imports the
   *  worker (src/ never imports worker/, only the reverse). */
  score: [number, number]
  seals: [number, number]
}

/** One ISMCTS root-child candidate, as exposed by
 *  ismctsBot.ts#getLastIsmctsDebugInfo — `action` is the tree's stable
 *  actionKey STRING (e.g. "TS:2", "SL:diamond:3"), not a full Action object;
 *  the debug info only ever carried keys, and re-deriving a real Action from
 *  one isn't needed for tuning analysis. */
export interface IsmctsCandidateLog {
  action: string
  visits: number
  q: number
}

export interface AiLogEntry {
  /** 1-indexed, monotonic across the whole match (both rounds and both
   *  actors share one counter) — survives cap-driven trimming (see
   *  appendCapped) because it's derived from the last entry's own `ply`,
   *  never from the (possibly-trimmed) array length. */
  ply: number
  round: number
  actor: 'human' | 'ai'
  /** The AI tier this match is being played against — present on BOTH the
   *  human's and the AI's entries (it's match context, not "who produced
   *  this row"); for an 'ai' entry it also identifies which engine chose
   *  the move. */
  tier: TierId
  action: Action
  preState: CompactSnapshot
  /** ISMCTS-only root-child diagnostics for this move, top-3 by visit count
   *  (already sorted that way by getLastIsmctsDebugInfo). Omitted entirely
   *  (not even an empty array) for every non-ismcts tier and for the
   *  human's own entries. */
  candidates?: IsmctsCandidateLog[]
}

/** Wire shape once `capLogForReport` may have stripped `preState` off the
 *  oldest entries to fit the size budget — everything else survives
 *  untouched. */
export type WireAiLogEntry = Omit<AiLogEntry, 'preState'> & { preState?: CompactSnapshot }

/** Safety cap on the in-memory per-match log — ordinary Jaipur matches (3
 *  rounds, each ending well under 100 plies) never get remotely close; this
 *  only guards against a pathologically long/looping match. */
export const AI_LOG_MAX_ENTRIES = 600

const cardTypes = (cards: Card[]): string[] => cards.map((c) => c.type)

function playerScore(state: GameState, index: 0 | 1): number {
  const p = state.players[index]
  const goods = p.tokens.reduce((s, t) => s + t.value, 0)
  const bonus = p.bonusTokens.reduce((s, t) => s + t.value, 0)
  return goods + bonus
}

export function buildCompactSnapshot(state: GameState): CompactSnapshot {
  return {
    mkt: cardTypes(state.market),
    h0: cardTypes(state.players[0].hand),
    h1: cardTypes(state.players[1].hand),
    herd: [state.players[0].herd, state.players[1].herd],
    deck: state.deck.length,
    tok: GOOD_ORDER.map((g) => [...state.tokens[g]]),
    bonus: [state.bonusTokens.three.length, state.bonusTokens.four.length, state.bonusTokens.five.length],
    score: [playerScore(state, 0), playerScore(state, 1)],
    seals: [state.seals[0], state.seals[1]],
  }
}

/** Append `entry`, trimming from the FRONT (oldest first) once the log
 *  exceeds `max` entries. */
export function appendCapped(log: AiLogEntry[], entry: AiLogEntry, max: number = AI_LOG_MAX_ENTRIES): AiLogEntry[] {
  const next = [...log, entry]
  return next.length > max ? next.slice(next.length - max) : next
}

const DEFAULT_MAX_LOG_BYTES = 250_000

/**
 * Serialize a match's log to a JSON string capped at ~`maxBytes` — the
 * client-side budget for the `/stats/report` body (the worker independently
 * re-validates at 300KB after its own JSON.stringify — see
 * worker/src/do/stats.ts#reportMatch — so this only needs to comfortably
 * clear that bar, not hit it exactly). Strips `preState` from the OLDEST
 * entries first — ply/round/actor/tier/action/candidates always survive;
 * only the bulky snapshot is dropped — until the encoded size fits or every
 * entry has been stripped.
 *
 * `.length` on the JSON string doubles as the byte count: every field this
 * module ever emits (card-type names, action types/goods, numbers) is
 * ASCII, so JS's UTF-16 code-unit count and the UTF-8 byte count coincide
 * exactly here — no TextEncoder needed.
 */
export function capLogForReport(log: AiLogEntry[], maxBytes: number = DEFAULT_MAX_LOG_BYTES): string {
  const working: WireAiLogEntry[] = log.map((e) => ({ ...e }))
  let json = JSON.stringify(working)
  let i = 0
  while (json.length > maxBytes && i < working.length) {
    if (working[i].preState !== undefined) {
      delete working[i].preState
      json = JSON.stringify(working)
    }
    i++
  }
  return json
}

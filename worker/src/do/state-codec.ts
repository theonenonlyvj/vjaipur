import type { GameState } from '../../../src/engine'

/**
 * GameState <-> JSON codec for Durable Object persistence.
 *
 * Contrast with viota's do/state-codec.ts: viota's `GameState.grid` is a JS
 * `Map`, and `JSON.stringify` on a Map silently yields `{}` (loses the whole
 * board) — so viota's codec hand-rolls a `[...grid.entries()]` <-> `new
 * Map(entries)` transform.
 *
 * vjaipur's engine GameState (src/engine/types.ts) has NO Map/Set/class
 * anywhere in its shape — `market`/`deck`/`discard`/`players`/`tokens`/
 * `bonusTokens`/`revealedHands`/`seals` are all plain arrays/objects/numbers.
 * It is therefore fully, losslessly JSON-serializable with the identity
 * codec below. This is verified by a round-trip deep-equality test in
 * worker/test/foundation.test.ts against a REAL `setupRound` output (not just
 * asserted by inspection) — see that test before trusting this comment on its
 * own.
 */

export function encodeState(state: GameState): string {
  return JSON.stringify(state)
}

export function decodeState(json: string): GameState {
  return JSON.parse(json) as GameState
}

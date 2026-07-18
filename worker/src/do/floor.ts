import type { Action, GameState, Good } from '../../../src/engine'
import { getLegalActions } from '../../../src/engine'

/** Precious goods require a minimum 2-card sale — mirrors src/engine/engine.ts's
 *  own PRECIOUS set/rule (SELL_TOO_FEW). */
const MIN_SELL: Record<Good, number> = {
  diamond: 2,
  gold: 2,
  silver: 2,
  cloth: 1,
  spice: 1,
  leather: 1,
}

/**
 * The CPU-kill floor move (ADDENDUM N) — the ALWAYS-legal fallback for a
 * covered seat when the smart (medium AI) computation is unavailable/killed.
 * First legal of:
 *   1. TAKE_CAMELS, if the market has >= 1 camel (unconditionally legal
 *      whenever true — see src/engine/engine.ts's getLegalActions, which
 *      gates it on nothing but market camel presence).
 *   2. SELL the largest legal single-good hand group (precious goods respect
 *      the min-2 sell rule via MIN_SELL above).
 *   3. TAKE_SINGLE the lowest-value market good, keeping hand <= 7.
 *
 * MUST always be a member of `getLegalActions(state)` — Jaipur always has a
 * legal move for a `'playing'`-phase state (verified by floor.test.ts's
 * 1000-state fuzz). Callers MUST guard `meta.phase === 'playing'` themselves
 * before calling this (ADDENDUM K) — `floorMove` always returns an `Action`,
 * it has no "not applicable" signal of its own.
 */
export function floorMove(state: GameState): Action {
  // 1. TAKE_CAMELS — first priority: drains the deck fastest, never touches
  // hand size, and (per getLegalActions) is legal whenever the market has a
  // camel at all.
  if (state.market.some((c) => c.type === 'camel')) {
    return { type: 'TAKE_CAMELS' }
  }

  // 2. SELL the largest single-good group that meets its minimum sell qty.
  const player = state.players[state.activePlayer]
  const counts = new Map<Good, number>()
  for (const card of player.hand) {
    if (card.type === 'camel') continue
    const good = card.type as Good
    counts.set(good, (counts.get(good) ?? 0) + 1)
  }
  let bestGood: Good | null = null
  let bestCount = 0
  for (const [good, count] of counts) {
    if (count >= MIN_SELL[good] && count > bestCount) {
      bestGood = good
      bestCount = count
    }
  }
  if (bestGood) {
    return { type: 'SELL', good: bestGood, quantity: bestCount }
  }

  // 3. TAKE_SINGLE the lowest-value market good, keeping hand <= 7. Reaching
  // here means the market has zero camels (step 1 would have returned), so
  // every market slot is a good and any index is eligible.
  if (player.hand.length < 7) {
    let bestIdx = -1
    let bestValue = Infinity
    for (let i = 0; i < state.market.length; i++) {
      const card = state.market[i]!
      if (card.type === 'camel') continue
      const value = state.tokens[card.type as Good]?.[0] ?? 0
      if (value < bestValue) {
        bestValue = value
        bestIdx = i
      }
    }
    if (bestIdx !== -1) return { type: 'TAKE_SINGLE', marketIndex: bestIdx }
  }

  // Should be unreachable: with 0 camels in market and hand === 7, pigeonhole
  // over 6 good types guarantees some good has >= 2 copies, which always
  // satisfies its MIN_SELL (at most 2) — so step 2 above always fires first.
  // Never invent an illegal action, though: fall back to whatever the engine
  // itself reports as legal, and only throw if it reports none at all (an
  // engine bug per ADDENDUM N, not a floorMove bug).
  const legal = getLegalActions(state)
  if (legal.length > 0) return legal[0]!
  throw new Error('floorMove: no legal action available for this state (ADDENDUM N engine-bug guard)')
}

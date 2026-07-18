import type { Action, Good } from '../../../src/engine'

/**
 * Untrusted-payload shape/bounds guard (design spec §3.3, ADDENDUM E).
 *
 * This is PER-FIELD, not a uniform bounds check, and it NEVER decides
 * legality — occupied-market-slot checks, hand-limit, herd-camel counts,
 * same-type-swap, whose turn, etc. are the engine's job alone
 * (`applyAction` in `src/engine/engine.ts` is the sole legality gate, and it
 * already guards these post-hardening). This only rejects malformed input
 * the engine should never even see: wrong type, non-integer indices, an
 * out-of-allowlist good, a non-positive quantity.
 *
 * ADDENDUM E, verbatim:
 *  - `marketIndices[i]`: integer, `>= 0` (never -1/camel) — bounds vs the
 *    actual market length stay the engine's job.
 *  - TAKE_EXCHANGE `handIndices[i]`: integer, EITHER exactly `-1` (give a
 *    herd camel) OR `>= 0`. No other field accepts `-1`.
 *  - Mirrors the exact `Action` shapes in `src/engine/types.ts`.
 */
export type ShapeResult = { ok: true; move: Action } | { ok: false; error: string }

const GOODS: readonly Good[] = ['diamond', 'gold', 'silver', 'cloth', 'spice', 'leather']

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

/** A non-negative integer — valid for any market index or a TAKE_EXCHANGE
 *  hand index that is NOT the "give a herd camel" sentinel. */
function isNonNegInt(n: unknown): boolean {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0
}

/** TAKE_EXCHANGE.handIndices ONLY: exactly -1, or a non-negative integer. */
function isHandIndexOrCamelSentinel(n: unknown): boolean {
  return n === -1 || isNonNegInt(n)
}

const err = (error: string): ShapeResult => ({ ok: false, error })

export function validateMovePayloadShape(raw: unknown): ShapeResult {
  if (!isObj(raw)) return err('payload must be an object')

  switch (raw.type) {
    case 'TAKE_SINGLE': {
      if (!isNonNegInt(raw.marketIndex)) return err('marketIndex must be a non-negative integer')
      return { ok: true, move: { type: 'TAKE_SINGLE', marketIndex: raw.marketIndex as number } }
    }
    case 'TAKE_CAMELS': {
      return { ok: true, move: { type: 'TAKE_CAMELS' } }
    }
    case 'TAKE_EXCHANGE': {
      if (!Array.isArray(raw.marketIndices)) return err('marketIndices must be an array')
      if (!raw.marketIndices.every(isNonNegInt)) return err('marketIndices entries must be non-negative integers')
      if (!Array.isArray(raw.handIndices)) return err('handIndices must be an array')
      if (!raw.handIndices.every(isHandIndexOrCamelSentinel)) {
        return err('handIndices entries must be -1 or a non-negative integer')
      }
      return {
        ok: true,
        move: {
          type: 'TAKE_EXCHANGE',
          marketIndices: raw.marketIndices as number[],
          handIndices: raw.handIndices as number[],
        },
      }
    }
    case 'SELL': {
      if (typeof raw.good !== 'string' || !GOODS.includes(raw.good as Good)) {
        return err('good must be one of diamond, gold, silver, cloth, spice, leather')
      }
      if (typeof raw.quantity !== 'number' || !Number.isInteger(raw.quantity) || raw.quantity < 1) {
        return err('quantity must be a positive integer')
      }
      return { ok: true, move: { type: 'SELL', good: raw.good as Good, quantity: raw.quantity } }
    }
    default:
      return err('unknown move type')
  }
}

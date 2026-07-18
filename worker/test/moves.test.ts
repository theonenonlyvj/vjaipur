import { describe, expect, it } from 'vitest'
import { validateMovePayloadShape } from '../src/do/moves'

describe('validateMovePayloadShape', () => {
  it('accepts a well-formed TAKE_SINGLE', () => {
    const r = validateMovePayloadShape({ type: 'TAKE_SINGLE', marketIndex: 2 })
    expect(r).toEqual({ ok: true, move: { type: 'TAKE_SINGLE', marketIndex: 2 } })
  })

  it('rejects TAKE_SINGLE with a negative/non-integer/missing marketIndex', () => {
    expect(validateMovePayloadShape({ type: 'TAKE_SINGLE', marketIndex: -1 }).ok).toBe(false)
    expect(validateMovePayloadShape({ type: 'TAKE_SINGLE', marketIndex: 1.5 }).ok).toBe(false)
    expect(validateMovePayloadShape({ type: 'TAKE_SINGLE', marketIndex: '2' }).ok).toBe(false)
    expect(validateMovePayloadShape({ type: 'TAKE_SINGLE' }).ok).toBe(false)
  })

  it('accepts TAKE_CAMELS with no extra fields required', () => {
    expect(validateMovePayloadShape({ type: 'TAKE_CAMELS' })).toEqual({ ok: true, move: { type: 'TAKE_CAMELS' } })
  })

  it('accepts a well-formed TAKE_EXCHANGE, including -1 camel-from-herd sentinels', () => {
    const r = validateMovePayloadShape({
      type: 'TAKE_EXCHANGE',
      marketIndices: [0, 1],
      handIndices: [-1, 3],
    })
    expect(r).toEqual({
      ok: true,
      move: { type: 'TAKE_EXCHANGE', marketIndices: [0, 1], handIndices: [-1, 3] },
    })
  })

  it('rejects TAKE_EXCHANGE with a negative marketIndex (never -1/camel there)', () => {
    expect(
      validateMovePayloadShape({ type: 'TAKE_EXCHANGE', marketIndices: [-1], handIndices: [0] }).ok,
    ).toBe(false)
  })

  it('rejects TAKE_EXCHANGE with a handIndices entry that is neither -1 nor >= 0', () => {
    expect(
      validateMovePayloadShape({ type: 'TAKE_EXCHANGE', marketIndices: [0], handIndices: [-2] }).ok,
    ).toBe(false)
    expect(
      validateMovePayloadShape({ type: 'TAKE_EXCHANGE', marketIndices: [0], handIndices: [1.5] }).ok,
    ).toBe(false)
  })

  it('rejects TAKE_EXCHANGE when marketIndices/handIndices are not arrays', () => {
    expect(validateMovePayloadShape({ type: 'TAKE_EXCHANGE', marketIndices: 0, handIndices: [0] }).ok).toBe(false)
    expect(validateMovePayloadShape({ type: 'TAKE_EXCHANGE', marketIndices: [0], handIndices: 0 }).ok).toBe(false)
  })

  it('accepts a well-formed SELL for each of the 6 goods', () => {
    for (const good of ['diamond', 'gold', 'silver', 'cloth', 'spice', 'leather']) {
      expect(validateMovePayloadShape({ type: 'SELL', good, quantity: 2 })).toEqual({
        ok: true,
        move: { type: 'SELL', good, quantity: 2 },
      })
    }
  })

  it('rejects SELL with an unknown good or a non-positive/non-integer quantity', () => {
    expect(validateMovePayloadShape({ type: 'SELL', good: 'camel', quantity: 1 }).ok).toBe(false)
    expect(validateMovePayloadShape({ type: 'SELL', good: 'gold', quantity: 0 }).ok).toBe(false)
    expect(validateMovePayloadShape({ type: 'SELL', good: 'gold', quantity: -1 }).ok).toBe(false)
    expect(validateMovePayloadShape({ type: 'SELL', good: 'gold', quantity: 1.5 }).ok).toBe(false)
    expect(validateMovePayloadShape({ type: 'SELL', good: 'gold' }).ok).toBe(false)
  })

  it('rejects an unknown move type and non-object payloads', () => {
    expect(validateMovePayloadShape({ type: 'PASS' }).ok).toBe(false)
    expect(validateMovePayloadShape(null).ok).toBe(false)
    expect(validateMovePayloadShape('TAKE_CAMELS').ok).toBe(false)
    expect(validateMovePayloadShape([1, 2, 3]).ok).toBe(false)
    expect(validateMovePayloadShape(undefined).ok).toBe(false)
  })
})

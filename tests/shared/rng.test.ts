import { describe, it, expect } from 'vitest'
import { mulberry32 } from '../../src/shared/rng'

describe('mulberry32', () => {
  it('returns values in [0, 1)', () => {
    const rng = mulberry32(42)
    for (let i = 0; i < 100; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('same seed produces same sequence', () => {
    const a = mulberry32(12345)
    const b = mulberry32(12345)
    for (let i = 0; i < 10; i++) {
      expect(a()).toBe(b())
    }
  })

  it('different seeds produce different first values', () => {
    const a = mulberry32(1)()
    const b = mulberry32(2)()
    expect(a).not.toBe(b)
  })
})

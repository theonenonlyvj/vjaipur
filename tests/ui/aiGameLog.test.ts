import { describe, it, expect } from 'vitest'
import {
  AI_LOG_MAX_ENTRIES,
  appendCapped,
  buildCompactSnapshot,
  capLogForReport,
  type AiLogEntry,
} from '../../src/store/aiGameLog'
import { setupRound } from '../../src/engine'
import type { GameState } from '../../src/engine'

function freshState(): GameState {
  return setupRound([0, 0], undefined, () => 0.5)
}

function makeEntry(ply: number, overrides: Partial<AiLogEntry> = {}): AiLogEntry {
  return {
    ply,
    round: 1,
    actor: 'human',
    tier: 'easy',
    action: { type: 'TAKE_CAMELS' },
    preState: buildCompactSnapshot(freshState()),
    ...overrides,
  }
}

describe('buildCompactSnapshot', () => {
  it('captures market/hand card TYPES only — no card ids anywhere in the snapshot', () => {
    const state = freshState()
    const snap = buildCompactSnapshot(state)

    expect(snap.mkt).toEqual(state.market.map((c) => c.type))
    expect(snap.h0).toEqual(state.players[0].hand.map((c) => c.type))
    expect(snap.h1).toEqual(state.players[1].hand.map((c) => c.type))

    // No numeric id ever appears — every field is a string, a small int
    // count/value, or a nested array of those.
    const json = JSON.stringify(snap)
    expect(json).not.toMatch(/"id"/)
  })

  it('captures both hands (full information — local vs-AI has no redaction)', () => {
    const state = freshState()
    const snap = buildCompactSnapshot(state)
    expect(snap.h0.length).toBe(state.players[0].hand.length)
    expect(snap.h1.length).toBe(state.players[1].hand.length)
  })

  it('captures herds, deck count, seals', () => {
    const state = freshState()
    const snap = buildCompactSnapshot(state)
    expect(snap.herd).toEqual([state.players[0].herd, state.players[1].herd])
    expect(snap.deck).toBe(state.deck.length)
    expect(snap.seals).toEqual(state.seals)
  })

  it('captures remaining token piles in GOOD_ORDER (diamond, gold, silver, cloth, spice, leather)', () => {
    const state = freshState()
    const snap = buildCompactSnapshot(state)
    expect(snap.tok).toEqual([
      state.tokens.diamond,
      state.tokens.gold,
      state.tokens.silver,
      state.tokens.cloth,
      state.tokens.spice,
      state.tokens.leather,
    ])
  })

  it('captures remaining bonus-token pile counts as [three, four, five]', () => {
    const state = freshState()
    const snap = buildCompactSnapshot(state)
    expect(snap.bonus).toEqual([
      state.bonusTokens.three.length,
      state.bonusTokens.four.length,
      state.bonusTokens.five.length,
    ])
  })

  it('computes realized round score as sum of earned goods+bonus token values (no camel bonus mid-round)', () => {
    const state = freshState()
    // Manually award a token so the formula has something nonzero to prove.
    const withToken: GameState = {
      ...state,
      players: [
        { ...state.players[0], tokens: [{ good: 'diamond', value: 7 }], bonusTokens: [{ tier: 3, value: 2 }] },
        state.players[1],
      ],
    }
    const snap = buildCompactSnapshot(withToken)
    expect(snap.score).toEqual([9, 0])
  })

  it('stays comfortably under the ~500B/move target for a typical mid-game snapshot', () => {
    const state = freshState()
    const snap = buildCompactSnapshot(state)
    const entry: AiLogEntry = { ply: 1, round: 1, actor: 'human', tier: 'medium', action: { type: 'TAKE_CAMELS' }, preState: snap }
    expect(JSON.stringify(entry).length).toBeLessThan(500)
  })
})

describe('appendCapped', () => {
  it('appends normally under the cap', () => {
    const log = appendCapped([], makeEntry(1))
    const log2 = appendCapped(log, makeEntry(2))
    expect(log2.map((e) => e.ply)).toEqual([1, 2])
  })

  it('trims from the FRONT (oldest first) once the log exceeds the cap, keeping ply numbers intact', () => {
    let log: AiLogEntry[] = []
    const total = AI_LOG_MAX_ENTRIES + 5
    for (let i = 1; i <= total; i++) {
      log = appendCapped(log, makeEntry(i))
    }
    expect(log.length).toBe(AI_LOG_MAX_ENTRIES)
    // The oldest 5 (ply 1..5) were dropped; the survivors are ply 6..605.
    expect(log[0].ply).toBe(6)
    expect(log[log.length - 1].ply).toBe(total)
  })

  it('respects a custom max (for fast/deterministic tests of the trimming behavior itself)', () => {
    let log: AiLogEntry[] = []
    for (let i = 1; i <= 5; i++) {
      log = appendCapped(log, makeEntry(i), 3)
    }
    expect(log.map((e) => e.ply)).toEqual([3, 4, 5])
  })
})

describe('capLogForReport', () => {
  it('returns valid JSON parseable back into the same entries when under budget', () => {
    const log = [makeEntry(1), makeEntry(2, { actor: 'ai' })]
    const json = capLogForReport(log)
    const parsed = JSON.parse(json)
    expect(parsed).toHaveLength(2)
    expect(parsed[0].preState).toBeDefined()
    expect(parsed[1].actor).toBe('ai')
  })

  it('strips preState from the OLDEST entries first once over the byte budget, keeping every other field', () => {
    const log = [makeEntry(1), makeEntry(2), makeEntry(3)]
    const fullSize = JSON.stringify(log).length
    // The exact size once only the oldest entry has had preState removed —
    // budget it to fit that and nothing less, so the algorithm must strip
    // entry 1 but has no reason to touch entries 2 or 3.
    const afterStrippingOldest = JSON.stringify([
      { ...log[0], preState: undefined },
      log[1],
      log[2],
    ]).length
    expect(afterStrippingOldest).toBeLessThan(fullSize) // sanity: stripping actually shrinks it

    const json = capLogForReport(log, afterStrippingOldest)
    const parsed = JSON.parse(json)
    expect(parsed).toHaveLength(3)
    expect(parsed[0].preState).toBeUndefined() // oldest — stripped first
    expect(parsed[0].ply).toBe(1) // every other field survives
    expect(parsed[0].action).toEqual({ type: 'TAKE_CAMELS' })
    expect(parsed[1].preState).toBeDefined()
    expect(parsed[2].preState).toBeDefined()
  })

  it('strips every entry down to bare fields under an extremely tight budget, never throwing or dropping entries', () => {
    const log = [makeEntry(1), makeEntry(2), makeEntry(3)]
    const json = capLogForReport(log, 10) // impossibly tight
    const parsed = JSON.parse(json)
    expect(parsed).toHaveLength(3) // entries are never DROPPED, only lightened
    expect(parsed.every((e: { preState?: unknown }) => e.preState === undefined)).toBe(true)
  })

  it('is a no-op under a generous budget (nothing stripped)', () => {
    const log = [makeEntry(1), makeEntry(2)]
    const json = capLogForReport(log, 250_000)
    const parsed = JSON.parse(json)
    expect(parsed.every((e: { preState?: unknown }) => e.preState !== undefined)).toBe(true)
  })
})

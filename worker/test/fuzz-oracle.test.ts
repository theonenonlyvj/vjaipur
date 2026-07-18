import { env, runInDurableObject } from 'cloudflare:test'
import { describe, beforeAll, expect, it } from 'vitest'
import { applyAction, getLegalActions, type Action, type GameState } from '../../src/engine'
import { mulberry32 } from '../../src/shared/rng'
import { GameRepository, type SqlLike } from '../src/do/storage'
import { applyD1Schema } from './helpers'

/**
 * ADVERSARIAL FULL-MATCH FUZZ vs. an INDEPENDENT Jaipur rules oracle.
 *
 * Goal: prove the server-authoritative worker (GameDO, driven only through
 * `stub.fetch` — the exact HTTP-shaped surface a real client uses) agrees
 * with an oracle that is NOT simply "the engine checking itself" wherever
 * that's avoidable:
 *
 *  - Move LEGALITY is necessarily engine-derived (`getLegalActions`) — there
 *    is no independent legality spec to check against, so this fuzzer trusts
 *    the certified `src/engine` for "what's a legal move" (per project
 *    memory, the engine is CERTIFIED/locked) and focuses the independent
 *    scrutiny on what the SERVER does with a legal move stream: does it
 *    apply moves in order without corruption, does it score/seal/crown a
 *    winner correctly, does it conserve cards, does it keep the log gapless
 *    and redacted.
 *  - Round SCORING (`independentScoreRound` below) is a SEPARATE, hand-written
 *    re-implementation of the scoring rules — NOT a call to
 *    `src/engine/scoring.ts#scoreRound` — sanity-checked against a handful of
 *    hand-computed synthetic states in the `describe` block below BEFORE it's
 *    trusted as the oracle for live fuzz matches.
 *  - sealsNeeded / match-winner math is independently asserted against the
 *    known Jaipur best-of-N rule (1->1, 3->2, 5->3), not just re-derived from
 *    the same one-line formula `do/apply.ts` uses.
 *
 * Harness patterns (stubFor/req/move/sync/createAndJoin) are copied from
 * `test/online-flow.test.ts` per the task brief — this file owns its own
 * copies so it never edits that file.
 */

// ---------------------------------------------------------------------------
// ---- harness (copied + adapted from online-flow.test.ts) ------------------
// ---------------------------------------------------------------------------

const DB = () => (env as unknown as { DB: D1Database }).DB

beforeAll(async () => {
  await applyD1Schema(DB())
})

let stubCounter = 0
function stubFor(name: string) {
  return env.GAME_DO.get(env.GAME_DO.idFromName(`${name}-${stubCounter++}`))
}

function req(path: string, opts: { method?: string; token?: string; body?: unknown } = {}): Request {
  const headers: Record<string, string> = {}
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  return new Request(`https://do${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
}

async function readJson(res: Response): Promise<any> {
  return res.json()
}

const ALICE_ID = 'acct-fuzz-alice'
const BOB_ID = 'acct-fuzz-bob'
const ALICE = `test:${ALICE_ID}:Alice`
const BOB = `test:${BOB_ID}:Bob`

async function createRoom(stub: ReturnType<typeof stubFor>, matchLength: 1 | 3 | 5, token = ALICE) {
  const res = await stub.fetch(req('/games', { token, body: { matchLength } }))
  expect(res.status).toBe(201)
  return readJson(res)
}

async function join(stub: ReturnType<typeof stubFor>, token = BOB) {
  return readJson(await stub.fetch(req('/join', { token, body: {} })))
}

async function sync(stub: ReturnType<typeof stubFor>, token: string, since = 0) {
  const res = await stub.fetch(req(`/sync?since=${since}`, { token, method: 'GET' }))
  return { status: res.status, body: await readJson(res) }
}

async function move(stub: ReturnType<typeof stubFor>, token: string, seatIndex: 0 | 1, action: Action, clientMoveId?: string) {
  const res = await stub.fetch(
    req('/move', { token, body: { seatIndex, move: action, clientMoveId: clientMoveId ?? crypto.randomUUID() } }),
  )
  return { status: res.status, body: await readJson(res) }
}

async function createAndJoin(name: string, matchLength: 1 | 3 | 5) {
  const stub = stubFor(name)
  await createRoom(stub, matchLength)
  const joined = await join(stub)
  expect(joined.seatIndex).toBe(1)
  expect(joined.status).toBe('active')
  const tokens: [string, string] = [ALICE, BOB]
  return { stub, tokens }
}

// ---------------------------------------------------------------------------
// ---- move selection: pick a RANDOM engine-legal action from the acting
// ---- seat's own redacted ClientView, using the engine's OWN getLegalActions
// ---------------------------------------------------------------------------

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T
}

const EMPTY_TOKEN_PILES = { diamond: [], gold: [], silver: [], cloth: [], spice: [], leather: [] }
const EMPTY_BONUS_PILES = { three: [], four: [], five: [] }

/**
 * `getLegalActions` only ever reads `state.phase`, `state.market`, and
 * `state.players[state.activePlayer].hand` (verified against
 * `src/engine/engine.ts`) — so the acting seat's own ClientView (its own
 * hand + the public market) is ALWAYS sufficient to enumerate its own legal
 * actions; it never needs the opponent's hand or the deck. The rest of this
 * dummy GameState is unused filler required only to satisfy the TS shape.
 */
function pickRandomLegalAction(mineView: any, rng: () => number): Action {
  const pseudoState: GameState = {
    phase: 'playing',
    round: 1,
    activePlayer: 0,
    market: mineView.game.market,
    deck: [],
    discard: [],
    revealedHands: [[], []],
    players: [
      { hand: mineView.game.myHand, herd: 0, tokens: [], bonusTokens: [] },
      { hand: [], herd: 0, tokens: [], bonusTokens: [] },
    ],
    tokens: EMPTY_TOKEN_PILES,
    bonusTokens: EMPTY_BONUS_PILES,
    seals: [0, 0],
  }
  const legal = getLegalActions(pseudoState)
  if (legal.length === 0) {
    throw new Error('pickRandomLegalAction: engine reports NO legal actions — should be unreachable in Jaipur')
  }
  const idx = Math.min(Math.floor(rng() * legal.length), legal.length - 1)
  return legal[idx]!
}

// ---------------------------------------------------------------------------
// ---- conservation helper ---------------------------------------------------
// ---------------------------------------------------------------------------

/** Total physical cards (market + deck + discard + both hands + both herds)
 *  — must always equal 55 (6+6+6+8+8+10+11, per `createDeck`). Token/bonus
 *  piles are NOT cards and are deliberately excluded. */
function countCards(state: GameState): number {
  return (
    state.market.length +
    state.deck.length +
    state.discard.length +
    state.players[0].hand.length +
    state.players[0].herd +
    state.players[1].hand.length +
    state.players[1].herd
  )
}

// ---------------------------------------------------------------------------
// ---- INDEPENDENT scoring oracle (hand-written, NOT src/engine/scoring.ts) -
// ---------------------------------------------------------------------------

const INDEPENDENT_CAMEL_TOKEN_VALUE = 5

type ScoringPlayer = { herd: number; tokens: { value: number }[]; bonusTokens: { value: number }[] }
type ScoringState = { players: [ScoringPlayer, ScoringPlayer] }

type OracleRoundResult = {
  camelWinner: 0 | 1 | null
  scores: [number, number]
  bonusTokenCounts: [number, number]
  sealAwardedTo: 0 | 1 | null
}

/**
 * A SECOND, independently-authored implementation of Jaipur's round-scoring
 * rules (camel-herd bonus, goods-token + bonus-token totals, and the 3-level
 * seal tiebreak: score -> bonus-token COUNT -> goods-token COUNT). Written
 * from the rulebook, not copy-pasted from `src/engine/scoring.ts#scoreRound`
 * — see the `describe('independent oracle self-check', ...)` block below for
 * hand-computed sanity cases that pin this function down BEFORE it's ever
 * used to judge a live fuzzed match.
 */
function independentScoreRound(state: ScoringState): OracleRoundResult {
  const [p0, p1] = state.players

  let camelWinner: 0 | 1 | null = null
  if (p0.herd > p1.herd) camelWinner = 0
  else if (p1.herd > p0.herd) camelWinner = 1

  const sumValues = (list: { value: number }[]) => {
    let total = 0
    for (const t of list) total += t.value
    return total
  }

  const score0 = sumValues(p0.tokens) + sumValues(p0.bonusTokens) + (camelWinner === 0 ? INDEPENDENT_CAMEL_TOKEN_VALUE : 0)
  const score1 = sumValues(p1.tokens) + sumValues(p1.bonusTokens) + (camelWinner === 1 ? INDEPENDENT_CAMEL_TOKEN_VALUE : 0)
  const scores: [number, number] = [score0, score1]

  const bonusTokenCounts: [number, number] = [p0.bonusTokens.length, p1.bonusTokens.length]

  let sealAwardedTo: 0 | 1 | null = null
  if (score0 > score1) sealAwardedTo = 0
  else if (score1 > score0) sealAwardedTo = 1
  else if (bonusTokenCounts[0] > bonusTokenCounts[1]) sealAwardedTo = 0
  else if (bonusTokenCounts[1] > bonusTokenCounts[0]) sealAwardedTo = 1
  else if (p0.tokens.length > p1.tokens.length) sealAwardedTo = 0
  else if (p1.tokens.length > p0.tokens.length) sealAwardedTo = 1
  // else: a genuine complete tie -> sealAwardedTo stays null

  return { camelWinner, scores, bonusTokenCounts, sealAwardedTo }
}

/** best-of-`matchLength` seal threshold: 1->1, 3->2, 5->3 (majority of the
 *  match's rounds). Independently pinned below against those three known
 *  constants, not just trusted because it's a one-liner shared with
 *  `do/apply.ts`. */
function sealsNeededFor(matchLength: 1 | 3 | 5): number {
  return Math.floor(matchLength / 2) + 1
}

describe('independent oracle self-check (hand-computed, never calls src/engine/scoring.ts)', () => {
  it('higher combined score wins outright (no bonus/camel involved)', () => {
    const r = independentScoreRound({
      players: [
        { herd: 3, tokens: [{ value: 5 }, { value: 5 }], bonusTokens: [] }, // 10
        { herd: 3, tokens: [{ value: 5 }], bonusTokens: [] }, // 5
      ],
    })
    expect(r.camelWinner).toBeNull() // herd tie (3 == 3) -> no camel bonus
    expect(r.scores).toEqual([10, 5])
    expect(r.sealAwardedTo).toBe(0)
  })

  it('the +5 camel-herd bonus can flip the outcome', () => {
    const r = independentScoreRound({
      players: [
        { herd: 2, tokens: [{ value: 4 }], bonusTokens: [] }, // 4, no camel bonus
        { herd: 5, tokens: [{ value: 6 }], bonusTokens: [] }, // 6 + 5 = 11
      ],
    })
    expect(r.camelWinner).toBe(1)
    expect(r.scores).toEqual([4, 11])
    expect(r.sealAwardedTo).toBe(1)
  })

  it('tiebreak level 1: equal score -> more bonus-token COUNT wins (not value)', () => {
    const r = independentScoreRound({
      players: [
        { herd: 0, tokens: [{ value: 10 }], bonusTokens: [{ value: 2 }, { value: 1 }] }, // 13, 2 bonus tokens
        { herd: 0, tokens: [{ value: 10 }], bonusTokens: [{ value: 3 }] }, // 13, 1 bonus token
      ],
    })
    expect(r.scores).toEqual([13, 13])
    expect(r.bonusTokenCounts).toEqual([2, 1])
    expect(r.sealAwardedTo).toBe(0)
  })

  it('tiebreak level 2: equal score AND equal bonus count -> more goods-token COUNT wins', () => {
    const r = independentScoreRound({
      players: [
        { herd: 0, tokens: [{ value: 3 }, { value: 2 }], bonusTokens: [] }, // 5, 2 goods tokens
        { herd: 0, tokens: [{ value: 5 }], bonusTokens: [] }, // 5, 1 goods token
      ],
    })
    expect(r.scores).toEqual([5, 5])
    expect(r.bonusTokenCounts).toEqual([0, 0])
    expect(r.sealAwardedTo).toBe(0)
  })

  it('a genuine complete tie (score, bonus count, AND goods count all equal) awards no seal', () => {
    const r = independentScoreRound({
      players: [
        { herd: 1, tokens: [{ value: 5 }], bonusTokens: [] },
        { herd: 1, tokens: [{ value: 5 }], bonusTokens: [] },
      ],
    })
    expect(r.sealAwardedTo).toBeNull()
  })

  it('sealsNeeded matches the known Jaipur best-of-N rule (1->1, 3->2, 5->3), independent of do/apply.ts', () => {
    expect(sealsNeededFor(1)).toBe(1) // a single round decides it
    expect(sealsNeededFor(3)).toBe(2) // best of 3 -> first to a majority of 2
    expect(sealsNeededFor(5)).toBe(3) // best of 5 -> first to a majority of 3
    // A round awards at most ONE seal (to at most one seat), so both seats
    // can never cross sealsNeeded in the same round — "seat 0 checked first"
    // in do/apply.ts's `newSeals[0] >= sealsNeeded ? 0 : 1` can never
    // misattribute a win away from seat 1 to seat 0.
  })
})

// ---------------------------------------------------------------------------
// ---- fuzz driver ------------------------------------------------------------
// ---------------------------------------------------------------------------

const NUM_MATCHES = 45
const MATCH_LENGTHS = [1, 3, 5] as const
const MAX_TURNS_PER_ROUND = 300
const MAX_ROUNDS_PER_MATCH = 20
const MATCH_TIMEOUT_MS = 45_000

const coverage = { matches: 0, rounds: 0, moves: 0 }

/** Deep-equality assertion that re-throws WITH the seed/move-log repro
 *  appended, so a CI/console failure is self-contained and reproducible via
 *  `mulberry32(seed)` + the printed move sequence. */
function assertDeepEqual(actual: unknown, expected: unknown, label: string, repro: () => string): void {
  try {
    expect(actual).toEqual(expected)
  } catch (e) {
    throw new Error(`DIVERGENCE (${label}): ${e instanceof Error ? e.message : String(e)}\n\n${repro()}`)
  }
}

async function runOneFuzzMatch(matchIndex: number, seed: number, matchLength: 1 | 3 | 5): Promise<void> {
  const rng = mulberry32(seed)
  const moveLog: { round: number; seatIndex: 0 | 1; action: Action }[] = []
  const repro = () =>
    `[fuzz repro] matchIndex=${matchIndex} seed=${seed} matchLength=${matchLength}\nmoveLog=${JSON.stringify(moveLog)}`

  const { stub, tokens } = await createAndJoin(`fuzz-oracle-${matchIndex}`, matchLength)
  let shadowSeals: [number, number] = [0, 0]

  for (let r = 0; r < MAX_ROUNDS_PER_MATCH; r++) {
    // Seed the shadow model from the DO's OWN persisted per-round replay
    // anchor (ADDENDUM G) — this is the one place the task explicitly allows
    // reading server-internal state to bootstrap a test oracle.
    const { meta, roundRow } = await runInDurableObject(stub, (_instance, state) => {
      const repo = new GameRepository(state.storage.sql as unknown as SqlLike)
      const m = repo.getMeta()!
      return { meta: m, roundRow: repo.getRound(m.round)! }
    })

    let shadowState: GameState = clone(roundRow.initialState)
    if (countCards(shadowState) !== 55) {
      throw new Error(`conservation violated at deal: ${countCards(shadowState)} != 55 — ${repro()}`)
    }

    let endView: any = null
    for (let turn = 0; turn < MAX_TURNS_PER_ROUND; turn++) {
      const probe = await sync(stub, tokens[0])
      expect(probe.status).toBe(200)
      if (probe.body.view.phase !== 'playing') {
        endView = probe.body.view
        break
      }

      const activeSeat = probe.body.view.game.activePlayer as 0 | 1
      const mineView = activeSeat === 0 ? probe.body.view : (await sync(stub, tokens[1])).body.view
      const action = pickRandomLegalAction(mineView, rng)
      moveLog.push({ round: meta.round, seatIndex: activeSeat, action })

      // Shadow-apply the SAME action via the engine's own applyAction, in
      // lockstep with the server, BEFORE submitting it — a divergence here
      // means the action we picked wasn't actually legal against our tracked
      // shadow state (a bug in the fuzzer's bookkeeping, not the server).
      const shadowResult = applyAction(shadowState, action)
      if (!shadowResult.ok) {
        throw new Error(`shadow model rejected its own chosen legal move (${shadowResult.error.code}) — ${repro()}`)
      }
      shadowState = shadowResult.value

      const result = await move(stub, tokens[activeSeat], activeSeat, action)
      if (result.status !== 200) {
        throw new Error(
          `DIVERGENCE: server REJECTED a move the engine/oracle considered legal ` +
            `(status=${result.status} body=${JSON.stringify(result.body)}) — ${repro()}`,
        )
      }
    }
    if (endView === null) {
      throw new Error(`round exceeded ${MAX_TURNS_PER_ROUND}-turn cap without ending — ${repro()}`)
    }

    coverage.rounds++
    if (endView.lastRoundResult === null) {
      throw new Error(`round ended but lastRoundResult is null — ${repro()}`)
    }

    // The server's just-ended round snapshot (still the engine's raw
    // 'round-end' phase state — dealRound for the NEXT round hasn't
    // overwritten it yet).
    const serverSnap = await runInDurableObject(
      stub,
      (_instance, state) => new GameRepository(state.storage.sql as unknown as SqlLike).getSnapshot()!,
    )

    // ---- (4b) replay determinism: rounds.initial_state + the exact actions
    // we submitted for THIS round, replayed via the engine, reproduces the
    // server's persisted round-end snapshot byte-for-byte.
    const roundActions = moveLog.filter((m) => m.round === meta.round).map((m) => m.action)
    let replayState: GameState = clone(roundRow.initialState)
    for (const a of roundActions) {
      const rr = applyAction(replayState, a)
      if (!rr.ok) throw new Error(`replay divergence (${rr.error.code}) mid-round — ${repro()}`)
      replayState = rr.value
    }
    assertDeepEqual(replayState, serverSnap, 'replay(rounds.initial_state + submitted moves) vs server snapshot', repro)
    assertDeepEqual(shadowState, serverSnap, 'incrementally-tracked shadow state vs server snapshot', repro)

    // ---- (4a, per-round) conservation at round end.
    if (countCards(serverSnap) !== 55) {
      throw new Error(`conservation violated at round end: ${countCards(serverSnap)} != 55 — ${repro()}`)
    }

    // ---- (3) INDEPENDENT scoring oracle vs the server's reported result.
    const oracle = independentScoreRound(serverSnap)
    if (endView.lastRoundResult.camelWinner !== oracle.camelWinner) {
      throw new Error(
        `DIVERGENCE camelWinner: server=${endView.lastRoundResult.camelWinner} oracle=${oracle.camelWinner} — ${repro()}`,
      )
    }
    assertDeepEqual(endView.lastRoundResult.scores, oracle.scores, 'scores', repro)
    assertDeepEqual(endView.lastRoundResult.bonusTokenCounts, oracle.bonusTokenCounts, 'bonusTokenCounts', repro)
    if (endView.lastRoundResult.sealAwardedTo !== oracle.sealAwardedTo) {
      throw new Error(
        `DIVERGENCE sealAwardedTo: server=${endView.lastRoundResult.sealAwardedTo} oracle=${oracle.sealAwardedTo} — ${repro()}`,
      )
    }

    // ---- independent seals/match-winner bookkeeping.
    if (oracle.sealAwardedTo !== null) {
      shadowSeals = [
        shadowSeals[0] + (oracle.sealAwardedTo === 0 ? 1 : 0),
        shadowSeals[1] + (oracle.sealAwardedTo === 1 ? 1 : 0),
      ]
    }
    assertDeepEqual(endView.seals, shadowSeals, 'seals', repro)

    const sealsNeeded = sealsNeededFor(matchLength)
    const expectMatchOver = shadowSeals[0] >= sealsNeeded || shadowSeals[1] >= sealsNeeded
    const expectedPhase = expectMatchOver ? 'match_over' : 'round_end'
    if (endView.phase !== expectedPhase) {
      throw new Error(`DIVERGENCE phase: server=${endView.phase} oracle=${expectedPhase} — ${repro()}`)
    }

    if (expectMatchOver) {
      const expectedWinner = shadowSeals[0] >= sealsNeeded ? 0 : 1
      if (endView.winnerSeat !== expectedWinner) {
        throw new Error(`DIVERGENCE winnerSeat: server=${endView.winnerSeat} oracle=${expectedWinner} — ${repro()}`)
      }

      await assertWholeMatchInvariants(stub, meta.round, repro)
      coverage.matches++
      coverage.moves += moveLog.length
      return
    }

    const nr = await stub.fetch(req('/next-round', { token: tokens[0], body: {} }))
    if (nr.status !== 200) throw new Error(`/next-round failed with status=${nr.status} — ${repro()}`)
  }
  throw new Error(`match exceeded ${MAX_ROUNDS_PER_MATCH}-round cap without ending — ${repro()}`)
}

/** Whole-match invariants (4a full sweep, 4c, 4d), asserted once the match
 *  has reached `match_over`. */
async function assertWholeMatchInvariants(
  stub: ReturnType<typeof stubFor>,
  finalRound: number,
  repro: () => string,
): Promise<void> {
  // 4a: total-card conservation across EVERY round's persisted initial deal.
  for (let r = 1; r <= finalRound; r++) {
    const rr = await runInDurableObject(
      stub,
      (_instance, state) => new GameRepository(state.storage.sql as unknown as SqlLike).getRound(r)!,
    )
    const n = countCards(rr.initialState)
    if (n !== 55) throw new Error(`4a: round ${r}'s initial_state has ${n} cards, expected 55 — ${repro()}`)
  }

  const allMoves = await runInDurableObject(
    stub,
    (_instance, state) => new GameRepository(state.storage.sql as unknown as SqlLike).getMovesSince(0),
  )

  // 4c: move_index is a gapless, strictly increasing sequence starting at 1.
  for (let k = 0; k < allMoves.length; k++) {
    const expectedIndex = k + 1
    if (allMoves[k]!.move_index !== expectedIndex) {
      throw new Error(
        `4c: move_index gap at position ${k}: got ${allMoves[k]!.move_index}, expected ${expectedIndex} — ${repro()}`,
      )
    }
  }

  // 4d: every move (real action or server-minted lifecycle event) carries
  // only the TRANSLATED PUBLIC payload — never raw marketIndices/handIndices
  // or the raw deck array. In THIS fuzzer's matches (both seats always
  // human + present, no timers advanced) no by_ai/floor move is ever
  // produced, so this also doubles as a check that no zombie AI-cover fired.
  for (const m of allMoves) {
    if (m.by_ai) {
      throw new Error(`unexpected by_ai=true move ${m.move_index} in a fuzz match with 2 always-present humans — ${repro()}`)
    }
    if (m.payload.includes('marketIndex') || m.payload.includes('handIndex') || m.payload.includes('"deck"')) {
      throw new Error(`4d: move ${m.move_index} (${m.type}) payload leaks a raw index/deck field: ${m.payload} — ${repro()}`)
    }
  }
}

describe('fuzz oracle — full matches vs an independent Jaipur rules oracle', () => {
  for (let i = 0; i < NUM_MATCHES; i++) {
    const seed = 1_000_003 + i * 7919 // deterministic per loop index -> reproducible via mulberry32(seed)
    const matchLength = MATCH_LENGTHS[i % MATCH_LENGTHS.length]!
    it(
      `match #${i} (seed=${seed}, matchLength=${matchLength}) matches the independent oracle end-to-end`,
      async () => {
        await runOneFuzzMatch(i, seed, matchLength)
      },
      MATCH_TIMEOUT_MS,
    )
  }

  it('aggregate fuzz coverage is non-trivial', () => {
    expect(coverage.matches).toBe(NUM_MATCHES)
    expect(coverage.rounds).toBeGreaterThanOrEqual(NUM_MATCHES)
    expect(coverage.moves).toBeGreaterThan(0)
    // eslint-disable-next-line no-console
    console.log(
      `[fuzz-oracle] matches=${coverage.matches} rounds=${coverage.rounds} moves=${coverage.moves} ` +
        `(matchLengths cycled 1/3/5, seed=1_000_003 + i*7919)`,
    )
  })
})

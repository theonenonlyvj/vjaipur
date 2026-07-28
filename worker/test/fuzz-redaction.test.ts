import { env, runInDurableObject } from 'cloudflare:test'
import { describe, beforeAll, expect, it } from 'vitest'
import { applyAction, getLegalActions, type Action, type GameState } from '../../src/engine'
import { mulberry32 } from '../../src/shared/rng'
import { GameRepository, type MetaRow, type SqlLike } from '../src/do/storage'
import type { ClientMove, ClientView } from '../src/do/view'
import { applyD1Schema } from './helpers'

/**
 * REDACTION DEEP-FUZZ — many seeded random 2-HUMAN matches, driven entirely
 * through the real HTTP-shaped surface (`stub.fetch`), asserting that across
 * EVERY step of EVERY game, NO payload the server ever sends a client leaks
 * hidden information: the opponent's hand card ids, the deck's contents/
 * order, the round seed, the opponent's bonus-token face VALUES, or the
 * opponent's running score before it publishes at round_end.
 *
 * `runInDurableObject` is used ONLY as a ground-truth oracle (reading the
 * DO's own SQLite directly, per `test/online-flow.test.ts`'s REDACTION
 * block) and to force the AI-cover/floor-move + reclaim paths deterministically
 * (`instance.alarm({isRetry:true})`, mirroring `test/presence.test.ts`'s own
 * calling convention) — never to bypass the real client-facing surface for
 * anything this fuzz is actually verifying.
 *
 * Harness (stubFor/req/move/sync/createAndJoin) is duplicated from
 * `test/online-flow.test.ts` per the task brief (own file, edits nothing
 * else) — same pattern already used by `test/fuzz-races.test.ts` and
 * `test/fuzz-oracle.test.ts`.
 *
 * ---- Why "deep-scan for hidden ids" needs care (read before touching) ----
 *
 * Card ids are round-scoped (src/engine/setup.ts's `createDeck` restarts
 * `id` at 0 every round), so a blind "does this id appear ANYWHERE in the
 * full /sync?since=0 history" check would false-positive across DIFFERENT
 * rounds reusing the same small id numbers. Every hidden-id check below is
 * therefore scoped to the CURRENT round's own move log.
 *
 * Within one round, a card that is CURRENTLY in the deck can never have
 * appeared publicly before (cards only ever leave the deck — market refills
 * shift() the deck, nothing ever shifts back in), so deck-id leak checks are
 * safe to run against the round's ENTIRE history with zero legitimate
 * exceptions.
 *
 * Opponent HAND cards are different: real Jaipur legitimately reveals a
 * card's identity the moment it passes through the market (ADDENDUM H —
 * `takenCard`/`takenCards`/`givenGoods`/`cards` are intentionally public), so
 * a card that was taken from the market earlier this round and later ends up
 * in the opponent's hand via a further exchange is NOT a leak even though
 * its id legitimately appears in an earlier move payload. This fuzz
 * therefore excludes any id that has already been revealed via a real move
 * payload THIS round (`extractPublicCardIds`, mirroring do/publicPayload.ts's
 * own translation) before flagging the remaining opponent-hand ids as
 * currently hidden.
 *
 * Numeric scans are also scoped by SHAPE, not raw substrings, to avoid
 * coincidental collisions: `collectCardIds` only counts a number as a
 * candidate card-id leak when it sits in the `id` field of an actual
 * `{id, type}`-shaped object (a bare `deckCount`/`quantity`/`moveIndex` that
 * happens to numerically equal some hidden card id is not a leak). Bonus
 * token VALUES are checked structurally instead (oppBonusTokens[i] must have
 * ONLY a `tier` key) rather than numerically, because bonus values are small
 * (1-10) and collide constantly with unrelated public counters/quantities/
 * tiers — a numeric scan there would be too noisy to be meaningful. The
 * round seed, by contrast, is a full 32-bit random value, so a blanket
 * "does this number appear anywhere" scan is safe (collision probability is
 * astronomically low) and is checked both structurally and as a raw
 * substring.
 */

// ---------------------------------------------------------------------------
// ---- harness (duplicated + adapted from online-flow.test.ts) --------------
// ---------------------------------------------------------------------------

const DB = () => (env as unknown as { DB: D1Database }).DB

beforeAll(async () => {
  await applyD1Schema(DB())
})

let stubCounter = 0
function stubFor(name: string) {
  return env.GAME_DO.get(env.GAME_DO.idFromName(`redact-fuzz-${name}-${stubCounter++}`))
}
type DOStub = ReturnType<typeof stubFor>

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

async function createRoom(stub: DOStub, matchLength: 1 | 3 | 5, token: string) {
  const res = await stub.fetch(req('/games', { token, body: { matchLength } }))
  expect(res.status).toBe(201)
  return readJson(res)
}

async function join(stub: DOStub, token: string) {
  return readJson(await stub.fetch(req('/join', { token, body: {} })))
}

async function sync(stub: DOStub, token: string, since = 0) {
  const res = await stub.fetch(req(`/sync?since=${since}`, { token, method: 'GET' }))
  return { status: res.status, body: await readJson(res) }
}

async function move(stub: DOStub, token: string, seatIndex: 0 | 1, action: Action) {
  const res = await stub.fetch(
    req('/move', { token, body: { seatIndex, move: action, clientMoveId: crypto.randomUUID() } }),
  )
  return { status: res.status, body: await readJson(res) }
}

/** Create + join a fresh 2-human game; Alice = seat 0, Bob = seat 1. */
async function createAndJoin(name: string, matchLength: 1 | 3 | 5, aliceToken: string, bobToken: string): Promise<DOStub> {
  const stub = stubFor(name)
  await createRoom(stub, matchLength, aliceToken)
  const joined = await join(stub, bobToken)
  expect(joined.seatIndex).toBe(1)
  expect(joined.status).toBe('active')
  return stub
}

// ---------------------------------------------------------------------------
// ---- deterministic move selection ------------------------------------------
// ---------------------------------------------------------------------------

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!
}

function shuffleWithRng<T>(arr: readonly T[], rng: () => number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Build a handful of syntactically-plausible TAKE_EXCHANGE candidates from
 * ground truth and keep only the ones the certified (pure, side-effect-free)
 * local engine itself accepts — `applyAction` never mutates its input, so
 * this is a safe dry-run oracle rather than a hand-reimplementation of every
 * engine legality rule (marketIndices >= 2, no same-type give-back, herd/
 * camel accounting, post-hand-limit, etc — see src/engine/engine.ts's
 * `takeExchange`). `getLegalActions` deliberately never enumerates exchanges
 * itself (its own comment: "the combinatorial space ... is too large"), so
 * this fuzzer needs its own generator to exercise that leak-prone path at
 * all.
 */
function buildExchangeCandidates(state: GameState, rng: () => number): Action[] {
  const player = state.players[state.activePlayer]
  const nonCamelMarket = state.market.map((c, i) => ({ c, i })).filter((x) => x.c.type !== 'camel')
  if (nonCamelMarket.length < 2) return []

  const out: Action[] = []
  for (let attempt = 0; attempt < 8; attempt++) {
    const maxK = Math.min(nonCamelMarket.length, 4)
    const k = 2 + Math.floor(rng() * Math.max(1, maxK - 1))
    const chosenMarket = shuffleWithRng(nonCamelMarket, rng).slice(0, Math.min(k, nonCamelMarket.length))
    if (chosenMarket.length < 2) continue
    const takenTypes = new Set(chosenMarket.map((x) => x.c.type))

    const eligibleHandIdx = player.hand.map((c, i) => ({ c, i })).filter((x) => !takenTypes.has(x.c.type))
    const maxCamels = Math.min(player.herd, chosenMarket.length)

    for (let camelsUsed = maxCamels; camelsUsed >= 0; camelsUsed--) {
      const needFromHand = chosenMarket.length - camelsUsed
      if (needFromHand < 0 || eligibleHandIdx.length < needFromHand) continue
      const handPick = shuffleWithRng(eligibleHandIdx, rng).slice(0, needFromHand)
      const handIndices = shuffleWithRng([...handPick.map((x) => x.i), ...Array(camelsUsed).fill(-1)], rng)
      const action: Action = {
        type: 'TAKE_EXCHANGE',
        marketIndices: chosenMarket.map((x) => x.i),
        handIndices,
      }
      if (applyAction(state, action).ok) {
        out.push(action)
        break
      }
    }
  }
  return out
}

/** Pick one legal action, deterministically (given `rng`), weighting toward
 *  TAKE_EXCHANGE often enough that the fuzz genuinely exercises that
 *  leak-prone path rather than it being a rare accident. */
function pickAction(state: GameState, rng: () => number): Action {
  const legal = getLegalActions(state)
  const exchanges = buildExchangeCandidates(state, rng)
  const pool = exchanges.length > 0 && rng() < 0.4 ? exchanges : [...legal, ...exchanges]
  if (pool.length === 0) throw new Error('pickAction: no legal action available (engine invariant violated)')
  return pick(rng, pool)
}

// ---------------------------------------------------------------------------
// ---- ground truth (read directly off the DO's own SQLite) -----------------
// ---------------------------------------------------------------------------

type Truth = { meta: MetaRow; snapshot: GameState; seed: number }

async function readTruth(stub: DOStub): Promise<Truth> {
  return runInDurableObject(stub, (_instance, state) => {
    const sql = state.storage.sql as unknown as SqlLike
    const repo = new GameRepository(sql)
    const meta = repo.getMeta()
    if (!meta) throw new Error('readTruth: DO has no meta row yet')
    const snapshot = repo.getSnapshot()
    if (!snapshot) throw new Error('readTruth: DO has no snapshot yet')
    const round = repo.getRound(meta.round)
    if (!round) throw new Error(`readTruth: no rounds row for round ${meta.round}`)
    return { meta, snapshot, seed: round.seed }
  })
}

/** Card ids a translated move payload legitimately reveals — the SAME fields
 *  do/publicPayload.ts's `toPublicPayload` computes, read back structurally
 *  so this fuzz's "what's legitimately public" notion tracks the real
 *  translation rather than a hand-guessed copy of it. */
function extractPublicCardIds(m: { type: string; payload: unknown }): number[] {
  const p = m.payload as Record<string, unknown> | null
  if (!p) return []
  switch (m.type) {
    case 'TAKE_SINGLE': {
      const c = p.takenCard as { id?: number } | undefined
      return typeof c?.id === 'number' ? [c.id] : []
    }
    case 'TAKE_EXCHANGE': {
      const taken = (Array.isArray(p.takenCards) ? p.takenCards : []) as { id: number }[]
      const given = (Array.isArray(p.givenGoods) ? p.givenGoods : []) as { id: number }[]
      return [...taken.map((c) => c.id), ...given.map((c) => c.id)]
    }
    case 'SELL': {
      const cards = (Array.isArray(p.cards) ? p.cards : []) as { id: number }[]
      return cards.map((c) => c.id)
    }
    default:
      return [] // TAKE_CAMELS/round_start/round_end/resign carry no card ids
  }
}

// ---------------------------------------------------------------------------
// ---- structural (closed-allowlist) redaction checks ------------------------
// ---------------------------------------------------------------------------

const GAME_ALLOWED_KEYS = [
  'activePlayer',
  'bonusTokenCounts',
  'deckCount',
  'herds',
  'market',
  'myBonusTokens',
  'myGoodsTokens',
  'myHand',
  'myScore',
  'oppBonusTokens',
  'oppGoodsTokenCount',
  'oppHandCount',
  'tokens',
].sort()

function assertCardShape(c: unknown, label: string): void {
  expect(!!c && typeof c === 'object', `${label}: not a card object`).toBe(true)
  expect(Object.keys(c as object).sort(), `${label}: card has unexpected keys`).toEqual(['id', 'type'])
}

function assertViewShape(view: ClientView, label: string): void {
  expect(Object.keys(view.game).sort(), `${label}: view.game closed-allowlist violated (ADDENDUM I)`).toEqual(
    GAME_ALLOWED_KEYS,
  )
  for (const [i, t] of view.game.oppBonusTokens.entries()) {
    expect(Object.keys(t), `${label}: oppBonusTokens[${i}] is leaking a value field`).toEqual(['tier'])
  }
  if (view.phase === 'playing') {
    expect(view.lastRoundResult, `${label}: lastRoundResult must be null mid-round (scores are private)`).toBeNull()
    // BUG 1 fix (2026-07-27) invariant: lastRoundReveal (the round-end
    // opponent-goods reveal — see do/view.ts's ClientView docstring) must
    // stay null for the entire duration of an in-progress round, same gate
    // as lastRoundResult.
    expect(view.lastRoundReveal, `${label}: lastRoundReveal must be null mid-round`).toBeNull()
  }
  // At round_end/match_over, lastRoundReveal's bonusPoints are plain summed
  // numbers (never individual bonus token values — the structural
  // oppBonusTokens[i] check above already proves that array itself never
  // carries a value key) so there is nothing further to assert here beyond
  // the null-mid-round gate; the numeric ground-truth scans below never
  // mistake a bonusPoints sum for a hidden card id (collectCardIds only
  // counts a number sitting in an actual `{id,type}` shape's `id` field).
  view.game.myHand.forEach((c, i) => assertCardShape(c, `${label}.myHand[${i}]`))
  view.game.market.forEach((c, i) => assertCardShape(c, `${label}.market[${i}]`))
}

const MOVE_PAYLOAD_ALLOWED_KEYS: Record<string, string[]> = {
  TAKE_SINGLE: ['type', 'takenCard'],
  TAKE_CAMELS: ['type', 'count'],
  TAKE_EXCHANGE: ['type', 'takenCards', 'givenGoods', 'camelsGiven'],
  SELL: ['type', 'good', 'cards', 'count', 'bonusTier'],
  round_start: ['type', 'round'],
  round_end: ['type', 'result', 'seals'],
  resign: ['type', 'seat'],
}

function assertMovePayloadShape(m: ClientMove, label: string): void {
  const tag = `${label} move#${m.moveIndex}(${m.type}${m.byAi ? ',byAi' : ''})`
  const allowed = MOVE_PAYLOAD_ALLOWED_KEYS[m.type]
  expect(allowed, `${tag}: unrecognized move type`).toBeDefined()
  const payload = m.payload as Record<string, unknown>
  for (const k of Object.keys(payload)) {
    expect(allowed!.includes(k), `${tag}: unexpected payload key "${k}" — possible leak (e.g. raw handIndices)`).toBe(
      true,
    )
  }
  switch (m.type) {
    case 'TAKE_SINGLE':
      assertCardShape(payload.takenCard, `${tag}.takenCard`)
      break
    case 'TAKE_EXCHANGE':
      ;((payload.takenCards as unknown[]) ?? []).forEach((c, i) => assertCardShape(c, `${tag}.takenCards[${i}]`))
      ;((payload.givenGoods as unknown[]) ?? []).forEach((c, i) => assertCardShape(c, `${tag}.givenGoods[${i}]`))
      break
    case 'SELL':
      ;((payload.cards as unknown[]) ?? []).forEach((c, i) => assertCardShape(c, `${tag}.cards[${i}]`))
      break
  }
}

/** Literal field names that must NEVER appear in ANY server->client payload,
 *  full stop — no legitimate exception, ever. Defense in depth beyond the
 *  structural checks above, in case a stray extra field creeps in outside
 *  the shapes checked there. */
const BANNED_LITERAL_KEYS = [
  '"oppHand"',
  '"deck"',
  '"oppGoodsTokens"',
  '"oppScore"',
  '"handIndices"',
  '"marketIndices"',
  '"revealedHands"',
  '"seed"',
]

function assertNoBannedKeys(raw: string, label: string): void {
  for (const k of BANNED_LITERAL_KEYS) {
    expect(raw.includes(k), `${label}: banned field ${k} present in payload`).toBe(false)
  }
}

// ---------------------------------------------------------------------------
// ---- numeric ground-truth scans --------------------------------------------
// ---------------------------------------------------------------------------

/** Every number that appears as the `id` of an actual `{id, type}`-shaped
 *  Card object anywhere in the tree — deliberately NOT every bare number (a
 *  bare moveIndex/round/deckCount/quantity/tier that happens to numerically
 *  equal some hidden card id is coincidence, not a leak; only a value
 *  sitting where a real Card's `id` would is meaningful). */
function collectCardIds(value: unknown, out: Set<number> = new Set()): Set<number> {
  if (Array.isArray(value)) {
    for (const v of value) collectCardIds(v, out)
  } else if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (typeof obj.id === 'number' && typeof obj.type === 'string') out.add(obj.id)
    for (const v of Object.values(obj)) collectCardIds(v, out)
  }
  return out
}

/** Every bare number anywhere in the tree — used ONLY for the round seed
 *  (see file header for why a blanket scan is safe there but not for card
 *  ids/bonus values). */
function collectAllNumbers(value: unknown, out: Set<number> = new Set()): Set<number> {
  if (typeof value === 'number' && Number.isFinite(value)) out.add(value)
  else if (Array.isArray(value)) for (const v of value) collectAllNumbers(v, out)
  else if (value && typeof value === 'object') for (const v of Object.values(value as object)) collectAllNumbers(v, out)
  return out
}

type CheckedResponse = { view: ClientView; moves?: ClientMove[] }

function checkPayload(
  resp: CheckedResponse,
  hiddenCardIds: ReadonlySet<number>,
  seed: number,
  currentRound: number,
  label: string,
): void {
  assertViewShape(resp.view, label)
  const raw = JSON.stringify(resp)
  assertNoBannedKeys(raw, label)

  const allMoves = resp.moves ?? []
  for (const m of allMoves) assertMovePayloadShape(m, label) // shape check applies regardless of round

  // The card-id leak scan MUST be scoped to the CURRENT round's own view +
  // moves: a `since=0` response also carries every PAST round's moves, and
  // those legitimately reuse the same small id numbers (src/engine/setup.ts
  // resets `id` to 0 on every `createDeck()`/round) — scanning them here
  // would false-positive on pure numeric coincidence, not a real leak (see
  // file header).
  const thisRoundMoves = allMoves.filter((m) => m.round === currentRound)
  const foundCardIds = collectCardIds({ view: resp.view, moves: thisRoundMoves })
  const leaked = [...hiddenCardIds].filter((id) => foundCardIds.has(id))
  expect(leaked, `${label}: LEAK — hidden card id(s) present in payload: ${JSON.stringify(leaked)}`).toEqual([])

  // The seed check is safe across the WHOLE response, past rounds included
  // — a seed is never legitimately emitted for ANY round, ever, so there is
  // no analogous cross-round exclusion needed here.
  expect(
    collectAllNumbers(resp).has(seed),
    `${label}: LEAK — round seed ${seed} present as a structured number`,
  ).toBe(false)
  expect(raw.includes(String(seed)), `${label}: LEAK — round seed ${seed} present as a substring`).toBe(false)
}

// ---------------------------------------------------------------------------
// ---- per-step orchestration -------------------------------------------------
// ---------------------------------------------------------------------------

type Stats = {
  steps: number
  exchangeMoves: number
  floorMoves: number
  roundEnds: number
  matchOvers: number
  reclaims: number
}

function hiddenSetFor(truth: Truth, seatIndex: 0 | 1, revealedThisRound: ReadonlySet<number>): Set<number> {
  const oppIndex = seatIndex === 0 ? 1 : 0
  const hiddenDeck = truth.snapshot.deck.map((c) => c.id)
  const hiddenOppHand = truth.snapshot.players[oppIndex].hand.map((c) => c.id).filter((id) => !revealedThisRound.has(id))
  return new Set<number>([...hiddenDeck, ...hiddenOppHand])
}

/**
 * The core per-step probe. For BOTH seats, fetches /sync via BOTH since=0
 * (the full replay log) and since=<cursor> (the incremental tail), plus any
 * directly-returned view from the action that just happened (a /move,
 * /reclaim, or /next-round response body — those carry a `view` but no
 * `moves` array of their own), and deep-scans every one of them against
 * ground truth. Returns the new sinceCursor (the post-step moveIndex).
 */
async function checkStep(
  stub: DOStub,
  tokens: [string, string],
  sinceCursor: number,
  label: string,
  stats: Stats,
  extraViews: ClientView[] = [],
): Promise<number> {
  const truth = await readTruth(stub)

  const full0 = await sync(stub, tokens[0], 0)
  const full1 = await sync(stub, tokens[1], 0)
  expect(full0.status, `${label}: sync(seat0,since=0) failed`).toBe(200)
  expect(full1.status, `${label}: sync(seat1,since=0) failed`).toBe(200)

  const roundMoves = (full0.body.moves as ClientMove[]).filter((m) => m.round === truth.meta.round)
  const revealedThisRound = new Set<number>()
  for (const m of roundMoves) for (const id of extractPublicCardIds(m)) revealedThisRound.add(id)

  const since0 = await sync(stub, tokens[0], sinceCursor)
  const since1 = await sync(stub, tokens[1], sinceCursor)

  const fulls = [full0, full1] as const
  const sinces = [since0, since1] as const

  for (const seatIndex of [0, 1] as const) {
    const hidden = hiddenSetFor(truth, seatIndex, revealedThisRound)
    checkPayload(fulls[seatIndex].body, hidden, truth.seed, truth.meta.round, `${label} seat${seatIndex} since=0`)
    checkPayload(
      sinces[seatIndex].body,
      hidden,
      truth.seed,
      truth.meta.round,
      `${label} seat${seatIndex} since=${sinceCursor}`,
    )
  }

  for (const m of (sinces[0].body.moves as ClientMove[] | undefined) ?? []) {
    if (m.type === 'TAKE_EXCHANGE') stats.exchangeMoves++
    if (m.byAi) stats.floorMoves++
    if (m.type === 'round_end') stats.roundEnds++
  }

  for (const v of extraViews) {
    const seatIndex = v.mySeat as 0 | 1
    const hidden = hiddenSetFor(truth, seatIndex, revealedThisRound)
    checkPayload({ view: v }, hidden, truth.seed, truth.meta.round, `${label} seat${seatIndex} direct-response`)
  }

  if (truth.meta.phase === 'match_over') stats.matchOvers++
  stats.steps++
  return truth.meta.move_index
}

// ---------------------------------------------------------------------------
// ---- the fuzz itself --------------------------------------------------------
// ---------------------------------------------------------------------------

const N_GAMES = 32
const MAX_ROUNDS_PER_MATCH = 12
const MAX_TURNS_PER_ROUND = 300
const FLOOR_INJECTION_PROB = 0.12
const MATCH_LENGTHS = [1, 3, 5] as const

/** One full seeded random 2-human match, deep-scanned at every step. Uses
 *  `mulberry32(gameIndex-derived seed)` for ALL of this fuzz's own move-
 *  selection/floor-injection randomness, so a failure is reproducible by
 *  re-running with the same `gameIndex` (the actual card shuffle is still
 *  server-side `crypto.getRandomValues`-seeded per round — ground truth is
 *  read fresh from the DO at every step regardless, so that never matters for
 *  reproducing a genuine redaction bug, only for the exact move sequence). */
async function runFuzzGame(gameIndex: number, stats: Stats): Promise<{ rounds: number; matchLength: 1 | 3 | 5 }> {
  const rng = mulberry32((gameIndex + 1) * 2654435761)
  const matchLength = MATCH_LENGTHS[gameIndex % 3]!
  const alice = `test:acct-redact-${gameIndex}-alice:Alice${gameIndex}`
  const bob = `test:acct-redact-${gameIndex}-bob:Bob${gameIndex}`
  const stub = await createAndJoin(`g${gameIndex}`, matchLength, alice, bob)
  const tokens: [string, string] = [alice, bob]

  let sinceCursor = await checkStep(stub, tokens, 0, `game=${gameIndex} ml=${matchLength} initial-deal`, stats)

  let roundsPlayed = 0
  for (let round = 0; round < MAX_ROUNDS_PER_MATCH; round++) {
    roundsPlayed = round + 1

    let turnsThisRound = 0
    for (; turnsThisRound < MAX_TURNS_PER_ROUND; turnsThisRound++) {
      const truthBefore = await readTruth(stub)
      if (truthBefore.meta.phase !== 'playing') break

      const useFloor = rng() < FLOOR_INJECTION_PROB
      const seat = truthBefore.meta.current_seat as 0 | 1
      const label = `game=${gameIndex} ml=${matchLength} round=${round} turn=${turnsThisRound}${
        useFloor ? ' floor-AI' : ''
      } seat=${seat}`
      let directView: ClientView | null = null

      if (useFloor) {
        // Force this seat AI-covered, then invoke the SAME CPU-kill-floor
        // alarm path production code takes on a retry (game-do.ts's
        // `alarm({isRetry:true})` -> `applyFloor`) — mirrors
        // test/presence.test.ts's own calling convention for this.
        await runInDurableObject(stub, (_instance, state) => {
          new GameRepository(state.storage.sql as unknown as SqlLike).setControlledByAi(seat, true)
        })
        await runInDurableObject(stub, (instance) => instance.alarm({ isRetry: true }))
      } else {
        const action = pickAction(truthBefore.snapshot, rng)
        const res = await move(stub, tokens[seat], seat, action)
        expect(res.status, `${label}: move ${JSON.stringify(action)} rejected: ${JSON.stringify(res.body)}`).toBe(200)
        directView = res.body.view as ClientView
      }

      sinceCursor = await checkStep(stub, tokens, sinceCursor, label, stats, directView ? [directView] : [])

      if (useFloor) {
        // Exercise /reclaim too — the seat takes itself back from AI cover;
        // its redacted view must stay just as clean.
        const rec = await stub.fetch(req('/reclaim', { token: tokens[seat], body: {} }))
        expect(rec.status, `${label}: /reclaim failed`).toBe(200)
        const recBody = await readJson(rec)
        stats.reclaims++
        sinceCursor = await checkStep(stub, tokens, sinceCursor, `${label} reclaim`, stats, [recBody.view as ClientView])
      }

      const after = await readTruth(stub)
      if (after.meta.phase !== 'playing') break
    }

    const meta = (await readTruth(stub)).meta
    if (meta.phase === 'match_over') break
    expect(
      meta.phase,
      `game=${gameIndex}: round ${round} never reached round_end/match_over within ${MAX_TURNS_PER_ROUND} turns`,
    ).toBe('round_end')

    const nr = await stub.fetch(req('/next-round', { token: tokens[0], body: {} }))
    expect(nr.status, `game=${gameIndex}: /next-round failed`).toBe(200)
    sinceCursor = await checkStep(
      stub,
      tokens,
      sinceCursor,
      `game=${gameIndex} ml=${matchLength} round=${round} next-round`,
      stats,
    )
  }

  return { rounds: roundsPlayed, matchLength }
}

describe('REDACTION deep-fuzz (many seeded random 2-human matches)', () => {
  it(
    `fuzzes ${N_GAMES} seeded random matches and deep-scans every server->client payload for hidden info`,
    async () => {
      const stats: Stats = { steps: 0, exchangeMoves: 0, floorMoves: 0, roundEnds: 0, matchOvers: 0, reclaims: 0 }
      const summaries: string[] = []

      for (let g = 0; g < N_GAMES; g++) {
        const { rounds, matchLength } = await runFuzzGame(g, stats)
        summaries.push(`g${g}(ml=${matchLength}):${rounds}r`)
      }

      // eslint-disable-next-line no-console
      console.log(
        `[fuzz-redaction] games=${N_GAMES} steps=${stats.steps} exchangeMoves=${stats.exchangeMoves} ` +
          `floorMoves=${stats.floorMoves} roundEnds=${stats.roundEnds} matchOvers=${stats.matchOvers} ` +
          `reclaims=${stats.reclaims}\n${summaries.join(' ')}`,
      )

      // Coverage sanity: prove the leak-prone paths were actually exercised,
      // not just theoretically attempted.
      expect(stats.exchangeMoves, 'coverage gap: never exercised a single TAKE_EXCHANGE move').toBeGreaterThan(0)
      expect(stats.floorMoves, 'coverage gap: never exercised a single AI-cover/floor move').toBeGreaterThan(0)
      expect(stats.roundEnds, 'coverage gap: never reached a single round_end').toBeGreaterThan(0)
      expect(stats.matchOvers, 'coverage gap: never reached a single match_over').toBeGreaterThan(0)
    },
    300_000,
  )
})

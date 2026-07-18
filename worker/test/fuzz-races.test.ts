import { env, runDurableObjectAlarm, runInDurableObject, SELF } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import { setupRound } from '../../src/engine'
import { mulberry32 } from '../../src/shared/rng'
import { GameRepository, runMigrations, type MetaRow, type MoveRow, type SqlLike } from '../src/do/storage'
import { rearmAlarm, setTimer } from '../src/do/timers'
import { applyD1Schema } from './helpers'

/**
 * RACE / CONCURRENCY battery against the online worker's Durable Object.
 * Goal: prove the DO's single-writer discipline (every write path runs as
 * ONE synchronous `ctx.storage.transactionSync` span — see game-do.ts /
 * do/apply.ts) actually holds when multiple requests race for the same DO.
 *
 * Two harness styles are used, matching the two existing conventions in this
 * test suite:
 *   - RACES 1/2/3/5/6/7 drive the real HTTP-shaped surface end-to-end
 *     (createAndJoin -> real /move,/join,/next-round,/resign,/games calls —
 *     online-flow.test.ts's pattern), so D1 (`applyD1Schema`) is bootstrapped
 *     exactly like that file does.
 *   - RACE 4 seeds a live game directly into the DO's SQLite (presence.test.ts's
 *     `seedLiveGame` pattern) so an AI-covered seat + an armed `ai_step` timer
 *     can be constructed precisely, without needing a full create/join dance.
 *
 * IMPORTANT — what "concurrent" means here (see the file's final describe
 * block / the task's own note): vitest-pool-workers runs a DO single-threaded
 * within one isolate. `Promise.all([...])` never achieves true parallel
 * execution against the SAME DO instance; it fires multiple independent
 * async operations whose `await` points interleave on the JS microtask queue.
 * Because every mutating handler in this codebase does ALL of its reads +
 * writes inside one synchronous `transactionSync` span with zero awaits
 * inside, the only place two racing calls can actually interleave is BEFORE
 * that span (parsing the body, `requireAuth`, an initial non-transactional
 * read) — never mid-write. That is exactly the interleaving the
 * single-writer design is supposed to survive, so it is still a real and
 * valuable test of the invariant, even though it can never reproduce true
 * multi-core parallelism. Each `it()` below says explicitly what it can and
 * cannot prove.
 *
 * Per the task brief: this file does NOT edit any other file, and if a race
 * exposes a real bug, the test is left asserting the CORRECT behavior
 * (failing) rather than being "fixed" to match the bug.
 */

const DB = () => (env as unknown as { DB: D1Database }).DB

beforeAll(async () => {
  await applyD1Schema(DB())
})

let counter = 0
function stubFor(name: string) {
  // A fresh DO id per call keeps every `it()` fully isolated, even across
  // tests that reuse the same literal name prefix (online-flow.test.ts's
  // pattern).
  return env.GAME_DO.get(env.GAME_DO.idFromName(`fuzz-${name}-${counter++}`))
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

function routerReq(path: string, opts: { method?: string; token?: string; body?: unknown } = {}): Request {
  const headers: Record<string, string> = {}
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  return new Request(`https://worker${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
}

async function readJson(res: Response): Promise<any> {
  return res.json()
}

const ALICE_ID = 'acct-fz-alice'
const BOB_ID = 'acct-fz-bob'
const CAROL_ID = 'acct-fz-carol'
const ALICE = `test:${ALICE_ID}:Alice`
const BOB = `test:${BOB_ID}:Bob`
const CAROL = `test:${CAROL_ID}:Carol`

async function createRoom(stub: ReturnType<typeof stubFor>, matchLength: 1 | 3 | 5, token = ALICE) {
  const res = await stub.fetch(req('/games', { token, body: { matchLength } }))
  expect(res.status).toBe(201)
  return readJson(res)
}

async function joinRaw(stub: ReturnType<typeof stubFor>, token: string): Promise<{ status: number; body: any }> {
  const res = await stub.fetch(req('/join', { token, body: {} }))
  return { status: res.status, body: await readJson(res) }
}

async function sync(stub: ReturnType<typeof stubFor>, token: string, since = 0) {
  const res = await stub.fetch(req(`/sync?since=${since}`, { token, method: 'GET' }))
  return { status: res.status, body: await readJson(res) }
}

async function moveRaw(
  stub: ReturnType<typeof stubFor>,
  token: string,
  seatIndex: 0 | 1,
  action: Record<string, unknown>,
  clientMoveId?: string,
): Promise<{ status: number; body: any }> {
  const res = await stub.fetch(
    req('/move', { token, body: { seatIndex, move: action, clientMoveId: clientMoveId ?? crypto.randomUUID() } }),
  )
  return { status: res.status, body: await readJson(res) }
}

/** Create + join a fresh 2-human game; returns the stub and both seat tokens
 *  (Alice = seat 0, Bob = seat 1 — /join always claims the lone open seat). */
async function createAndJoin(name: string, matchLength: 1 | 3 | 5) {
  const stub = stubFor(name)
  await createRoom(stub, matchLength)
  const joined = await joinRaw(stub, BOB)
  expect(joined.status).toBe(200)
  expect(joined.body.seatIndex).toBe(1)
  expect(joined.body.status).toBe('active')
  const tokens: [string, string] = [ALICE, BOB]
  return { stub, tokens }
}

/** Always-legal greedy auto-move (test-only harness logic, duplicated per
 *  this suite's own convention — see router.test.ts's docstring on why
 *  sibling test files don't import each other's helpers). */
function pickAutoMove(game: { market: { type: string }[]; myHand: { type: string }[] }): Record<string, unknown> {
  const camelIdx = game.market.findIndex((c) => c.type === 'camel')
  if (camelIdx !== -1) return { type: 'TAKE_CAMELS' }
  if (game.myHand.length < 7) {
    const idx = game.market.findIndex((c) => c.type !== 'camel')
    if (idx !== -1) return { type: 'TAKE_SINGLE', marketIndex: idx }
  }
  const PRECIOUS = new Set(['diamond', 'gold', 'silver'])
  const counts = new Map<string, number>()
  for (const c of game.myHand) counts.set(c.type, (counts.get(c.type) ?? 0) + 1)
  for (const [good, count] of counts) {
    const minQty = PRECIOUS.has(good) ? 2 : 1
    if (count >= minQty) return { type: 'SELL', good, quantity: count }
  }
  throw new Error('pickAutoMove: no legal move found (should be unreachable)')
}

/** Play real, engine-legal moves (alternating seats) until the round ends. */
async function playRoundToEnd(stub: ReturnType<typeof stubFor>, tokens: [string, string]) {
  for (let i = 0; i < 500; i++) {
    const probe = await sync(stub, tokens[0])
    expect(probe.status).toBe(200)
    if (probe.body.view.phase !== 'playing') return probe.body.view
    const activeSeat = probe.body.view.game.activePlayer as 0 | 1
    const mine = activeSeat === 0 ? probe.body.view : (await sync(stub, tokens[1])).body.view
    const action = pickAutoMove(mine.game)
    const result = await moveRaw(stub, tokens[activeSeat], activeSeat, action)
    expect(result.status).toBe(200)
  }
  throw new Error('playRoundToEnd: exceeded iteration cap — round never ended')
}

/** DO-invariant probe: the move log is gapless and strictly increasing
 *  (move_index has a UNIQUE PK anyway — a structural guarantee — but a GAP
 *  would mean a write silently vanished, which the PK alone cannot catch). */
async function movesInvariant(stub: ReturnType<typeof stubFor>): Promise<MoveRow[]> {
  return runInDurableObject(stub, (_instance, state) => {
    const sql = state.storage.sql as unknown as SqlLike
    const rows = new GameRepository(sql).getMovesSince(0)
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.move_index).toBe(rows[i - 1]!.move_index + 1)
    }
    if (rows.length > 0) expect(rows[0]!.move_index).toBe(1)
    return rows
  })
}

// =============================================================================
// RACE 1 — idempotent move under concurrency
// =============================================================================

describe('RACE 1 — idempotent move under concurrency', () => {
  it('firing the SAME clientMoveId 10x concurrently commits exactly ONE move_index; every response is ok-or-duplicate with the SAME resulting view; the move log has no dup', async () => {
    const { stub, tokens } = await createAndJoin('idem-move', 3)
    const before = await sync(stub, tokens[0])
    const activeSeat = before.body.view.game.activePlayer as 0 | 1
    const mine = activeSeat === 0 ? before.body.view : (await sync(stub, tokens[1])).body.view
    const action = pickAutoMove(mine.game)
    const clientMoveId = crypto.randomUUID()

    const K = 10
    const results = await Promise.all(
      Array.from({ length: K }, () => moveRaw(stub, tokens[activeSeat], activeSeat, action, clientMoveId)),
    )

    for (const r of results) expect(r.status).toBe(200)
    const oks = results.filter((r) => r.body.ok === true)
    const dups = results.filter((r) => r.body.duplicate === true)
    expect(oks.length).toBe(1) // exactly ONE real commit
    expect(dups.length).toBe(K - 1) // every extra racer gets a benign dup ack

    // Every duplicate ack reports the IDENTICAL resulting view as the real commit.
    for (const d of dups) expect(d.body.view).toEqual(oks[0]!.body.view)

    const rows = await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      return new GameRepository(sql).getMovesSince(0)
    })
    const matching = rows.filter((r) => r.client_move_id === clientMoveId)
    expect(matching.length).toBe(1) // no duplicate row in the move log
    expect(matching[0]!.move_index).toBe(oks[0]!.body.moveIndex)

    await movesInvariant(stub)
  })
})

// =============================================================================
// RACE 2 — double next-round
// =============================================================================

describe('RACE 2 — double next-round', () => {
  it('firing /next-round 8x concurrently from BOTH seats at round_end advances the round exactly ONCE (one round_start move); extras get benign {already:true}; seals unchanged', async () => {
    const { stub, tokens } = await createAndJoin('double-next', 3)
    const endView = await playRoundToEnd(stub, tokens)
    expect(endView.phase).toBe('round_end') // matchLength=3 -> sealsNeeded=2, round 1 alone can never end the match
    const roundBefore = endView.round as number
    const sealsBefore = (endView.seals[0] as number) + (endView.seals[1] as number)

    const K = 8
    const responses = await Promise.all(
      Array.from({ length: K }, (_, i) => stub.fetch(req('/next-round', { token: tokens[i % 2], body: {} }))),
    )
    for (const r of responses) expect(r.status).toBe(200)
    const bodies = await Promise.all(responses.map((r) => readJson(r)))

    const dealt = bodies.filter((b) => b.already !== true)
    const already = bodies.filter((b) => b.already === true)
    expect(dealt.length).toBe(1) // exactly ONE caller actually dealt the round
    expect(already.length).toBe(K - 1)

    const after = await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      const repo = new GameRepository(sql)
      return { moves: repo.getMovesSince(0), meta: repo.getMeta()! }
    })
    expect(after.meta.round).toBe(roundBefore + 1) // advanced by exactly 1, never more
    expect(after.meta.phase).toBe('playing')

    const roundStarts = after.moves.filter((m) => m.type === 'round_start' && m.round === roundBefore + 1)
    expect(roundStarts.length).toBe(1) // no double-deal

    // /next-round itself never mints or awards a seal — only a move does.
    expect(after.meta.seals0 + after.meta.seals1).toBe(sealsBefore)

    await movesInvariant(stub)
  })
})

// =============================================================================
// RACE 3 — concurrent join to the last seat
// =============================================================================

describe('RACE 3 — concurrent join to the last seat', () => {
  it('two DIFFERENT accounts racing /join for the single open seat: exactly one gets it (200, seatIndex 1, active); the other is rejected 409; never two humans in one seat', async () => {
    const stub = stubFor('join-race')
    await createRoom(stub, 3)

    const [bobRes, carolRes] = await Promise.all([joinRaw(stub, BOB), joinRaw(stub, CAROL)])

    const successes = [bobRes, carolRes].filter((r) => r.status === 200)
    const failures = [bobRes, carolRes].filter((r) => r.status !== 200)
    expect(successes.length).toBe(1)
    expect(failures.length).toBe(1)
    expect(successes[0]!.body.seatIndex).toBe(1)
    expect(successes[0]!.body.status).toBe('active')
    expect(failures[0]!.status).toBe(409)
    expect(['room_full', 'not_waiting']).toContain(failures[0]!.body.error)

    const seats = await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      return new GameRepository(sql).getSeats()
    })
    const seat1 = seats.find((s) => s.seat_index === 1)!
    expect(seat1.owner_type).toBe('human')
    expect([BOB_ID, CAROL_ID]).toContain(seat1.owner_account_id) // exactly one winner seated

    const loserId = seat1.owner_account_id === BOB_ID ? CAROL_ID : BOB_ID
    expect(seats.some((s) => s.owner_account_id === loserId)).toBe(false) // the loser is seated NOWHERE

    await movesInvariant(stub)
  })

  it('the SAME account racing /join twice concurrently is idempotent (invite-link double-click) — never seated in two seats, never a duplicate deal', async () => {
    const stub = stubFor('join-race-same-account')
    await createRoom(stub, 3)

    const [r1, r2] = await Promise.all([joinRaw(stub, BOB), joinRaw(stub, BOB)])
    for (const r of [r1, r2]) {
      expect(r.status).toBe(200)
      expect(r.body.seatIndex).toBe(1)
      expect(r.body.status).toBe('active')
    }

    const seats = await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      return new GameRepository(sql).getSeats()
    })
    expect(seats.filter((s) => s.owner_account_id === BOB_ID).length).toBe(1) // seated exactly once

    const moves = await movesInvariant(stub)
    expect(moves.filter((m) => m.type === 'round_start').length).toBe(1) // no double-deal
  })
})

// =============================================================================
// RACE 4 — reclaim vs AI-cover race
// =============================================================================

/** Seed a live 2-seat game directly into the DO's SQLite with the seat whose
 *  turn it currently is AI-covered (mirrors presence.test.ts's `seedLiveGame`
 *  convention — this file does not import that one, per the "duplicate, don't
 *  cross-import sibling test files" pattern already established by
 *  router.test.ts). The OTHER seat is present (so `driveIfAI`'s
 *  `isAnyHumanPresent` freeze-guard doesn't suppress the drive). */
function seedAiCoveredGame(sql: SqlLike, now: number) {
  runMigrations(sql)
  const repo = new GameRepository(sql)
  const seed = 42
  const state = setupRound([0, 0], undefined, mulberry32(seed))
  repo.putSnapshot(state)
  repo.putRound(1, seed, state)

  const aiSeat = state.activePlayer as 0 | 1
  const otherSeat: 0 | 1 = aiSeat === 0 ? 1 : 0

  const meta: MetaRow = {
    game_uuid: 'fuzz-reclaim-uuid',
    code: 'FZRCLM',
    status: 'active',
    player_count: 2,
    match_length: 3,
    seals0: 0,
    seals1: 0,
    round: 1,
    phase: 'playing',
    current_seat: aiSeat,
    move_index: 0,
    winner_seat: null,
    engine_version: 'test',
    last_processed_at: now,
  }
  repo.putMeta(meta)

  for (const i of [0, 1] as const) {
    repo.putSeat({
      seat_index: i,
      owner_type: 'human',
      owner_account_id: `acct-fz-reclaim-${i}`,
      display_name: `P${i}`,
      controlled_by_ai: i === aiSeat,
      ai_difficulty: i === aiSeat ? 'medium' : null,
      last_seen_at: i === otherSeat ? now : null,
      disconnected_at: null,
    })
  }
  return { repo, aiSeat, otherSeat }
}

describe('RACE 4 — reclaim vs AI-cover race', () => {
  it('POST /reclaim fired concurrently with the alarm driving the AI cover: EITHER the human reclaims and the queued AI move ABORTS (reclaimed, no commit), OR the AI move commits first and reclaim still lands right after — but never both, never a double move_index, and the human ALWAYS ends up back in control (controlled_by_ai: false)', async () => {
    const stub = stubFor('reclaim-race')
    const now = Date.now()

    let aiSeat: 0 | 1 = 0
    await runInDurableObject(stub, async (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      const seeded = seedAiCoveredGame(sql, now)
      aiSeat = seeded.aiSeat
      // Arm the AI drive step in the FUTURE (mirrors presence.test.ts's
      // convention) so the platform's own auto-fire-on-setAlarm can't race
      // ahead of the explicit runDurableObjectAlarm() below — that helper
      // force-fires regardless of the scheduled time, giving us a clean,
      // single, deliberately-triggered race against /reclaim.
      setTimer(sql, 'ai_step', aiSeat, now + 60_000)
      await rearmAlarm(state, sql)
    })

    const ownerToken = `test:acct-fz-reclaim-${aiSeat}:P${aiSeat}`

    const [reclaimRes] = await Promise.all([
      stub.fetch(req('/reclaim', { method: 'POST', token: ownerToken })),
      runDurableObjectAlarm(stub),
    ])
    expect(reclaimRes.status).toBe(200)

    const outcome = await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      const repo = new GameRepository(sql)
      return { seats: repo.getSeats(), moves: repo.getMovesSince(0), meta: repo.getMeta()! }
    })

    // Gapless, unique move_index regardless of which side won the race.
    for (let i = 1; i < outcome.moves.length; i++) {
      expect(outcome.moves[i]!.move_index).toBe(outcome.moves[i - 1]!.move_index + 1)
    }
    // From a fresh round (move_index started at 0) this single drive tick can
    // produce AT MOST one move — never a double move on the same move_index,
    // and never two moves from one drive call.
    expect(outcome.moves.length).toBeLessThanOrEqual(1)

    // The human ALWAYS ends up back in control of the seat they reclaimed —
    // /reclaim unconditionally clears controlled_by_ai (do/game-do.ts's
    // handleReclaim never rolls back a committed AI move — ADDENDUM B — but
    // it always hands control back going forward).
    expect(outcome.seats[aiSeat]!.controlled_by_ai).toBe(false)

    if (outcome.moves.length === 1) {
      // Outcome B: the AI's drive move won the race to commit. It must be
      // the AI's OWN deterministic move for the covered seat (the only move
      // that could possibly have been in flight) — never duplicated, thanks
      // to the reclaim-race guard (do/apply.ts's `requireAiControlled`).
      expect(outcome.moves[0]!.seat_index).toBe(aiSeat)
      expect(outcome.moves[0]!.by_ai).toBe(true)
      expect(outcome.moves[0]!.client_move_id).toBe(`ai:${aiSeat}:1`)
    }
    // Outcome A (moves.length === 0): the reclaim won the race first; the
    // guard aborted the AI move with {error:'reclaimed'} before it could
    // write anything — asserted structurally above via moves.length === 0.

    expect([0, 1]).toContain(outcome.meta.current_seat) // turn is coherent either way
  })
})

// =============================================================================
// RACE 5 — resign vs move race
// =============================================================================

describe('RACE 5 — resign vs move race', () => {
  it('a /resign (passive seat) and a legal /move (active seat) fired concurrently: the match ends exactly once, the winner is deterministically the seat that did NOT resign, and no move commits after match_over that changes the winner', async () => {
    const { stub, tokens } = await createAndJoin('resign-vs-move', 3)
    const before = await sync(stub, tokens[0])
    const activeSeat = before.body.view.game.activePlayer as 0 | 1
    const passiveSeat: 0 | 1 = activeSeat === 0 ? 1 : 0
    const mine = activeSeat === 0 ? before.body.view : (await sync(stub, tokens[1])).body.view
    const action = pickAutoMove(mine.game)

    const [moveRes, resignRes] = await Promise.all([
      moveRaw(stub, tokens[activeSeat], activeSeat, action),
      stub.fetch(req('/resign', { method: 'POST', token: tokens[passiveSeat] })),
    ])

    expect(resignRes.status).toBe(200)
    // The racing move either committed cleanly BEFORE the resign landed, or
    // was cleanly rejected 409 game_over because the resign won the race —
    // never a silent corruption in between.
    expect([200, 409]).toContain(moveRes.status)
    if (moveRes.status === 409) expect(moveRes.body.error).toBe('game_over')

    const final = await sync(stub, tokens[0])
    expect(final.body.view.phase).toBe('match_over')
    // handleResign always awards the win to "the seat that did NOT resign",
    // independent of whether the racing move committed first (round 1 of a
    // matchLength=3 game can never independently reach match_over on its
    // own — sealsNeeded=2 — so the racing move can never itself out-race
    // resign's own win assignment).
    expect(final.body.view.winnerSeat).toBe(activeSeat)

    const moves = await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      return new GameRepository(sql).getMovesSince(0)
    })
    const resigns = moves.filter((m) => m.type === 'resign')
    expect(resigns.length).toBe(1) // the match ended exactly once
    expect(resigns[0]!.seat_index).toBe(passiveSeat)
    expect(moves[moves.length - 1]!.type).toBe('resign') // nothing committed after it

    await movesInvariant(stub)
  })
})

// =============================================================================
// RACE 6 — wrong-turn / stale move under concurrency
// =============================================================================
//
// NOTE on a design trap this suite deliberately avoids: racing "the CURRENT
// seat's legal move" concurrently against "the OTHER seat's move" is NOT a
// reliable way to prove wrong-turn rejection. If the legal move's
// transactionSync happens to commit FIRST, the turn genuinely passes to the
// other seat before their request's transactionSync ever runs — so by the
// time it's evaluated, that "other seat" request is now legitimately on
// turn and correctly SUCCEEDS. That isn't a bug; it's the DO correctly
// checking turn against freshly-committed state rather than a stale
// snapshot. (An earlier draft of this test asserted the other seat must
// always get 409 here and flaked exactly this way.) The tests below instead
// race batches where NONE of the concurrent requests is capable of being
// the one move that hands the turn over, so the correct outcome (all
// rejected) is deterministic regardless of scheduling order.

describe('RACE 6 — wrong-turn / stale move under concurrency', () => {
  it('K concurrent moves from the seat that is NOT currently on turn are ALL rejected 409 not_your_turn, with zero state change — none of them can ever be the move that hands the turn over, so no scheduling order can let one slip through', async () => {
    const { stub, tokens } = await createAndJoin('wrong-turn-race', 3)
    const before = await sync(stub, tokens[0])
    const activeSeat = before.body.view.game.activePlayer as 0 | 1
    const otherSeat: 0 | 1 = activeSeat === 0 ? 1 : 0

    // Baseline AFTER createAndJoin, not 0 — dealing round 1 already appended
    // a server-minted `round_start` move to the log before any player acts.
    const baseline = await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      return new GameRepository(sql).getMovesSince(0).length
    })

    const K = 6
    const results = await Promise.all(
      Array.from({ length: K }, () => moveRaw(stub, tokens[otherSeat], otherSeat, { type: 'TAKE_CAMELS' })),
    )
    for (const r of results) {
      expect(r.status).toBe(409)
      expect(r.body.error).toBe('not_your_turn')
    }

    const moves = await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      return new GameRepository(sql).getMovesSince(0)
    })
    expect(moves.length).toBe(baseline) // no state change from any of them

    const after = await sync(stub, tokens[0])
    expect(after.body.view.game.activePlayer).toBe(activeSeat) // turn untouched
  })

  it('once the turn has legitimately moved on, a STALE retry from the now-former-active seat is cleanly rejected — even raced as a concurrent batch', async () => {
    const { stub, tokens } = await createAndJoin('stale-move-race', 3)
    const before = await sync(stub, tokens[0])
    const activeSeat = before.body.view.game.activePlayer as 0 | 1
    const mine = activeSeat === 0 ? before.body.view : (await sync(stub, tokens[1])).body.view
    const action = pickAutoMove(mine.game)

    const baseline = await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      return new GameRepository(sql).getMovesSince(0).length
    })

    // Advance the turn for real — setup, not the race under test.
    const first = await moveRaw(stub, tokens[activeSeat], activeSeat, action)
    expect(first.status).toBe(200)
    expect(first.body.ok).toBe(true)
    expect(first.body.moveIndex).toBe(baseline + 1)

    // activeSeat is now STALE (the turn already passed to the other seat).
    // Race K copies of a late/retried move from them concurrently — every
    // single one must be rejected: none of these racers is the current seat,
    // and unlike RACE 6's first test there is no "legitimate" request in
    // this batch that could ever hand the turn back to activeSeat.
    const K = 6
    const staleResults = await Promise.all(
      Array.from({ length: K }, () => moveRaw(stub, tokens[activeSeat], activeSeat, action, crypto.randomUUID())),
    )
    for (const r of staleResults) {
      expect(r.status).toBe(409)
      expect(r.body.error).toBe('not_your_turn')
    }

    const moves = await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      return new GameRepository(sql).getMovesSince(0)
    })
    expect(moves.length).toBe(baseline + 1) // only the ONE legitimate move — none of the stale retries landed
    expect(moves[moves.length - 1]!.move_index).toBe(first.body.moveIndex)

    await movesInvariant(stub)
  })
})

// =============================================================================
// RACE 7 — two concurrent creates never share a DO
// =============================================================================

describe('RACE 7 — two concurrent /games creates never share a DO', () => {
  it('two DIFFERENT accounts racing POST /games (router-level, SELF.fetch) each get a distinct code/gameId and land in independent DOs with independent seat state', async () => {
    const alice = `test:acct-fz-race7-alice:Alice`
    const bob = `test:acct-fz-race7-bob:Bob`

    const [aliceRes, bobRes] = await Promise.all([
      SELF.fetch(routerReq('/games', { token: alice, body: { matchLength: 3 } })),
      SELF.fetch(routerReq('/games', { token: bob, body: { matchLength: 3 } })),
    ])
    expect(aliceRes.status).toBe(201)
    expect(bobRes.status).toBe(201)
    const aliceBody = await readJson(aliceRes)
    const bobBody = await readJson(bobRes)

    expect(aliceBody.code).not.toBe(bobBody.code) // distinct routing keys
    expect(aliceBody.gameId).not.toBe(bobBody.gameId)

    const aliceStub = env.GAME_DO.get(env.GAME_DO.idFromName(aliceBody.code))
    const bobStub = env.GAME_DO.get(env.GAME_DO.idFromName(bobBody.code))
    const aliceSeats = await runInDurableObject(aliceStub, (_instance, state) =>
      new GameRepository(state.storage.sql as unknown as SqlLike).getSeats(),
    )
    const bobSeats = await runInDurableObject(bobStub, (_instance, state) =>
      new GameRepository(state.storage.sql as unknown as SqlLike).getSeats(),
    )
    // Each DO's own host seat is its OWN creator only — no cross-contamination.
    expect(aliceSeats.find((s) => s.seat_index === 0)!.owner_account_id).toBe('acct-fz-race7-alice')
    expect(bobSeats.find((s) => s.seat_index === 0)!.owner_account_id).toBe('acct-fz-race7-bob')
  })
})

// =============================================================================
// Honest coverage note (returned in the task report, kept here too so it
// travels with the file for the next reader)
// =============================================================================
//
// What THIS harness can genuinely exercise: interleaving at the await
// boundaries BEFORE each handler's synchronous transactionSync span (request
// parsing, requireAuth, non-transactional reads) — racing two+ requests to
// land in whichever order the microtask queue happens to schedule them, then
// asserting the single-writer commit-order invariants hold regardless of
// which one "won". RACE 4 additionally races a real forced alarm fire
// (runDurableObjectAlarm) against a real HTTP handler on the same DO stub.
//
// What it CANNOT exercise: true multi-core/multi-isolate parallelism (two
// threads mid-write to the SAME SQLite row at literally the same instant) —
// Cloudflare's real production guarantee here is the single-writer DO model
// itself (one JS isolate per DO, ever), which this test harness already
// mirrors faithfully. There is no stronger race this suite could construct
// that would be MORE representative of production than what runs here.

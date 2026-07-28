import { env, runInDurableObject } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import { applyAction, setupRound, type Action, type Good } from '../../src/engine'
import { mulberry32 } from '../../src/shared/rng'
import { GameRepository, type SqlLike } from '../src/do/storage'
import { CLAIM_GRACE_MS, GLOBAL_SEAT } from '../src/do/constants'
import { hasTimer, setTimer } from '../src/do/timers'
import { applyD1Schema } from './helpers'

/**
 * Full 2-HUMAN authoritative flow, driven entirely through `GameDO.fetch`
 * (the real HTTP-shaped surface) — no AI, no direct repo pokes for game
 * logic (the repo is only used as a GROUND-TRUTH oracle for the redaction
 * and determinism assertions, via `runInDurableObject`).
 */

const DB = () => (env as unknown as { DB: D1Database }).DB

beforeAll(async () => {
  await applyD1Schema(DB())
})

let counter = 0
function stubFor(name: string) {
  // A fresh DO id per call keeps every `it()` fully isolated (Wave 1's
  // pattern), even across tests that reuse the same literal name prefix.
  return env.GAME_DO.get(env.GAME_DO.idFromName(`${name}-${counter++}`))
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

const ALICE_ID = 'acct-alice'
const BOB_ID = 'acct-bob'
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

/** Create + join a fresh 2-human game; returns the stub and both seat tokens
 *  (Alice = seat 0, Bob = seat 1 — /join always claims the lone open seat). */
async function createAndJoin(name: string, matchLength: 1 | 3 | 5) {
  const stub = stubFor(name)
  await createRoom(stub, matchLength)
  const joined = await join(stub)
  expect(joined.seatIndex).toBe(1)
  expect(joined.status).toBe('active')
  const tokens: [string, string] = [ALICE, BOB]
  return { stub, tokens }
}

/**
 * Always-legal greedy auto-move, mirroring ADDENDUM N's floorMove priority
 * (camels first — drains the deck fastest and never touches hand size; else
 * take a single good if there's room; else sell — guaranteed possible once
 * hand=7 by pigeonhole over 6 good types). Test-only harness logic, not
 * production code.
 */
function pickAutoMove(game: { market: { type: string }[]; myHand: { type: string }[] }): Action {
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
    if (count >= minQty) return { type: 'SELL', good: good as Good, quantity: count }
  }
  throw new Error('pickAutoMove: no legal move found (should be unreachable)')
}

/** Play real, engine-legal moves (alternating seats, driven by each seat's
 *  own redacted view) until the round naturally ends (`phase !== 'playing'`).
 *  Returns the final view (from Alice's perspective). Bounded so a bug never
 *  hangs the test suite. */
async function playRoundToEnd(stub: ReturnType<typeof stubFor>, tokens: [string, string]) {
  for (let i = 0; i < 500; i++) {
    const probe = await sync(stub, tokens[0])
    expect(probe.status).toBe(200)
    if (probe.body.view.phase !== 'playing') return probe.body.view
    const activeSeat = probe.body.view.game.activePlayer as 0 | 1
    const mine = activeSeat === 0 ? probe.body.view : (await sync(stub, tokens[1])).body.view
    const action = pickAutoMove(mine.game)
    const result = await move(stub, tokens[activeSeat], activeSeat, action)
    expect(result.status).toBe(200)
  }
  throw new Error('playRoundToEnd: exceeded iteration cap — round never ended')
}

/** Play rounds (calling /next-round between them) until `phase ===
 *  'match_over'`. Returns the sequence of round_end results observed
 *  (for prevLoser/threshold assertions) and the final match view. */
async function playMatchToOver(stub: ReturnType<typeof stubFor>, tokens: [string, string]) {
  const roundResults: { seals: [number, number]; sealAwardedTo: 0 | 1 | null; activePlayerAtRoundStart: 0 | 1 }[] = []
  for (let round = 0; round < 8; round++) {
    const startView = (await sync(stub, tokens[0])).body.view
    const activePlayerAtRoundStart = startView.game.activePlayer as 0 | 1

    const endView = await playRoundToEnd(stub, tokens)
    expect(endView.phase === 'round_end' || endView.phase === 'match_over').toBe(true)
    expect(endView.lastRoundResult).not.toBeNull()
    roundResults.push({
      seals: endView.seals,
      sealAwardedTo: endView.lastRoundResult.sealAwardedTo,
      activePlayerAtRoundStart,
    })

    if (endView.phase === 'match_over') return { roundResults, finalView: endView }

    const nr = await readJson(await stub.fetch(req('/next-round', { token: tokens[0], body: {} })))
    expect(nr.view).toBeDefined()
  }
  throw new Error('playMatchToOver: exceeded round cap — match never ended')
}

describe('online authoritative flow — create/join/deal', () => {
  it('create -> join deals round 1 immediately and goes active (no host-start ceremony)', async () => {
    const { stub, tokens } = await createAndJoin('create-join', 3)
    const view = (await sync(stub, tokens[0])).body.view
    expect(view.phase).toBe('playing')
    expect(view.round).toBe(1)
    expect(view.seals).toEqual([0, 0])
    expect(view.game.market.length).toBe(5)
    // Initial deal is 5 CARDS per player, but camels go straight to the herd
    // (not the hand) — so hand.length + herd == 5, not hand.length == 5.
    expect(view.game.myHand.length + view.game.herds[0]).toBe(5)
    expect(view.game.oppHandCount + view.game.herds[1]).toBe(5)
  })

  it('join is idempotent for an already-seated account (invite-link resume)', async () => {
    const { stub, tokens } = await createAndJoin('join-idem', 3)
    const again = await join(stub, tokens[1])
    expect(again.seatIndex).toBe(1)
    expect(again.status).toBe('active')
  })

  it('a third account cannot join once the room is full (2p: room went active on Bob\'s join)', async () => {
    const stub = stubFor('room-full')
    await createRoom(stub, 3)
    await join(stub, BOB)
    // Jaipur is always 2-player, so `/join` deals immediately and flips
    // status to 'active' the moment seat 1 is claimed — a third caller hits
    // the status gate (not_waiting), not a still-open-but-full seat search.
    const third = await stub.fetch(req('/join', { token: 'test:acct-carol:Carol', body: {} }))
    expect(third.status).toBe(409)
    expect((await readJson(third)).error).toBe('not_waiting')
  })
})

describe('full round -> round_end -> next-round -> match_over (matchLength=1)', () => {
  it('a single decisive round ends the match immediately (sealsNeeded=1)', async () => {
    const { stub, tokens } = await createAndJoin('match-1', 1)

    // sealsNeeded = floor(1/2)+1 = 1: loop until a round is actually decisive
    // (not a rare complete tie), then assert the MATCH ends at THAT round's
    // end without a /next-round call — proving "a single round decides it".
    let endView: any
    for (let attempt = 0; attempt < 4; attempt++) {
      endView = await playRoundToEnd(stub, tokens)
      if (endView.lastRoundResult.sealAwardedTo !== null) break
      // Tied round: sealsNeeded=1 was NOT reached, so both seals stay 0 —
      // play through /next-round and try again.
      await stub.fetch(req('/next-round', { token: tokens[0], body: {} }))
    }

    expect(endView.lastRoundResult.sealAwardedTo).not.toBeNull()
    const winner = endView.lastRoundResult.sealAwardedTo as 0 | 1
    expect(endView.phase).toBe('match_over')
    expect(endView.winnerSeat).toBe(winner)
    expect(endView.seals[winner]).toBe(1)

    // a move_index round_end move was appended narrating the transition
    const moves = (await sync(stub, tokens[0])).body.moves
    const roundEndMoves = moves.filter((m: any) => m.type === 'round_end')
    expect(roundEndMoves.length).toBeGreaterThan(0)
    const lastRoundEnd = roundEndMoves[roundEndMoves.length - 1]
    expect(lastRoundEnd.payload.result.sealAwardedTo).toBe(winner)
    expect(lastRoundEnd.payload.seals[winner]).toBe(1)
  })

  it('/next-round after match_over is rejected (409)', async () => {
    const { stub, tokens } = await createAndJoin('match-1-over', 1)
    let endView: any
    for (let attempt = 0; attempt < 4; attempt++) {
      endView = await playRoundToEnd(stub, tokens)
      if (endView.lastRoundResult.sealAwardedTo !== null) break
      await stub.fetch(req('/next-round', { token: tokens[0], body: {} }))
    }
    expect(endView.phase).toBe('match_over')
    const res = await stub.fetch(req('/next-round', { token: tokens[0], body: {} }))
    expect(res.status).toBe(409)
  })
})

describe('multi-round match_over (matchLength=3, sealsNeeded=2) + loser-goes-first', () => {
  it('plays to match_over using seals[seat] >= sealsNeeded, never a literal >= 2 shortcut', async () => {
    const { stub, tokens } = await createAndJoin('match-3', 3)
    const { roundResults, finalView } = await playMatchToOver(stub, tokens)

    expect(finalView.phase).toBe('match_over')
    const [s0, s1] = finalView.seals as [number, number]
    const sealsNeeded = Math.floor(3 / 2) + 1 // 2
    expect(Math.max(s0, s1)).toBeGreaterThanOrEqual(sealsNeeded)
    const expectedWinner = s0 >= sealsNeeded ? 0 : 1
    expect(finalView.winnerSeat).toBe(expectedWinner)
    // A single round's seal is never enough on its own at matchLength=3 —
    // sanity: the match took more than one round UNLESS the very first
    // round's award alone reached sealsNeeded (impossible: one round awards
    // at most 1 seal, and sealsNeeded=2), i.e. it must have taken >= 2 rounds.
    expect(roundResults.length).toBeGreaterThanOrEqual(2)

    // ADDENDUM F: loser-goes-first on every round after the first.
    for (let i = 1; i < roundResults.length; i++) {
      const prev = roundResults[i - 1]
      if (prev.sealAwardedTo === null) continue // tie -> seat 0 opens, no assertion
      const expectedOpener = prev.sealAwardedTo === 0 ? 1 : 0
      expect(roundResults[i].activePlayerAtRoundStart).toBe(expectedOpener)
    }
  })
})

describe('resign', () => {
  it('resign ends the match immediately in favor of the OTHER seat', async () => {
    const { stub, tokens } = await createAndJoin('resign', 3)
    const res = await stub.fetch(req('/resign', { token: tokens[0], body: {} }))
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.view.phase).toBe('match_over')
    expect(body.view.winnerSeat).toBe(1)

    const moves = (await sync(stub, tokens[1])).body.moves
    expect(moves.some((m: any) => m.type === 'resign' && m.seatIndex === 0)).toBe(true)
  })

  it('resign after match_over is rejected (409)', async () => {
    const { stub, tokens } = await createAndJoin('resign-twice', 3)
    await stub.fetch(req('/resign', { token: tokens[0], body: {} }))
    const second = await stub.fetch(req('/resign', { token: tokens[1], body: {} }))
    expect(second.status).toBe(409)
  })

  it('FIX 3: resign clears EVERY outstanding timer for BOTH seats (+ heal), a subsequent alarm fire does NOT autoCover/append any move, and archiving (via runArchiveTick) writes exactly ONE matches row per human seat even after repeated /tick calls (ties into FIX 1)', async () => {
    const { stub, tokens } = await createAndJoin('resign-timers-archive', 3)

    // Arm a scattering of timers on BOTH seats (not just the resigning one)
    // before resigning, to prove resign sweeps ALL of them — a leftover
    // timer would otherwise fire autoCover/a forced round-advance/broadcast
    // on a match that has already ended.
    await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      const now = Date.now()
      setTimer(sql, 'turn', 0, now + 60_000)
      setTimer(sql, 'grace', 1, now + 60_000)
      setTimer(sql, 'ai_step', 1, now)
      setTimer(sql, 'round_wait', 0, now + 30_000)
      setTimer(sql, 'heal', GLOBAL_SEAT, now + 60_000)
    })

    const res = await stub.fetch(req('/resign', { token: tokens[0], body: {} }))
    expect(res.status).toBe(200)

    await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      for (const seat of [0, 1] as const) {
        expect(hasTimer(sql, 'turn', seat)).toBe(false)
        expect(hasTimer(sql, 'grace', seat)).toBe(false)
        expect(hasTimer(sql, 'ai_step', seat)).toBe(false)
        expect(hasTimer(sql, 'round_wait', seat)).toBe(false)
      }
      expect(hasTimer(sql, 'heal', GLOBAL_SEAT)).toBe(false)
    })

    // A subsequent forced alarm fire must find nothing due and change
    // NOTHING — no zombie autoCover, no new move, on a finished match.
    const movesBefore = await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      return new GameRepository(sql).getMovesSince(0).length
    })
    await stub.fetch(new Request('https://do/tick', { method: 'POST' })) // no-op wheel poke; also drains the archive
    await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      const repo = new GameRepository(sql)
      expect(repo.getMovesSince(0).length).toBe(movesBefore)
      expect(repo.getSeats().every((s) => !s.controlled_by_ai)).toBe(true) // no zombie autoCover
    })

    // FIX 3 + FIX 1: resign now routes through runArchiveTick (not a direct
    // archiveMatchEnd call), so D1 gets finalized; a SECOND /tick must not
    // duplicate the matches rows (FIX 1's idempotent timestamp derivation).
    const gameUuid = await runInDurableObject(stub, (_instance, state) =>
      new GameRepository(state.storage.sql as unknown as SqlLike).getMeta()!.game_uuid,
    )
    await stub.fetch(new Request('https://do/tick', { method: 'POST' })) // re-run

    const gameRow = await DB().prepare(`SELECT status, ended_at FROM games WHERE game_uuid = ?`).bind(gameUuid).first<any>()
    expect(gameRow.status).toBe('resigned') // D1 games row finalized too, not just matches
    expect(gameRow.ended_at).toBeTruthy()

    const rows = (await DB().prepare(`SELECT * FROM matches WHERE game_uuid = ?`).bind(gameUuid).all<any>()).results
    expect(rows.length).toBe(2) // one per human seat, NOT four
  })

  it('a NATURAL match-over (a move reaching sealsNeeded, not resign) ALSO sweeps every wheel timer, so a subsequent alarm makes no zombie autoCover/move — same defect class as FIX 3', async () => {
    const { stub, tokens } = await createAndJoin('natural-timers', 1) // sealsNeeded=1: one decisive round ends the match

    let endView: any
    for (let attempt = 0; attempt < 6; attempt++) {
      // Arm a scattering of timers right before each round's final move, so
      // when the decisive round-ending move flips phase to 'match_over' there
      // ARE outstanding timers to sweep.
      await runInDurableObject(stub, (_instance, state) => {
        const sql = state.storage.sql as unknown as SqlLike
        const now = Date.now()
        setTimer(sql, 'turn', 0, now + 60_000)
        setTimer(sql, 'grace', 1, now + 60_000)
        setTimer(sql, 'round_wait', 0, now + 30_000)
        setTimer(sql, 'heal', GLOBAL_SEAT, now + 60_000)
      })
      endView = await playRoundToEnd(stub, tokens)
      if (endView.phase === 'match_over') break
      await stub.fetch(req('/next-round', { token: tokens[0], body: {} }))
    }
    expect(endView.phase).toBe('match_over') // the match ended via natural play, not resign

    // Every wheel timer for BOTH seats (+ heal) must be gone.
    await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      for (const seat of [0, 1] as const) {
        expect(hasTimer(sql, 'turn', seat)).toBe(false)
        expect(hasTimer(sql, 'grace', seat)).toBe(false)
        expect(hasTimer(sql, 'ai_step', seat)).toBe(false)
        expect(hasTimer(sql, 'round_wait', seat)).toBe(false)
      }
      expect(hasTimer(sql, 'heal', GLOBAL_SEAT)).toBe(false)
    })

    // A forced alarm on the finished match changes nothing (no zombie cover).
    const movesBefore = await runInDurableObject(stub, (_instance, state) =>
      new GameRepository(state.storage.sql as unknown as SqlLike).getMovesSince(0).length,
    )
    await stub.fetch(new Request('https://do/tick', { method: 'POST' }))
    await runInDurableObject(stub, (_instance, state) => {
      const repo = new GameRepository(state.storage.sql as unknown as SqlLike)
      expect(repo.getMovesSince(0).length).toBe(movesBefore)
      expect(repo.getSeats().every((s) => !s.controlled_by_ai)).toBe(true)
    })
  })
})

describe('claim-win (owner decision 2026-07-18: no AI takeover — the present player claims after genuine, sustained absence)', () => {
  it('opponent present/recently-heartbeated → 409 opponent_present, NO state change', async () => {
    const { stub, tokens } = await createAndJoin('claim-present', 3)
    // Establish clear, fresh presence for the opponent (seat 1) via a real heartbeat.
    const hb = await stub.fetch(req('/heartbeat', { token: tokens[1], body: {} }))
    expect(hb.status).toBe(200)

    const before = (await sync(stub, tokens[0])).body

    const res = await stub.fetch(req('/claim-win', { token: tokens[0], body: {} }))
    expect(res.status).toBe(409)
    expect((await readJson(res)).error).toBe('opponent_present')

    const after = (await sync(stub, tokens[0])).body
    expect(after.moveIndex).toBe(before.moveIndex) // nothing committed
    expect(after.view.phase).not.toBe('match_over')
  })

  it('a NEVER-heartbeated opponent (last_seen_at still null right after join) is NOT claimable either — "not yet measured" is not "measured and gone"', async () => {
    const { stub, tokens } = await createAndJoin('claim-never-seen', 3)
    // Neither seat has ever heartbeated yet (join doesn't call setPresence).
    const res = await stub.fetch(req('/claim-win', { token: tokens[0], body: {} }))
    expect(res.status).toBe(409)
    expect((await readJson(res)).error).toBe('opponent_present')
  })

  it('opponent genuinely, continuously absent (stale well past CLAIM_GRACE_MS) → 200, match_over, winner = claimer, exactly one claim_win move, EVERY wheel timer swept, and exactly one matches row per human seat even after a re-tick (idempotent)', async () => {
    const { stub, tokens } = await createAndJoin('claim-absent', 3)

    const now = Date.now()
    await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      const repo = new GameRepository(sql)
      repo.setPresence(0, now) // claimer (seat 0) freshly present
      repo.setPresence(1, now - CLAIM_GRACE_MS - 5_000) // opponent stale well past the grace window
      // Arm a scattering of leftover timers too (mirrors the resign FIX-3
      // test's "sweeps everything" coverage) — claim-win must sweep these
      // exactly like resign does.
      setTimer(sql, 'turn', 0, now + 60_000)
      setTimer(sql, 'grace', 1, now + 60_000)
      setTimer(sql, 'ai_step', 1, now)
      setTimer(sql, 'round_wait', 0, now + 30_000)
      setTimer(sql, 'heal', GLOBAL_SEAT, now + 60_000)
    })

    const res = await stub.fetch(req('/claim-win', { token: tokens[0], body: {} }))
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.view.phase).toBe('match_over')
    expect(body.view.winnerSeat).toBe(0)

    const moves = (await sync(stub, tokens[0])).body.moves
    const claimMoves = moves.filter((m: any) => m.type === 'claim_win')
    expect(claimMoves.length).toBe(1)
    expect(claimMoves[0].seatIndex).toBe(0)
    expect(claimMoves[0].byAi).toBe(false)
    expect(claimMoves[0].payload).toEqual({ type: 'claim_win', seat: 0 })

    await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      for (const seat of [0, 1] as const) {
        expect(hasTimer(sql, 'turn', seat)).toBe(false)
        expect(hasTimer(sql, 'grace', seat)).toBe(false)
        expect(hasTimer(sql, 'ai_step', seat)).toBe(false)
        expect(hasTimer(sql, 'round_wait', seat)).toBe(false)
      }
      expect(hasTimer(sql, 'heal', GLOBAL_SEAT)).toBe(false)
    })

    // A re-call after match_over is a benign 409 (idempotent, mirrors resign).
    const second = await stub.fetch(req('/claim-win', { token: tokens[1], body: {} }))
    expect(second.status).toBe(409)
    expect((await readJson(second)).error).toBe('match_over')

    const gameUuid = await runInDurableObject(stub, (_instance, state) =>
      new GameRepository(state.storage.sql as unknown as SqlLike).getMeta()!.game_uuid,
    )
    await stub.fetch(new Request('https://do/tick', { method: 'POST' })) // re-tick

    const gameRow = await DB().prepare(`SELECT status, ended_at FROM games WHERE game_uuid = ?`).bind(gameUuid).first<any>()
    expect(gameRow.status).toBe('resigned') // claim-win reuses the resigned stats bucket
    expect(gameRow.ended_at).toBeTruthy()

    await stub.fetch(new Request('https://do/tick', { method: 'POST' })) // a SECOND re-tick

    const rows = (await DB().prepare(`SELECT * FROM matches WHERE game_uuid = ?`).bind(gameUuid).all<any>()).results
    expect(rows.length).toBe(2) // one per human seat, never duplicated by repeated ticks
    const claimerRow = rows.find((r: any) => r.account_id === ALICE_ID) as any
    expect(claimerRow.won).toBe(1)
    const otherRow = rows.find((r: any) => r.account_id === BOB_ID) as any
    expect(otherRow.won).toBe(0)
  })

  it('/claim-win after match_over (via resign) is rejected 409 match_over', async () => {
    const { stub, tokens } = await createAndJoin('claim-after-over', 3)
    await stub.fetch(req('/resign', { token: tokens[0], body: {} }))
    const res = await stub.fetch(req('/claim-win', { token: tokens[1], body: {} }))
    expect(res.status).toBe(409)
    expect((await readJson(res)).error).toBe('match_over')
  })

  it('a caller who owns no seat gets 403 not_your_seat', async () => {
    const { stub } = await createAndJoin('claim-foreign', 3)
    const res = await stub.fetch(req('/claim-win', { token: 'test:acct-stranger:Eve', body: {} }))
    expect(res.status).toBe(403)
  })
})

describe('illegal move / turn / seat enforcement', () => {
  it('an illegal engine move is rejected 4xx with NO state change', async () => {
    const { stub, tokens } = await createAndJoin('illegal', 3)
    const before = (await sync(stub, tokens[0])).body

    // Seat 1's TAKE_SINGLE index is fine shape-wise but market[99] doesn't
    // exist — the engine (not the shape guard) rejects this.
    const activeSeat = before.view.game.activePlayer as 0 | 1
    const result = await move(stub, tokens[activeSeat], activeSeat, { type: 'TAKE_SINGLE', marketIndex: 99 })
    expect(result.status).toBeGreaterThanOrEqual(400)
    expect(result.status).toBeLessThan(500)

    const after = (await sync(stub, tokens[0])).body
    expect(after.moveIndex).toBe(before.moveIndex)
  })

  it('a move on the WRONG turn is rejected 409 not_your_turn', async () => {
    const { stub, tokens } = await createAndJoin('wrong-turn', 3)
    const before = (await sync(stub, tokens[0])).body
    const activeSeat = before.view.game.activePlayer as 0 | 1
    const otherSeat = activeSeat === 0 ? 1 : 0
    const result = await move(stub, tokens[otherSeat], otherSeat, { type: 'TAKE_CAMELS' })
    expect(result.status).toBe(409)
    expect(result.body.error).toBe('not_your_turn')
  })

  it('a caller cannot move a seat it does not own (403, foreign-seat)', async () => {
    const { stub, tokens } = await createAndJoin('foreign-seat', 3)
    // Bob (seat 1) attempts to submit a move AS seat 0.
    const result = await move(stub, tokens[1], 0, { type: 'TAKE_CAMELS' })
    expect(result.status).toBe(403)
  })

  it('a completely unrecognized account gets 403 not_your_seat on any endpoint', async () => {
    const { stub } = await createAndJoin('stranger', 3)
    const res = await stub.fetch(req('/sync', { token: 'test:acct-stranger:Eve', method: 'GET' }))
    expect(res.status).toBe(403)
  })
})

describe('idempotent replay', () => {
  it('replaying the same clientMoveId returns duplicate:true with NO new move_index', async () => {
    const { stub, tokens } = await createAndJoin('idempotent', 3)
    const before = (await sync(stub, tokens[0])).body
    const activeSeat = before.view.game.activePlayer as 0 | 1
    const action = pickAutoMove(activeSeat === 0 ? before.view.game : (await sync(stub, tokens[1])).body.view.game)
    const clientMoveId = crypto.randomUUID()

    const first = await move(stub, tokens[activeSeat], activeSeat, action, clientMoveId)
    expect(first.status).toBe(200)
    expect(first.body.ok).toBe(true)
    const afterFirst = (await sync(stub, tokens[0])).body

    const replay = await move(stub, tokens[activeSeat], activeSeat, action, clientMoveId)
    expect(replay.status).toBe(200)
    expect(replay.body.duplicate).toBe(true)

    const afterReplay = (await sync(stub, tokens[0])).body
    expect(afterReplay.moveIndex).toBe(afterFirst.moveIndex)
  })
})

describe('REDACTION (ADDENDUM I closed allowlist)', () => {
  it('never emits the opponent hand, deck contents/order, seed, or opponent bonus VALUES', async () => {
    const { stub, tokens } = await createAndJoin('redaction', 3)

    // Ground truth via the repo (never exposed through fetch()).
    const truth = await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      const repo = new GameRepository(sql)
      const meta = repo.getMeta()!
      const round = repo.getRound(meta.round)!
      return { seed: round.seed }
    })

    // Play a handful of real moves so both hands/market have shuffled state,
    // then inspect the redacted view from EACH seat's own perspective.
    for (let i = 0; i < 6; i++) {
      const probe = await sync(stub, tokens[0])
      if (probe.body.view.phase !== 'playing') break
      const activeSeat = probe.body.view.game.activePlayer as 0 | 1
      const mine = activeSeat === 0 ? probe.body.view : (await sync(stub, tokens[1])).body.view
      await move(stub, tokens[activeSeat], activeSeat, pickAutoMove(mine.game))
    }

    const fullSync = await sync(stub, tokens[0])
    const view = fullSync.body.view

    // Closed allowlist: `game` has EXACTLY these keys, nothing more.
    expect(Object.keys(view.game).sort()).toEqual(
      [
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
      ].sort(),
    )
    expect(view.game).not.toHaveProperty('oppHand')
    expect(view.game).not.toHaveProperty('deck')
    expect(view.game).not.toHaveProperty('oppGoodsTokens')
    expect(view.game).not.toHaveProperty('oppScore')

    // oppBonusTokens entries carry ONLY `tier`, never `value`.
    for (const t of view.game.oppBonusTokens) {
      expect(Object.keys(t)).toEqual(['tier'])
    }

    // mid-round (phase 'playing'), lastRoundResult must be null (scores are
    // private information until the round actually ends).
    if (view.phase === 'playing') {
      expect(view.lastRoundResult).toBeNull()
    }

    // Deep-serialize the WHOLE /sync response (view + move log) and assert
    // the round seed never appears anywhere in it.
    const wholeResponsePayload = JSON.stringify(fullSync.body)
    expect(wholeResponsePayload.includes(String(truth.seed))).toBe(false)
    // The literal key "deck" (the array form) never appears at all — only
    // "deckCount" does.
    expect(wholeResponsePayload.includes('"deck"')).toBe(false)
  })

  it('never emits opponent hand/deck/seed in the /move response view either', async () => {
    const { stub, tokens } = await createAndJoin('redaction-move', 3)
    const before = (await sync(stub, tokens[0])).body
    const activeSeat = before.view.game.activePlayer as 0 | 1
    const mine = activeSeat === 0 ? before.view : (await sync(stub, tokens[1])).body.view
    const result = await move(stub, tokens[activeSeat], activeSeat, pickAutoMove(mine.game))
    expect(result.status).toBe(200)
    const serialized = JSON.stringify(result.body)
    expect(serialized.includes('"deck"')).toBe(false)
    expect(result.body.view.game).not.toHaveProperty('oppHand')
  })
})

/**
 * BUG 1 fix (2026-07-27) — the round-end screen was showing a FAKE opponent
 * goods/bonus breakdown ("LEATHER: 17, 0 pts, Bonuses (3) 0 pts") because the
 * client always synthesized placeholder tokens for the opponent, even once
 * the round had ended and the server had the REAL values in hand. `view.ts`
 * now populates `lastRoundReveal` at round_end/match_over with both seats'
 * real goods tokens + realized bonus-point SUMS (never individual bonus
 * values). These tests assert the null/populated GATE end-to-end (mirroring
 * `lastRoundResult`'s own null-mid-round assertion above) against
 * DO-internal ground truth, plus that individual bonus token values are
 * STILL never exposed even though their sum now is.
 */
describe('lastRoundReveal (round-end/match_over opponent goods reveal)', () => {
  /** Ground truth straight off the DO's own SQLite snapshot (never exposed
   *  through fetch()) — the CURRENT round's real per-seat goods tokens +
   *  bonus token values. At round_end/match_over this is still the ended
   *  round's final state (do/view.ts's own docstring: "the DO never advances
   *  the snapshot until the next dealRound"). */
  async function readSnapshotTruth(stub: ReturnType<typeof stubFor>) {
    return runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      const repo = new GameRepository(sql)
      return { snapshot: repo.getSnapshot()! }
    })
  }

  it('is null mid-round, then populated with BOTH seats\' real goods tokens + correct bonus sums at round_end — same reveal from either seat\'s own view', async () => {
    const { stub, tokens } = await createAndJoin('reveal-round-end', 3)

    const mid = (await sync(stub, tokens[0])).body.view
    expect(mid.phase).toBe('playing')
    expect(mid.lastRoundReveal).toBeNull()

    const endView = await playRoundToEnd(stub, tokens)
    expect(endView.phase === 'round_end' || endView.phase === 'match_over').toBe(true)
    expect(endView.lastRoundReveal).not.toBeNull()

    const truth = await readSnapshotTruth(stub)
    const realGoods = [truth.snapshot.players[0].tokens, truth.snapshot.players[1].tokens]
    const realBonusSums = [0, 1].map(
      (i) => truth.snapshot.players[i].bonusTokens.reduce((s: number, t: { value: number }) => s + t.value, 0),
    )
    expect(endView.lastRoundReveal.goodsTokens).toEqual(realGoods)
    expect(endView.lastRoundReveal.bonusPoints).toEqual(realBonusSums)

    // Goods VALUES are public-derivable (the token rail is visible to both
    // players all game) — so both seats see the exact SAME reveal, unlike
    // any other per-seat-redacted field.
    const otherSeatView = (await sync(stub, tokens[1])).body.view
    expect(otherSeatView.lastRoundReveal).toEqual(endView.lastRoundReveal)

    // ...but individual bonus token VALUES still never leak, on EITHER
    // seat's view — only the SUM travels via lastRoundReveal.bonusPoints.
    for (const t of endView.game.oppBonusTokens) expect(Object.keys(t)).toEqual(['tier'])
    for (const t of otherSeatView.game.oppBonusTokens) expect(Object.keys(t)).toEqual(['tier'])
  })

  it('stays populated at match_over (not just round_end)', async () => {
    const { stub, tokens } = await createAndJoin('reveal-match-over', 1)
    let endView: any
    for (let attempt = 0; attempt < 4; attempt++) {
      endView = await playRoundToEnd(stub, tokens)
      if (endView.lastRoundResult.sealAwardedTo !== null) break
      await stub.fetch(req('/next-round', { token: tokens[0], body: {} }))
    }
    expect(endView.phase).toBe('match_over')
    expect(endView.lastRoundReveal).not.toBeNull()

    const truth = await readSnapshotTruth(stub)
    const realGoods = [truth.snapshot.players[0].tokens, truth.snapshot.players[1].tokens]
    expect(endView.lastRoundReveal.goodsTokens).toEqual(realGoods)
    expect(endView.lastRoundReveal.bonusPoints).toHaveLength(2)
  })
})

describe('DETERMINISM (ADDENDUM G)', () => {
  it('replaying setupRound(seed) reproduces the exact persisted rounds.initial_state', async () => {
    const { stub } = await createAndJoin('determinism', 3)

    const roundRow = await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      const repo = new GameRepository(sql)
      const meta = repo.getMeta()!
      return repo.getRound(meta.round)!
    })

    const replayed = setupRound([0, 0], undefined, mulberry32(roundRow.seed))
    expect(replayed).toEqual(roundRow.initialState)
  })

  it('a fixed move list replayed from the same seed twice yields identical states at every step', async () => {
    const { stub } = await createAndJoin('determinism-replay', 3)
    const roundRow = await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      const repo = new GameRepository(sql)
      const meta = repo.getMeta()!
      return repo.getRound(meta.round)!
    })

    let s1 = setupRound([0, 0], undefined, mulberry32(roundRow.seed))
    let s2 = setupRound([0, 0], undefined, mulberry32(roundRow.seed))
    expect(s1).toEqual(s2)

    for (let i = 0; i < 4 && s1.phase === 'playing'; i++) {
      // Pick the next action from s1 (both are identical at this point, so
      // whatever is legal for s1 is legal for s2 too).
      const action = pickAutoMove({ market: s1.market, myHand: s1.players[s1.activePlayer].hand })
      const r1 = applyAction(s1, action)
      const r2 = applyAction(s2, action)
      expect(r1.ok).toBe(true)
      expect(r2.ok).toBe(true)
      if (r1.ok && r2.ok) {
        s1 = r1.value
        s2 = r2.value
      }
      expect(s1).toEqual(s2)
    }
  })
})

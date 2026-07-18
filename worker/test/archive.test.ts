import { env, runInDurableObject } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import { archiveGameCreate, archiveMatchEnd, archiveSeats, archiveTick } from '../src/do/archive'
import { GameRepository, type MetaRow, type MoveRow, type SeatRow, type SqlLike } from '../src/do/storage'
import { applyD1Schema } from './helpers'

const DB = () => (env as unknown as { DB: D1Database }).DB

beforeAll(async () => {
  await applyD1Schema(DB())
})

let counter = 0
function stubFor(name: string) {
  // A fresh DO id per call keeps every `it()` isolated (foundation.test.ts's
  // pattern), even across tests reusing the same literal name prefix.
  return env.GAME_DO.get(env.GAME_DO.idFromName(`${name}-${counter++}`))
}

function baseMeta(overrides: Partial<MetaRow> = {}): MetaRow {
  return {
    game_uuid: crypto.randomUUID(),
    code: null,
    status: 'active',
    player_count: 2,
    match_length: 3,
    seals0: 0,
    seals1: 0,
    round: 1,
    phase: 'playing',
    current_seat: 0,
    move_index: 0,
    winner_seat: null,
    engine_version: 'archive-test-engine',
    last_processed_at: null,
    ...overrides,
  }
}

function baseSeat(overrides: Partial<SeatRow> = {}): SeatRow {
  return {
    seat_index: 0,
    owner_type: 'human',
    owner_account_id: 'acct-0',
    display_name: 'P0',
    controlled_by_ai: false,
    ai_difficulty: null,
    last_seen_at: null,
    disconnected_at: null,
    ...overrides,
  }
}

/** A server-minted `round_end` move row (do/apply.ts's shape) carrying a
 *  given round's `scoreRound` scores — the ingredient `archiveMatchEnd`'s
 *  `accumulatedMatchScores` sums across the whole match. */
function roundEndMoveRow(moveIndex: number, round: number, scores: [number, number], now: number): MoveRow {
  return {
    move_index: moveIndex,
    round,
    turn_number: 1,
    seat_index: -1, // GLOBAL_SEAT
    type: 'round_end',
    payload: JSON.stringify({
      type: 'round_end',
      result: { camelWinner: null, scores, bonusTokenCounts: [0, 0], sealAwardedTo: 0 },
      seals: [1, 0],
    }),
    by_ai: false,
    ai_difficulty: null,
    controlling_account_id: null,
    client_move_id: null,
    reverted: false,
    created_at: now,
  }
}

// =============================================================================
// archiveGameCreate
// =============================================================================

describe('archiveGameCreate', () => {
  it('writes the games row + game_players rows + upserts players for human seats', async () => {
    const stub = stubFor('archive-create')
    const code = `CR${crypto.randomUUID().slice(0, 4)}`
    const t0 = Date.now()
    let gameUuid = ''

    await runInDurableObject(stub, async (_instance, state) => {
      const repo = new GameRepository(state.storage.sql as unknown as SqlLike)
      repo.putMeta(baseMeta({ code, status: 'waiting' }))
      repo.putSeat(baseSeat({ seat_index: 0, owner_account_id: 'acct-create-alice', display_name: 'Alice' }))
      repo.putSeat(baseSeat({ seat_index: 1, owner_type: 'open', owner_account_id: null, display_name: null }))
      gameUuid = repo.getMeta()!.game_uuid

      await archiveGameCreate(DB(), repo, t0, code)
    })

    const gameRow = await DB().prepare(`SELECT * FROM games WHERE game_uuid = ?`).bind(gameUuid).first<any>()
    expect(gameRow).toBeTruthy()
    expect(gameRow.code).toBe(code)
    expect(gameRow.status).toBe('waiting')
    expect(gameRow.source).toBe('online_authoritative')

    const players = (await DB().prepare(`SELECT * FROM game_players WHERE game_uuid = ? ORDER BY seat_index`).bind(gameUuid).all<any>()).results
    expect(players.length).toBe(2)
    expect(players[0].account_id).toBe('acct-create-alice')
    expect(players[1].account_id).toBeNull()

    const playerRow = await DB().prepare(`SELECT * FROM players WHERE account_id = ?`).bind('acct-create-alice').first<any>()
    expect(playerRow?.display_name).toBe('Alice')
  })

  it('is idempotent: a re-create ON CONFLICT DOes NOTHING to the games row (no throw, no duplicate)', async () => {
    const stub = stubFor('archive-create-idem')
    const code = `CI${crypto.randomUUID().slice(0, 4)}`
    const t0 = Date.now()
    let gameUuid = ''

    await runInDurableObject(stub, async (_instance, state) => {
      const repo = new GameRepository(state.storage.sql as unknown as SqlLike)
      repo.putMeta(baseMeta({ code, status: 'waiting' }))
      repo.putSeat(baseSeat({ seat_index: 0, owner_account_id: 'acct-idem-alice' }))
      repo.putSeat(baseSeat({ seat_index: 1, owner_type: 'open', owner_account_id: null, display_name: null }))
      gameUuid = repo.getMeta()!.game_uuid

      await archiveGameCreate(DB(), repo, t0, code)
      await expect(archiveGameCreate(DB(), repo, t0 + 1000, code)).resolves.toBeUndefined()
    })

    const count = await DB().prepare(`SELECT COUNT(*) AS c FROM games WHERE game_uuid = ?`).bind(gameUuid).first<{ c: number }>()
    expect(Number(count!.c)).toBe(1)
  })
})

// =============================================================================
// archiveSeats
// =============================================================================

describe('archiveSeats', () => {
  it('UPSERTs (unlike create-time, which DOes NOTHING) so a seat claim overwrites the prior row, and touches last_activity_at', async () => {
    const stub = stubFor('archive-seats')
    const code = `SE${crypto.randomUUID().slice(0, 4)}`
    const t0 = Date.now()
    let gameUuid = ''

    await runInDurableObject(stub, async (_instance, state) => {
      const repo = new GameRepository(state.storage.sql as unknown as SqlLike)
      repo.putMeta(baseMeta({ code, status: 'waiting' }))
      repo.putSeat(baseSeat({ seat_index: 0, owner_account_id: 'acct-seats-alice', display_name: 'Alice' }))
      repo.putSeat(baseSeat({ seat_index: 1, owner_type: 'open', owner_account_id: null, display_name: null }))
      gameUuid = repo.getMeta()!.game_uuid
      await archiveGameCreate(DB(), repo, t0, code)

      // Simulate a join: seat 1 flips open -> human.
      repo.putSeat(baseSeat({ seat_index: 1, owner_type: 'human', owner_account_id: 'acct-seats-bob', display_name: 'Bob' }))
      repo.putMeta({ ...repo.getMeta()!, status: 'active' })
      await archiveSeats(DB(), repo, t0 + 5000)
    })

    const seat1 = await DB().prepare(`SELECT * FROM game_players WHERE game_uuid = ? AND seat_index = 1`).bind(gameUuid).first<any>()
    expect(seat1.account_id).toBe('acct-seats-bob')
    expect(seat1.display_name).toBe('Bob')

    const gameRow = await DB().prepare(`SELECT last_activity_at FROM games WHERE game_uuid = ?`).bind(gameUuid).first<any>()
    expect(Number(gameRow.last_activity_at)).toBe(t0 + 5000)

    const bobPlayerRow = await DB().prepare(`SELECT display_name FROM players WHERE account_id = ?`).bind('acct-seats-bob').first<any>()
    expect(bobPlayerRow?.display_name).toBe('Bob')
  })
})

// =============================================================================
// archiveTick
// =============================================================================

describe('archiveTick', () => {
  it('drains the outbox into D1 moves + marks them flushed', async () => {
    const stub = stubFor('archive-tick')
    const code = `TK${crypto.randomUUID().slice(0, 4)}`
    const t0 = Date.now()
    let gameUuid = ''

    await runInDurableObject(stub, async (_instance, state) => {
      const repo = new GameRepository(state.storage.sql as unknown as SqlLike)
      repo.putMeta(baseMeta({ code, status: 'active' }))
      repo.putSeat(baseSeat({ seat_index: 0, owner_account_id: 'acct-tick-a' }))
      repo.putSeat(baseSeat({ seat_index: 1, owner_account_id: 'acct-tick-b', display_name: 'B' }))
      gameUuid = repo.getMeta()!.game_uuid
      await archiveGameCreate(DB(), repo, t0, code)

      repo.insertMove({
        move_index: 1,
        round: 1,
        turn_number: 1,
        seat_index: 0,
        type: 'TAKE_CAMELS',
        payload: JSON.stringify({ type: 'TAKE_CAMELS', count: 1 }),
        by_ai: false,
        ai_difficulty: null,
        controlling_account_id: 'acct-tick-a',
        client_move_id: 'cm-1',
        reverted: false,
        created_at: t0,
      })
      expect(repo.unflushedOutbox()).toEqual([1])

      await archiveTick(DB(), repo, t0 + 1000)
      expect(repo.unflushedOutbox()).toEqual([])
    })

    const moveRow = await DB().prepare(`SELECT * FROM moves WHERE game_uuid = ? AND move_index = 1`).bind(gameUuid).first<any>()
    expect(moveRow).toBeTruthy()
    expect(moveRow.type).toBe('TAKE_CAMELS')
    expect(Number(moveRow.by_ai)).toBe(0)
  })

  it('finalizes the games row (status/seals/winner/ended_at) AND calls archiveMatchEnd when meta.status is terminal', async () => {
    const stub = stubFor('archive-tick-terminal')
    const code = `TT${crypto.randomUUID().slice(0, 4)}`
    const t0 = Date.now()
    let gameUuid = ''

    await runInDurableObject(stub, async (_instance, state) => {
      const repo = new GameRepository(state.storage.sql as unknown as SqlLike)
      repo.putMeta(baseMeta({ code, status: 'active' }))
      repo.putSeat(baseSeat({ seat_index: 0, owner_account_id: 'acct-tt-a' }))
      repo.putSeat(baseSeat({ seat_index: 1, owner_account_id: 'acct-tt-b', display_name: 'B' }))
      gameUuid = repo.getMeta()!.game_uuid
      await archiveGameCreate(DB(), repo, t0, code)

      repo.insertMove(roundEndMoveRow(1, 1, [30, 20], t0))
      repo.putMeta({ ...repo.getMeta()!, status: 'completed', phase: 'match_over', winner_seat: 0, seals0: 2, seals1: 1, move_index: 1 })

      await archiveTick(DB(), repo, t0 + 2000)
    })

    const gameRow = await DB().prepare(`SELECT status, winner_seat, seals0, seals1, ended_at FROM games WHERE game_uuid = ?`).bind(gameUuid).first<any>()
    expect(gameRow.status).toBe('completed')
    expect(Number(gameRow.winner_seat)).toBe(0)
    expect(Number(gameRow.seals0)).toBe(2)
    expect(Number(gameRow.seals1)).toBe(1)
    expect(gameRow.ended_at).toBeTruthy()

    // archiveTick's terminal-status backstop calls archiveMatchEnd itself.
    const matches = (await DB().prepare(`SELECT * FROM matches WHERE game_uuid = ?`).bind(gameUuid).all<any>()).results
    expect(matches.length).toBe(2)
  })

  it('FIX 1 (blocker): running archiveTick TWICE for a completed match (as every post-match-over heartbeat/leave/cron-tick does) writes exactly ONE matches row per human seat, not two', async () => {
    const stub = stubFor('archive-tick-dedup-rerun')
    const code = `RR${crypto.randomUUID().slice(0, 4)}`
    const t0 = Date.now()
    let gameUuid = ''

    await runInDurableObject(stub, async (_instance, state) => {
      const repo = new GameRepository(state.storage.sql as unknown as SqlLike)
      repo.putMeta(baseMeta({ code, status: 'active' }))
      repo.putSeat(baseSeat({ seat_index: 0, owner_account_id: 'acct-rr-a' }))
      repo.putSeat(baseSeat({ seat_index: 1, owner_account_id: 'acct-rr-b', display_name: 'B' }))
      gameUuid = repo.getMeta()!.game_uuid
      await archiveGameCreate(DB(), repo, t0, code)

      repo.insertMove(roundEndMoveRow(1, 1, [30, 20], t0))
      repo.putMeta({ ...repo.getMeta()!, status: 'completed', phase: 'match_over', winner_seat: 0, seals0: 2, seals1: 1, move_index: 1 })

      // Two INDEPENDENT archiveTick invocations at very different wall-clock
      // times (e.g. the direct handleMove call, then a much-later heal-tick
      // or cron poke re-running the terminal backstop).
      await archiveTick(DB(), repo, t0 + 2_000)
      await archiveTick(DB(), repo, t0 + 3_600_000) // an hour later
    })

    const matches = (await DB().prepare(`SELECT * FROM matches WHERE game_uuid = ?`).bind(gameUuid).all<any>()).results
    expect(matches.length).toBe(2) // one per human seat, NOT four

    // The belt-and-suspenders `ended_at` guard also means the games row's
    // finalize UPDATE only ever actually landed once.
    const gameRow = await DB().prepare(`SELECT ended_at FROM games WHERE game_uuid = ?`).bind(gameUuid).first<any>()
    expect(Number(gameRow.ended_at)).toBe(t0 + 2_000)
  })

  it('FIX 1 (blocker, resign case): running archiveTick TWICE after a resign writes exactly ONE matches row per human seat', async () => {
    const stub = stubFor('archive-tick-dedup-rerun-resign')
    const code = `RS${crypto.randomUUID().slice(0, 4)}`
    const t0 = Date.now()
    let gameUuid = ''

    await runInDurableObject(stub, async (_instance, state) => {
      const repo = new GameRepository(state.storage.sql as unknown as SqlLike)
      repo.putMeta(baseMeta({ code, status: 'active' }))
      repo.putSeat(baseSeat({ seat_index: 0, owner_account_id: 'acct-rs-a' }))
      repo.putSeat(baseSeat({ seat_index: 1, owner_account_id: 'acct-rs-b', display_name: 'B' }))
      gameUuid = repo.getMeta()!.game_uuid
      await archiveGameCreate(DB(), repo, t0, code)

      repo.insertMove({
        move_index: 1,
        round: 1,
        turn_number: 1,
        seat_index: 1,
        type: 'resign',
        payload: JSON.stringify({ type: 'resign', seat: 1 }),
        by_ai: false,
        ai_difficulty: null,
        controlling_account_id: 'acct-rs-b',
        client_move_id: null,
        reverted: false,
        created_at: t0,
      })
      repo.putMeta({ ...repo.getMeta()!, status: 'resigned', phase: 'match_over', winner_seat: 0, move_index: 1 })

      await archiveTick(DB(), repo, t0 + 2_000)
      await archiveTick(DB(), repo, t0 + 3_600_000)
    })

    const matches = (await DB().prepare(`SELECT * FROM matches WHERE game_uuid = ?`).bind(gameUuid).all<any>()).results
    expect(matches.length).toBe(2)
  })

  it('NEVER throws: a broken D1 leaves the outbox unflushed for the next retry', async () => {
    const stub = stubFor('archive-tick-broken')
    const brokenDb = {
      prepare() {
        throw new Error('D1 down')
      },
      batch() {
        throw new Error('D1 down')
      },
    } as unknown as D1Database

    await runInDurableObject(stub, async (_instance, state) => {
      const repo = new GameRepository(state.storage.sql as unknown as SqlLike)
      repo.putMeta(baseMeta({ code: 'BROKEN1', status: 'active' }))
      repo.putSeat(baseSeat({ seat_index: 0, owner_account_id: 'acct-broken-a' }))
      repo.putSeat(baseSeat({ seat_index: 1, owner_account_id: 'acct-broken-b', display_name: 'B' }))
      repo.insertMove({
        move_index: 1,
        round: 1,
        turn_number: 1,
        seat_index: 0,
        type: 'TAKE_CAMELS',
        payload: '{}',
        by_ai: false,
        ai_difficulty: null,
        controlling_account_id: 'acct-broken-a',
        client_move_id: 'cm-broken-1',
        reverted: false,
        created_at: Date.now(),
      })

      await expect(archiveTick(brokenDb, repo, Date.now())).resolves.toBeUndefined() // never throws
      expect(repo.unflushedOutbox()).toEqual([1]) // left for the next retry
    })
  })
})

// =============================================================================
// archiveMatchEnd
// =============================================================================

describe('archiveMatchEnd', () => {
  it("a finished 2-human game writes ONE matches row per human seat, opponent_type='online', winner's won=1, keyed on account_id (ACCUMULATED round scores, not seals)", async () => {
    const stub = stubFor('archive-match-end')
    const code = `ME${crypto.randomUUID().slice(0, 4)}`
    const t0 = Date.now()
    let gameUuid = ''

    await runInDurableObject(stub, async (_instance, state) => {
      const repo = new GameRepository(state.storage.sql as unknown as SqlLike)
      repo.putMeta(baseMeta({ code, status: 'active' }))
      repo.putSeat(baseSeat({ seat_index: 0, owner_account_id: 'acct-me-alice', display_name: 'Alice' }))
      repo.putSeat(baseSeat({ seat_index: 1, owner_account_id: 'acct-me-bob', display_name: 'Bob' }))
      gameUuid = repo.getMeta()!.game_uuid
      await archiveGameCreate(DB(), repo, t0, code)

      // Two rounds' worth of round_end moves — the match score is the SUM.
      repo.insertMove(roundEndMoveRow(1, 1, [40, 30], t0))
      repo.insertMove(roundEndMoveRow(2, 2, [20, 45], t0 + 10))
      // seat0 total = 60, seat1 total = 75 — seat 1 has the higher point
      // total, but the match is decided by SEALS: force seat 0 as the
      // seal-winner (winner_seat), proving `won` follows winner_seat, never
      // the higher score.
      repo.putMeta({ ...repo.getMeta()!, status: 'completed', phase: 'match_over', winner_seat: 0, seals0: 2, seals1: 0, move_index: 2 })

      await archiveMatchEnd(DB(), repo, t0 + 1000)
    })

    const rows = (await DB().prepare(`SELECT * FROM matches WHERE game_uuid = ? ORDER BY account_id`).bind(gameUuid).all<any>()).results
    expect(rows.length).toBe(2)

    const aliceRow = rows.find((r: any) => r.account_id === 'acct-me-alice')
    const bobRow = rows.find((r: any) => r.account_id === 'acct-me-bob')
    expect(aliceRow).toBeTruthy()
    expect(bobRow).toBeTruthy()

    expect(aliceRow.opponent_type).toBe('online') // ADDENDUM S — never 'human'
    expect(bobRow.opponent_type).toBe('online')
    expect(aliceRow.source).toBe('online_authoritative')

    expect(aliceRow.opponent_account_id).toBe('acct-me-bob')
    expect(bobRow.opponent_account_id).toBe('acct-me-alice')

    expect(Number(aliceRow.player_score)).toBe(60)
    expect(Number(aliceRow.opponent_score)).toBe(75)
    expect(Number(bobRow.player_score)).toBe(75)
    expect(Number(bobRow.opponent_score)).toBe(60)

    expect(Number(aliceRow.won)).toBe(1) // seat 0 (Alice) is winner_seat
    expect(Number(bobRow.won)).toBe(0)

    const gamePlayers = (
      await DB().prepare(`SELECT seat_index, result FROM game_players WHERE game_uuid = ? ORDER BY seat_index`).bind(gameUuid).all<any>()
    ).results
    expect(gamePlayers[0].result).toBe('win')
    expect(gamePlayers[1].result).toBe('loss')
  })

  it('dedups on re-run (the archiveTick backstop calling it a 2nd time for the same match-end moment)', async () => {
    const stub = stubFor('archive-match-end-dedup')
    const code = `MD${crypto.randomUUID().slice(0, 4)}`
    const t0 = Date.now()
    let gameUuid = ''

    await runInDurableObject(stub, async (_instance, state) => {
      const repo = new GameRepository(state.storage.sql as unknown as SqlLike)
      repo.putMeta(baseMeta({ code, status: 'active' }))
      repo.putSeat(baseSeat({ seat_index: 0, owner_account_id: 'acct-dd-alice' }))
      repo.putSeat(baseSeat({ seat_index: 1, owner_account_id: 'acct-dd-bob', display_name: 'Bob' }))
      gameUuid = repo.getMeta()!.game_uuid
      await archiveGameCreate(DB(), repo, t0, code)
      repo.putMeta({ ...repo.getMeta()!, status: 'completed', phase: 'match_over', winner_seat: 1 })

      const now = t0 + 5000
      await archiveMatchEnd(DB(), repo, now)
      await archiveMatchEnd(DB(), repo, now) // SAME `now` -> same dedup key -> a safe no-op
    })

    const rows = (await DB().prepare(`SELECT * FROM matches WHERE game_uuid = ?`).bind(gameUuid).all<any>()).results
    expect(rows.length).toBe(2) // still exactly one row PER human seat, not four
  })

  // ---------------------------------------------------------------------
  // FIX 1 (blocker): the bug this regression-tests is that archiveTick's
  // terminal branch calls archiveMatchEnd on EVERY invocation while status
  // stays terminal (every post-match-over heartbeat/leave/cron-tick), and
  // the OLD code used a FRESH Date.now() as `now` on every call and wrote
  // it straight into `matches.timestamp` — so the UNIQUE(account_id,
  // timestamp, opponent_type) dedup index never actually caught a repeat
  // (each call minted a distinct timestamp). The test above ("dedups on
  // re-run") passed a SAME `now` on both calls, which would have deduped
  // even under the old broken code — it does NOT exercise the real bug.
  // These tests pass DIFFERENT `now` values, mirroring what actually
  // happens in production across repeated invocations.
  // ---------------------------------------------------------------------

  it('FIX 1: archiveMatchEnd called twice with DIFFERENT `now` values still dedups to ONE row per human seat (natural completion)', async () => {
    const stub = stubFor('archive-match-end-dedup-now-varies')
    const code = `DV${crypto.randomUUID().slice(0, 4)}`
    const t0 = Date.now()
    let gameUuid = ''

    await runInDurableObject(stub, async (_instance, state) => {
      const repo = new GameRepository(state.storage.sql as unknown as SqlLike)
      repo.putMeta(baseMeta({ code, status: 'active' }))
      repo.putSeat(baseSeat({ seat_index: 0, owner_account_id: 'acct-dv-alice' }))
      repo.putSeat(baseSeat({ seat_index: 1, owner_account_id: 'acct-dv-bob', display_name: 'Bob' }))
      gameUuid = repo.getMeta()!.game_uuid
      await archiveGameCreate(DB(), repo, t0, code)

      // The round_end move that actually ended the match — its created_at
      // is the IMMUTABLE timestamp FIX 1 must key the dedup on.
      repo.insertMove(roundEndMoveRow(1, 1, [40, 10], t0))
      repo.putMeta({ ...repo.getMeta()!, status: 'completed', phase: 'match_over', winner_seat: 0, seals0: 2, seals1: 0, move_index: 1 })

      // Two calls with WILDLY different `now` — simulating archiveTick's
      // terminal branch re-firing on a much-later heartbeat/cron poke.
      await archiveMatchEnd(DB(), repo, t0 + 1_000)
      await archiveMatchEnd(DB(), repo, t0 + 999_000_000)
    })

    const rows = (await DB().prepare(`SELECT * FROM matches WHERE game_uuid = ?`).bind(gameUuid).all<any>()).results
    expect(rows.length).toBe(2) // one per human seat, NOT four
  })

  it('FIX 1: archiveMatchEnd called twice with DIFFERENT `now` values still dedups to ONE row per human seat (resign)', async () => {
    const stub = stubFor('archive-match-end-dedup-now-varies-resign')
    const code = `DR${crypto.randomUUID().slice(0, 4)}`
    const t0 = Date.now()
    let gameUuid = ''

    await runInDurableObject(stub, async (_instance, state) => {
      const repo = new GameRepository(state.storage.sql as unknown as SqlLike)
      repo.putMeta(baseMeta({ code, status: 'active' }))
      repo.putSeat(baseSeat({ seat_index: 0, owner_account_id: 'acct-dr-alice' }))
      repo.putSeat(baseSeat({ seat_index: 1, owner_account_id: 'acct-dr-bob', display_name: 'Bob' }))
      gameUuid = repo.getMeta()!.game_uuid
      await archiveGameCreate(DB(), repo, t0, code)

      // The server-minted `resign` move — game-do.ts's handleResign shape.
      repo.insertMove({
        move_index: 1,
        round: 1,
        turn_number: 1,
        seat_index: 0,
        type: 'resign',
        payload: JSON.stringify({ type: 'resign', seat: 0 }),
        by_ai: false,
        ai_difficulty: null,
        controlling_account_id: 'acct-dr-alice',
        client_move_id: null,
        reverted: false,
        created_at: t0,
      })
      repo.putMeta({ ...repo.getMeta()!, status: 'resigned', phase: 'match_over', winner_seat: 1, move_index: 1 })

      await archiveMatchEnd(DB(), repo, t0 + 500)
      await archiveMatchEnd(DB(), repo, t0 + 500_000_000)
    })

    const rows = (await DB().prepare(`SELECT * FROM matches WHERE game_uuid = ?`).bind(gameUuid).all<any>()).results
    expect(rows.length).toBe(2) // one per human seat, NOT four
  })

  it('marks ai_covered=1 for a seat with a non-reverted AI-played move, 0 for a seat with none', async () => {
    const stub = stubFor('archive-match-end-aicover')
    const code = `AC${crypto.randomUUID().slice(0, 4)}`
    const t0 = Date.now()
    let gameUuid = ''

    await runInDurableObject(stub, async (_instance, state) => {
      const repo = new GameRepository(state.storage.sql as unknown as SqlLike)
      repo.putMeta(baseMeta({ code, status: 'active' }))
      repo.putSeat(baseSeat({ seat_index: 0, owner_account_id: 'acct-ac-alice' }))
      repo.putSeat(baseSeat({ seat_index: 1, owner_account_id: 'acct-ac-bob', display_name: 'Bob' }))
      gameUuid = repo.getMeta()!.game_uuid
      await archiveGameCreate(DB(), repo, t0, code)

      repo.insertMove({
        move_index: 1,
        round: 1,
        turn_number: 1,
        seat_index: 0,
        type: 'TAKE_CAMELS',
        payload: '{}',
        by_ai: true,
        ai_difficulty: 'medium',
        controlling_account_id: 'acct-ac-alice',
        client_move_id: 'cm-ac-1',
        reverted: false,
        created_at: t0,
      })
      repo.putMeta({ ...repo.getMeta()!, status: 'completed', phase: 'match_over', winner_seat: 1, move_index: 1 })

      await archiveMatchEnd(DB(), repo, t0 + 1000)
    })

    const rows = (await DB().prepare(`SELECT account_id, ai_covered FROM matches WHERE game_uuid = ?`).bind(gameUuid).all<any>()).results
    const alice = rows.find((r: any) => r.account_id === 'acct-ac-alice')
    const bob = rows.find((r: any) => r.account_id === 'acct-ac-bob')
    expect(Number(alice.ai_covered)).toBe(1)
    expect(Number(bob.ai_covered)).toBe(0)
  })

  it('is a no-op when winner_seat is null (e.g. an abandoned game) — no matches row for either seat', async () => {
    const stub = stubFor('archive-match-end-abandoned')
    const code = `AB${crypto.randomUUID().slice(0, 4)}`
    const t0 = Date.now()
    let gameUuid = ''

    await runInDurableObject(stub, async (_instance, state) => {
      const repo = new GameRepository(state.storage.sql as unknown as SqlLike)
      repo.putMeta(baseMeta({ code, status: 'active' }))
      repo.putSeat(baseSeat({ seat_index: 0, owner_account_id: 'acct-ab-alice' }))
      repo.putSeat(baseSeat({ seat_index: 1, owner_account_id: 'acct-ab-bob', display_name: 'Bob' }))
      gameUuid = repo.getMeta()!.game_uuid
      await archiveGameCreate(DB(), repo, t0, code)
      repo.putMeta({ ...repo.getMeta()!, status: 'abandoned', phase: 'match_over', winner_seat: null })

      await archiveMatchEnd(DB(), repo, t0 + 1000)
    })

    const rows = (await DB().prepare(`SELECT * FROM matches WHERE game_uuid = ?`).bind(gameUuid).all<any>()).results
    expect(rows.length).toBe(0)
  })
})

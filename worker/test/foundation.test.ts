import { env, runInDurableObject } from 'cloudflare:test'
import { it, expect } from 'vitest'
import { setupRound, type GameState } from '../../src/engine'
import { mulberry32 } from '../../src/shared/rng'
import { encodeState, decodeState } from '../src/do/state-codec'
import { runMigrations, MIGRATIONS, GameRepository, type SqlLike } from '../src/do/storage'
import { baseMeta, baseSeat } from './helpers'

function stubFor(name: string) {
  return env.GAME_DO.get(env.GAME_DO.idFromName(name))
}

// ---- (1) state-codec: lossless JSON round trip on a REAL setupRound state --

it('encodeState/decodeState losslessly round-trips a real setupRound GameState', () => {
  const state = setupRound([0, 0], undefined, mulberry32(42))
  const roundTripped = decodeState(encodeState(state))
  expect(roundTripped).toEqual(state)
  // Sanity: prove the fixture actually exercises every top-level field (an
  // all-defaults/empty object would make the deep-equal above meaningless).
  expect(state.deck.length).toBeGreaterThan(0)
  expect(state.market.length).toBe(5)
  expect(state.players[0].hand.length).toBeGreaterThan(0)
  expect(state.bonusTokens.three.length).toBeGreaterThan(0)
})

it('encodeState/decodeState round-trips mid-round state shapes too (round 2, prevLoser threaded)', () => {
  // Exercises the seals/prevLoser/round-2 path (ADDENDUM F territory) so the
  // codec is verified against more than just a fresh round-1 deal.
  const state = setupRound([1, 0], 0, mulberry32(7))
  expect(decodeState(encodeState(state))).toEqual(state)
  expect(state.round).toBe(2)
  expect(state.activePlayer).toBe(0)
})

// ---- (2) GameDO boots; runMigrations is idempotent; ping() proves the -----
// ---- engine bundles + runs inside workerd ----------------------------------

it('engine bundles and runs in the workerd runtime (module-level import)', () => {
  expect(setupRound([0, 0], undefined, mulberry32(1)).deck.length).toBe(40)
})

it('GameDO boots (SQLite-backed) and ping() proves the engine runs inside the DO', async () => {
  const n = await runInDurableObject(stubFor('ping-smoke'), (instance: unknown) => (instance as { ping(): number }).ping())
  expect(n).toBe(40)
})

it('runMigrations is idempotent: running twice on the same DO throws nothing and keeps one schema_version row', async () => {
  await runInDurableObject(stubFor('migrate-idem'), (_instance, state) => {
    const sql = state.storage.sql as unknown as SqlLike
    runMigrations(sql)
    const repo = new GameRepository(sql)
    repo.putMeta(baseMeta({ game_uuid: 'g-idem' }))

    // Second run must not throw, must not duplicate the version row, must
    // not lose data already written.
    expect(() => runMigrations(sql)).not.toThrow()

    const versions = [...sql.exec('SELECT version FROM schema_version')]
    expect(versions.length).toBe(1)
    expect((versions[0] as { version: number }).version).toBe(MIGRATIONS.length)
    expect(repo.getMeta()?.game_uuid).toBe('g-idem')
  })
})

it('creates every Wave-1 table and stamps schema_version', async () => {
  await runInDurableObject(stubFor('schema-tables'), (_instance, state) => {
    const sql = state.storage.sql as unknown as SqlLike
    runMigrations(sql)
    const tables = [...sql.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")].map(
      (r) => (r as { name: string }).name,
    )
    for (const t of ['meta', 'snapshot', 'rounds', 'moves', 'seats', 'timers', 'archive_outbox', 'schema_version']) {
      expect(tables).toContain(t)
    }
    const version = [...sql.exec('SELECT version FROM schema_version')][0] as { version: number }
    expect(version.version).toBe(MIGRATIONS.length)
  })
})

// ---- (3) GameRepository CRUD --------------------------------------------

it('GameRepository round-trips meta, snapshot, rounds, seats, moves', async () => {
  await runInDurableObject(stubFor('repo-crud'), (_instance, state) => {
    const sql = state.storage.sql as unknown as SqlLike
    runMigrations(sql)
    const repo = new GameRepository(sql)

    // meta
    repo.putMeta(baseMeta({ game_uuid: 'uuid-xyz' }))
    expect(repo.getMeta()).toMatchObject({
      game_uuid: 'uuid-xyz',
      player_count: 2,
      match_length: 3,
      status: 'active',
      phase: 'playing',
    })
    repo.setLastProcessedAt(12345)
    expect(repo.getLastProcessedAt()).toBe(12345)

    // snapshot is rebuildable (overwritable)
    const gs1 = setupRound([0, 0], undefined, mulberry32(1))
    const gs2 = setupRound([0, 0], undefined, mulberry32(2)) // a DIFFERENT deal
    repo.putSnapshot(gs1)
    repo.putSnapshot(gs2)
    expect(repo.getSnapshot()).toEqual(gs2)

    // rounds: write-once per round number (immutable replay anchor)
    repo.putRound(1, 111, gs1)
    const firstEncoded = encodeState(gs1)
    repo.putRound(1, 999, gs2) // must be a no-op (round 1 already anchored)
    const r1 = repo.getRound(1)
    expect(r1?.seed).toBe(111)
    expect(encodeState(r1!.initialState as GameState)).toBe(firstEncoded)
    expect(repo.getRound(2)).toBeNull()
    repo.putRound(2, 222, gs2)
    expect(repo.getRound(2)?.seed).toBe(222)

    // seats
    repo.putSeat(baseSeat({ seat_index: 0, owner_account_id: 'acct-0' }))
    repo.putSeat(
      baseSeat({ seat_index: 1, owner_type: 'ai', owner_account_id: null, controlled_by_ai: true, ai_difficulty: 'medium' }),
    )
    const seats = repo.getSeats()
    expect(seats.length).toBe(2)
    expect(seats[0]!.owner_account_id).toBe('acct-0')
    expect(seats[1]!.controlled_by_ai).toBe(true)
    expect(repo.seatOwnedBy('acct-0')?.seat_index).toBe(0)
    expect(repo.seatOwnedBy('nobody')).toBeNull()

    repo.setPresence(0, 5000)
    expect(repo.getSeats()[0]!.last_seen_at).toBe(5000)
    repo.setControlledByAi(0, true)
    expect(repo.getSeats()[0]!.controlled_by_ai).toBe(true)

    // moves: getMovesSince on an empty log
    expect(repo.getMovesSince(0)).toEqual([])
    expect(repo.countTurnCompletingMoves()).toBe(0)

    repo.insertMove({
      move_index: 1,
      round: 1,
      turn_number: 1,
      seat_index: 0,
      type: 'round_start',
      payload: JSON.stringify({ round: 1 }),
      by_ai: false,
      ai_difficulty: null,
      controlling_account_id: null,
      client_move_id: null,
      reverted: false,
      created_at: 1000,
    })
    repo.insertMove({
      move_index: 2,
      round: 1,
      turn_number: 1,
      seat_index: 0,
      type: 'TAKE_CAMELS',
      payload: JSON.stringify({ count: 2 }),
      by_ai: false,
      ai_difficulty: null,
      controlling_account_id: 'acct-0',
      client_move_id: 'client-move-1',
      reverted: false,
      created_at: 1001,
    })

    expect(repo.moveExistsByClientId('client-move-1')).toBe(true)
    expect(repo.moveExistsByClientId('never-seen')).toBe(false)
    expect(repo.countTurnCompletingMoves()).toBe(1) // round_start is not turn-completing

    const since0 = repo.getMovesSince(0)
    expect(since0.length).toBe(2)
    expect(since0[0]).toMatchObject({ move_index: 1, type: 'round_start' })
    expect(since0[1]).toMatchObject({ move_index: 2, type: 'TAKE_CAMELS', client_move_id: 'client-move-1' })
    expect(repo.getMovesSince(1)).toEqual([since0[1]])
    expect(repo.getMove(2)?.controlling_account_id).toBe('acct-0')
    expect(repo.getMove(999)).toBeNull()

    // archive_outbox: insertMove enqueues; the outbox is drainable/markable.
    expect(repo.unflushedOutbox()).toEqual([1, 2])
    repo.markOutboxFlushed(1)
    expect(repo.unflushedOutbox()).toEqual([2])
  })
})

it('a duplicate client_move_id throws (idempotency backstop at the SQL layer)', async () => {
  await runInDurableObject(stubFor('repo-dup-client-id'), (_instance, state) => {
    const sql = state.storage.sql as unknown as SqlLike
    runMigrations(sql)
    const repo = new GameRepository(sql)
    const move = {
      round: 1,
      turn_number: 1,
      seat_index: 0,
      type: 'TAKE_CAMELS' as const,
      payload: '{}',
      by_ai: false,
      ai_difficulty: null,
      controlling_account_id: 'acct-0',
      client_move_id: 'dup-1',
      reverted: false,
      created_at: 1,
    }
    repo.insertMove({ ...move, move_index: 1 })
    expect(() => repo.insertMove({ ...move, move_index: 2 })).toThrow()
  })
})

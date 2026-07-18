import { env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { setupRound } from '../../src/engine'
import { mulberry32 } from '../../src/shared/rng'
import {
  GameRepository,
  runMigrations,
  type MatchPhase,
  type MetaRow,
  type SqlLike,
} from '../src/do/storage'
import {
  armDisconnectCoverIfAbsent,
  armRoundWaitIfAbsent,
  autoCover,
  isAnyHumanPresent,
  seatIndexPresent,
} from '../src/do/presence'
import { driveIfAI } from '../src/do/drive'
import { applyAndPersist } from '../src/do/apply'
import { hasTimer, minFireAt, rearmAlarm, setTimer } from '../src/do/timers'
import { AWAY_TURN_MS, PRESENCE_MS } from '../src/do/constants'

/**
 * Wave 3 (presence/never-stall/AI-cover) tests. Deliberately does NOT go
 * through `POST /games` (`handleCreateRoom`) the way online-flow.test.ts
 * does: that path `await`s `archiveGameCreate` (Wave 4's D1 write), and the
 * D1 archive schema/test-migration wiring is Wave 4's concurrently-landing
 * work (see the report at the end of this task). Every game here is instead
 * seeded DIRECTLY into the DO's own SQLite (mirroring viota's
 * presence.test.ts / drive.test.ts / alarm.test.ts convention), which also
 * gives precise, deterministic control over `now` for the liveness logic —
 * the actual `/heartbeat`, `/reclaim`, `/leave` HTTP handlers are still
 * exercised for real via `stub.fetch(...)`.
 */

function stubFor(name: string) {
  return env.GAME_DO.get(env.GAME_DO.idFromName(name))
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

async function post(stub: ReturnType<typeof stubFor>, path: string, token: string): Promise<Response> {
  return stub.fetch(req(path, { method: 'POST', token }))
}

const NOW = 5_000_000

type SeedOpts = {
  now: number
  phase?: MatchPhase
  round?: number
  matchLength?: 1 | 3 | 5
  currentSeat?: 0 | 1
  aiSeats?: number[]
  presentSeats?: number[]
  seed?: number
}

/** Seed a live 2-seat Jaipur game directly into the DO's SQLite — the
 *  Wave-3-test analog of viota's `seedLiveGame` helper, adapted to Jaipur's
 *  schema (MatchState-authoritative seals/round/phase, ADDENDUM D). */
function seedLiveGame(sql: SqlLike, opts: SeedOpts) {
  runMigrations(sql)
  const repo = new GameRepository(sql)
  const seed = opts.seed ?? 1
  const state = setupRound([0, 0], undefined, mulberry32(seed))
  repo.putSnapshot(state)
  repo.putRound(opts.round ?? 1, seed, state)

  const meta: MetaRow = {
    game_uuid: 'seed-uuid',
    code: 'CODE01',
    status: 'active',
    player_count: 2,
    match_length: opts.matchLength ?? 3,
    seals0: 0,
    seals1: 0,
    round: opts.round ?? 1,
    phase: opts.phase ?? 'playing',
    current_seat: opts.currentSeat ?? state.activePlayer,
    move_index: 0,
    winner_seat: null,
    engine_version: 'test',
    last_processed_at: opts.now,
  }
  repo.putMeta(meta)

  for (let i = 0; i < 2; i++) {
    const isAi = (opts.aiSeats ?? []).includes(i)
    repo.putSeat({
      seat_index: i,
      owner_type: 'human',
      owner_account_id: `acct-${i}`,
      display_name: `P${i}`,
      controlled_by_ai: isAi,
      ai_difficulty: isAi ? 'medium' : null,
      last_seen_at: (opts.presentSeats ?? []).includes(i) ? opts.now : null,
      disconnected_at: null,
    })
  }
  return { repo, state }
}

describe('presence predicates (heartbeat is the sole authority)', () => {
  it('a seat is present iff last_seen_at is within PRESENCE_MS', async () => {
    await runInDurableObject(stubFor('presence-pred'), (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      const { repo } = seedLiveGame(sql, { now: NOW, presentSeats: [1] })
      expect(seatIndexPresent(repo, 1, NOW)).toBe(true)
      expect(seatIndexPresent(repo, 0, NOW)).toBe(false) // never heartbeated
      expect(isAnyHumanPresent(repo, NOW)).toBe(true)
      // just past the window -> stale
      expect(seatIndexPresent(repo, 1, NOW + PRESENCE_MS + 1)).toBe(false)
      expect(isAnyHumanPresent(repo, NOW + PRESENCE_MS + 1)).toBe(false)
      // boundary inclusive
      expect(seatIndexPresent(repo, 1, NOW + PRESENCE_MS)).toBe(true)
    })
  })
})

describe('armDisconnectCoverIfAbsent', () => {
  it('arms a turn cover deadline for the absent CURRENT seat', async () => {
    await runInDurableObject(stubFor('arm-turn-absent'), (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      const { repo } = seedLiveGame(sql, { now: NOW, currentSeat: 0, presentSeats: [1] })
      armDisconnectCoverIfAbsent(repo, sql, NOW)
      expect(hasTimer(sql, 'turn', 0)).toBe(true)
      expect(minFireAt(sql)).toBe(NOW + AWAY_TURN_MS)
    })
  })

  it('never arms a cover for a PRESENT current seat', async () => {
    await runInDurableObject(stubFor('arm-turn-present'), (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      const { repo } = seedLiveGame(sql, { now: NOW, currentSeat: 0, presentSeats: [0, 1] })
      armDisconnectCoverIfAbsent(repo, sql, NOW)
      expect(hasTimer(sql, 'turn', 0)).toBe(false)
    })
  })

  it('does not push the deadline out on a repeated call (single-arm guard)', async () => {
    await runInDurableObject(stubFor('arm-turn-idempotent'), (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      const { repo } = seedLiveGame(sql, { now: NOW, currentSeat: 0, presentSeats: [1] })
      armDisconnectCoverIfAbsent(repo, sql, NOW)
      armDisconnectCoverIfAbsent(repo, sql, NOW + 30_000) // a later call must NOT push the deadline out
      expect(minFireAt(sql)).toBe(NOW + AWAY_TURN_MS)
    })
  })

  it('never arms at round_end (no active turn to protect there — round_wait handles it instead)', async () => {
    await runInDurableObject(stubFor('arm-turn-roundend'), (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      const { repo } = seedLiveGame(sql, { now: NOW, phase: 'round_end', currentSeat: 0, presentSeats: [1] })
      armDisconnectCoverIfAbsent(repo, sql, NOW)
      expect(hasTimer(sql, 'turn', 0)).toBe(false)
    })
  })
})

describe('armRoundWaitIfAbsent (ADDENDUM J)', () => {
  it('arms round_wait for each absent human seat at round_end, and clears it for a present one', async () => {
    await runInDurableObject(stubFor('arm-round-wait'), (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      const { repo } = seedLiveGame(sql, { now: NOW, phase: 'round_end', presentSeats: [0] })
      armRoundWaitIfAbsent(repo, sql, NOW)
      expect(hasTimer(sql, 'round_wait', 0)).toBe(false) // present -> cleared/never armed
      expect(hasTimer(sql, 'round_wait', 1)).toBe(true) // absent -> armed
    })
  })

  it('never arms outside round_end', async () => {
    await runInDurableObject(stubFor('arm-round-wait-playing'), (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      const { repo } = seedLiveGame(sql, { now: NOW, phase: 'playing', presentSeats: [0] })
      armRoundWaitIfAbsent(repo, sql, NOW)
      expect(hasTimer(sql, 'round_wait', 0)).toBe(false)
      expect(hasTimer(sql, 'round_wait', 1)).toBe(false)
    })
  })

  it('clears round_wait for a seat that becomes present again', async () => {
    await runInDurableObject(stubFor('arm-round-wait-clear'), (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      const { repo } = seedLiveGame(sql, { now: NOW, phase: 'round_end', presentSeats: [] })
      armRoundWaitIfAbsent(repo, sql, NOW)
      expect(hasTimer(sql, 'round_wait', 1)).toBe(true)
      repo.setPresence(1, NOW + 1_000)
      armRoundWaitIfAbsent(repo, sql, NOW + 1_000)
      expect(hasTimer(sql, 'round_wait', 1)).toBe(false)
    })
  })
})

describe('autoCover', () => {
  it('flips control, clears absence deadlines, kicks the drive loop, and toasts', async () => {
    await runInDurableObject(stubFor('cover-flip'), (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      const { repo } = seedLiveGame(sql, { now: NOW, currentSeat: 0, presentSeats: [1] })
      setTimer(sql, 'turn', 0, NOW + AWAY_TURN_MS)

      const toasts: unknown[] = []
      autoCover({ broadcast: (p) => toasts.push(p) }, repo, sql, 0, NOW)

      expect(repo.getSeats()[0]!.controlled_by_ai).toBe(true)
      expect(hasTimer(sql, 'turn', 0)).toBe(false)
      expect(hasTimer(sql, 'ai_step', 0)).toBe(true) // drive loop kicked
      expect(toasts).toEqual([{ type: 'ai_cover', seat: 0 }])
    })
  })
})

describe('driveIfAI phase guard (ADDENDUM K)', () => {
  it('is a no-op at round_end: no throw, no move, no nudge', async () => {
    await runInDurableObject(stubFor('drive-guard-roundend'), (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      const { repo } = seedLiveGame(sql, {
        now: NOW,
        phase: 'round_end',
        currentSeat: 0,
        aiSeats: [0],
        presentSeats: [1],
      })
      const nudges: number[] = []
      expect(() =>
        driveIfAI({ ctx: state, nudge: (i) => nudges.push(i) }, repo, sql, NOW),
      ).not.toThrow()
      expect(repo.getMovesSince(0).length).toBe(0)
      expect(nudges).toEqual([])
    })
  })

  it('is a no-op at match_over: no throw, no move (artificial status:active pairing isolates the PHASE guard from the status guard)', async () => {
    await runInDurableObject(stubFor('drive-guard-matchover'), (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      const { repo } = seedLiveGame(sql, {
        now: NOW,
        phase: 'match_over',
        currentSeat: 0,
        aiSeats: [0],
        presentSeats: [1],
      })
      expect(() => driveIfAI({ ctx: state, nudge: () => {} }, repo, sql, NOW)).not.toThrow()
      expect(repo.getMovesSince(0).length).toBe(0)
    })
  })
})

describe('CPU-kill floor phase guard (ADDENDUM K)', () => {
  it('a RETRY alarm at round_end applies no floor move (no-op, no throw)', async () => {
    const stub = stubFor('floor-guard-roundend')
    await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      seedLiveGame(sql, { now: Date.now(), phase: 'round_end', currentSeat: 0, aiSeats: [0], presentSeats: [1] })
    })

    await expect(
      runInDurableObject(stub, (instance) => instance.alarm({ isRetry: true, retryCount: 1 })),
    ).resolves.not.toThrow()

    await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      const repo = new GameRepository(sql)
      expect(repo.getMovesSince(0).length).toBe(0)
    })
  })

  it('a RETRY alarm at a normal playing turn DOES apply the floor move (sanity control)', async () => {
    const stub = stubFor('floor-guard-playing-control')
    await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      seedLiveGame(sql, { now: Date.now(), phase: 'playing', currentSeat: 0, aiSeats: [0], presentSeats: [1] })
    })

    await runInDurableObject(stub, (instance) => instance.alarm({ isRetry: true, retryCount: 1 }))

    await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      const repo = new GameRepository(sql)
      const rows = repo.getMovesSince(0)
      expect(rows.length).toBe(1)
      expect(rows[0]!.by_ai).toBe(true)
      expect(rows[0]!.ai_difficulty).toBe('floor')
    })
  })
})

describe('driveIfAI keeps a fully-covered game progressing (both seats AI, never stalls)', () => {
  it('drives BOTH AI-covered seats through the round to a natural conclusion', async () => {
    await runInDurableObject(stubFor('drive-both-covered'), (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      // Both seats are AI-covered ("both absent" from actually playing); one
      // seat stays present (a human is still watching) so the freeze guard
      // (isAnyHumanPresent) does not stop the loop.
      const { repo } = seedLiveGame(sql, { now: NOW, aiSeats: [0, 1], presentSeats: [0] })
      const nudges: number[] = []

      let steps = 0
      while (repo.getMeta()!.phase === 'playing' && steps < 500) {
        driveIfAI({ ctx: state, nudge: (i) => nudges.push(i) }, repo, sql, NOW)
        steps++
      }

      const meta = repo.getMeta()!
      expect(meta.phase === 'round_end' || meta.phase === 'match_over').toBe(true)
      const rows = repo.getMovesSince(0)
      expect(rows.length).toBeGreaterThan(0)
      // Every turn-consuming move was AI-driven (never a human "made" it).
      expect(rows.filter((r) => r.type !== 'round_end').every((r) => r.by_ai)).toBe(true)
      expect(nudges.length).toBeGreaterThan(0)
    })
  })
})

describe('cover via the alarm (end-to-end wiring through game-do.ts)', () => {
  it('an absent ON-TURN human is AI-covered once its turn timer fires', async () => {
    const stub = stubFor('alarm-cover-absent')
    await runInDurableObject(stub, async (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      // seat 0 on turn, absent; seat 1 present (keeps isAnyHumanPresent true
      // so the drive that follows cover doesn't freeze).
      seedLiveGame(sql, { now: Date.now(), currentSeat: 0, presentSeats: [1] })
      // Arm in the FUTURE so the platform doesn't auto-fire it early (which
      // would race the explicit runDurableObjectAlarm below); that helper
      // force-fires regardless of the scheduled time, and the alarm handler's
      // due-detection floors its threshold at min(fire_at) either way.
      setTimer(sql, 'turn', 0, Date.now() + 60_000)
      await rearmAlarm(state, sql)
    })

    expect(await runDurableObjectAlarm(stub)).toBe(true)

    await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      const repo = new GameRepository(sql)
      expect(repo.getSeats()[0]!.controlled_by_ai).toBe(true)
      expect(hasTimer(sql, 'turn', 0)).toBe(false)
    })
  })

  it('a PRESENT seat is NEVER covered, even when a stale turn timer fires', async () => {
    const stub = stubFor('alarm-cover-present-spared')
    await runInDurableObject(stub, async (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      // seat 0 present (fresh heartbeat) yet has a leftover 'turn' timer --
      // proves presence, not the timer's mere existence, decides cover.
      seedLiveGame(sql, { now: Date.now(), currentSeat: 0, presentSeats: [0, 1] })
      setTimer(sql, 'turn', 0, Date.now() + 60_000)
      await rearmAlarm(state, sql)
    })

    expect(await runDurableObjectAlarm(stub)).toBe(true)

    await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      const repo = new GameRepository(sql)
      expect(repo.getSeats()[0]!.controlled_by_ai).toBe(false)
      expect(hasTimer(sql, 'turn', 0)).toBe(false) // stale deadline dropped
    })
  })
})

describe('round_wait auto-advance (ADDENDUM J)', () => {
  it('after ROUND_WAIT_MS, round_end auto-advances past an absent seat without them clicking next-round', async () => {
    const stub = stubFor('round-wait-advance')
    await runInDurableObject(stub, async (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      // seat 0 present (the one who would otherwise be "stuck"), seat 1
      // absent -- proves the present player is never stuck on the absent one.
      seedLiveGame(sql, { now: Date.now(), phase: 'round_end', round: 1, presentSeats: [0] })
      setTimer(sql, 'round_wait', 1, Date.now() + 60_000)
      await rearmAlarm(state, sql)
    })

    expect(await runDurableObjectAlarm(stub)).toBe(true)

    await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      const repo = new GameRepository(sql)
      const meta = repo.getMeta()!
      expect(meta.phase).toBe('playing') // auto-advanced to the next round
      expect(meta.round).toBe(2)
      expect(hasTimer(sql, 'round_wait', 1)).toBe(false)
      // a fresh round_start move was appended narrating the transition
      const rows = repo.getMovesSince(0)
      expect(rows.some((r) => r.type === 'round_start')).toBe(true)
    })
  })

  it('fires on EITHER seat`s deadline (seat 0 absent this time, seat 1 present)', async () => {
    const stub = stubFor('round-wait-advance-other-seat')
    await runInDurableObject(stub, async (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      seedLiveGame(sql, { now: Date.now(), phase: 'round_end', round: 1, presentSeats: [1] })
      setTimer(sql, 'round_wait', 0, Date.now() + 60_000)
      await rearmAlarm(state, sql)
    })

    expect(await runDurableObjectAlarm(stub)).toBe(true)

    await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      const repo = new GameRepository(sql)
      expect(repo.getMeta()!.phase).toBe('playing')
      expect(repo.getMeta()!.round).toBe(2)
    })
  })

  it('a present player is never armed in the first place (no auto-advance needed)', async () => {
    const stub = stubFor('round-wait-both-present')
    await runInDurableObject(stub, async (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      const { repo } = seedLiveGame(sql, { now: Date.now(), phase: 'round_end', presentSeats: [0, 1] })
      armRoundWaitIfAbsent(repo, sql, Date.now())
      await rearmAlarm(state, sql)
    })

    await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      expect(hasTimer(sql, 'round_wait', 0)).toBe(false)
      expect(hasTimer(sql, 'round_wait', 1)).toBe(false)
      const repo = new GameRepository(sql)
      expect(repo.getMeta()!.phase).toBe('round_end') // untouched, no forced advance
    })
  })
})

describe('POST /reclaim', () => {
  it("clears controlled_by_ai for the caller's own covered seat and resumes from the current snapshot", async () => {
    const stub = stubFor('reclaim-own-seat')
    await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      seedLiveGame(sql, { now: Date.now(), currentSeat: 0, aiSeats: [0], presentSeats: [1] })
      setTimer(sql, 'turn', 0, Date.now() + 60_000)
      setTimer(sql, 'ai_step', 0, Date.now())
    })

    const res = await post(stub, '/reclaim', 'test:acct-0:P0')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { moveIndex: number; view: unknown }
    expect(body.view).toBeDefined()

    await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      const repo = new GameRepository(sql)
      expect(repo.getSeats()[0]!.controlled_by_ai).toBe(false)
      expect(repo.getSeats()[0]!.last_seen_at).not.toBeNull() // fresh heartbeat
      expect(hasTimer(sql, 'turn', 0)).toBe(false)
      expect(hasTimer(sql, 'ai_step', 0)).toBe(false)
    })
  })

  it('rejects a reclaim from an account that owns no seat here (403)', async () => {
    const stub = stubFor('reclaim-foreign')
    await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      seedLiveGame(sql, { now: Date.now() })
    })
    const res = await post(stub, '/reclaim', 'test:acct-stranger:Eve')
    expect(res.status).toBe(403)
  })

  it('reclaim-race guard: applyAndPersist aborts a stale AI move once the seat is reclaimed', async () => {
    await runInDurableObject(stubFor('reclaim-race-guard'), (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      const { repo } = seedLiveGame(sql, { now: NOW, currentSeat: 0, aiSeats: [0], presentSeats: [1] })
      // The human reclaims seat 0 BETWEEN the drive loop's decision and commit.
      repo.setControlledByAi(0, false)
      const r = state.storage.transactionSync(() =>
        applyAndPersist(repo, {
          seatIndex: 0,
          move: { type: 'TAKE_CAMELS' },
          clientMoveId: 'ai:0:1',
          accountId: null,
          byAi: true,
          aiDifficulty: 'medium',
          expectedSeat: 0,
          requireAiControlled: true,
          now: NOW,
        }),
      )
      expect(r).toEqual({ error: 'reclaimed' })
      expect(repo.getMovesSince(0).length).toBe(0)
    })
  })
})

describe('POST /heartbeat', () => {
  it('refreshes presence and clears a pending turn-cover deadline for the caller', async () => {
    const stub = stubFor('heartbeat-clears-cover')
    await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      const { repo } = seedLiveGame(sql, { now: Date.now(), currentSeat: 0 }) // seat 0 on turn, absent
      armDisconnectCoverIfAbsent(repo, sql, Date.now())
      expect(hasTimer(sql, 'turn', 0)).toBe(true)
    })

    const res = await post(stub, '/heartbeat', 'test:acct-0:P0')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, seat: 0 })

    await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      const repo = new GameRepository(sql)
      expect(hasTimer(sql, 'turn', 0)).toBe(false)
      expect(repo.getSeats()[0]!.last_seen_at).not.toBeNull()
    })
  })

  it('rejects a heartbeat from an account that owns no seat (403)', async () => {
    const stub = stubFor('heartbeat-foreign')
    await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      seedLiveGame(sql, { now: Date.now() })
    })
    const res = await post(stub, '/heartbeat', 'test:acct-stranger:Eve')
    expect(res.status).toBe(403)
  })

  it('rejects an unauthenticated heartbeat (401)', async () => {
    const stub = stubFor('heartbeat-unauth')
    await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      seedLiveGame(sql, { now: Date.now() })
    })
    const res = await stub.fetch(req('/heartbeat', { method: 'POST' }))
    expect(res.status).toBe(401)
  })
})

describe('POST /leave', () => {
  it("instantly covers the caller's own seat (does not wait for AWAY_TURN_MS, is not a resign)", async () => {
    const stub = stubFor('leave-covers-own-seat')
    await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      // seat 0 is present and OFF turn — proves /leave covers unconditionally,
      // not merely by expiring some deadline.
      seedLiveGame(sql, { now: Date.now(), currentSeat: 1, presentSeats: [0, 1] })
    })

    const res = await post(stub, '/leave', 'test:acct-0:P0')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; seat: number }
    expect(body).toEqual({ ok: true, seat: 0 })

    await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql as unknown as SqlLike
      const repo = new GameRepository(sql)
      expect(repo.getSeats()[0]!.controlled_by_ai).toBe(true)
      const meta = repo.getMeta()!
      expect(meta.status).toBe('active') // still a live match -- NOT a resign
      expect(meta.phase).not.toBe('match_over')
    })
  })
})

import { DurableObject } from 'cloudflare:workers'
import { scoreRound, setupRound } from '../../src/engine'
import { mulberry32 } from '../../src/shared/rng'
import { archiveGameCreate, archiveSeats, archiveTick } from './do/archive'
import { authenticateToken, requireAuth } from './do/authctx'
import { applyAndPersist, type ApplyParams } from './do/apply'
import { createWaitingRoom, dealRound } from './do/init'
import { validateMovePayloadShape } from './do/moves'
import { runMigrations, GameRepository, type MatchLength, type SqlLike } from './do/storage'
import { buildClientView, buildWaitingRoomView, toClientMove } from './do/view'
import { driveIfAI, type DriveDeps } from './do/drive'
import {
  autoCover,
  isAnyHumanPresent,
  seatIndexPresent,
  maxLastSeen,
  type CoverDeps,
} from './do/presence'
import { setTimer, clearTimer, hasTimer, dueTimers, minFireAt, rearmAlarm, creditEvictionGap } from './do/timers'
import { floorMove } from './do/floor'
import { CLAIM_GRACE_MS, GLOBAL_SEAT, HEAL_MS, PAUSE_ABANDON_MS, PRESENCE_MS } from './do/constants'

/**
 * Wave 1 (foundation) Env, extended nowhere (Wave 4 adds CLIENT_ORIGIN-driven
 * CORS wiring in index.ts; the binding is already declared).
 */
export interface Env {
  GAME_DO: DurableObjectNamespace<GameDO>
  /** D1 analytics archive (registry + move-log archive + stats). Written
   *  through via ctx.waitUntil (Wave 4 do/archive.ts); a D1 hiccup can never
   *  stall the live game (the DO SQLite copy is authoritative). */
  DB: D1Database
  /** The shared VGames identity service this worker introspects tokens
   *  against (design spec §2, ADDENDUM O). A PUBLIC URL, not a secret — see
   *  wrangler.toml [vars]. `'test'` is the offline test seam — see
   *  do/authctx.ts and worker/vitest.config.ts. */
  VGAMES_URL: string
  /** The exact browser origin allowed by CORS (the Render static-site URL).
   *  Unset only in local dev, where CORS falls back to a permissive `*`. */
  CLIENT_ORIGIN?: string
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Room-code alphabet (viota's — excludes visually-ambiguous chars: no I/O/0/1). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
function generateCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
}

/** Map an applyAndPersist error string to a 4xx status (never a 500) — port
 *  of viota's `statusForError`, extended with nothing Jaipur-specific (the
 *  round/match transition errors below all reuse these same buckets). */
function statusForError(error: string): number {
  switch (error) {
    case 'not_your_seat':
      return 403
    case 'game_over':
    case 'not_your_turn':
    case 'conflict':
    case 'reclaimed':
      return 409
    case 'game_not_found':
    case 'no_snapshot':
      return 404
    default:
      return 400 // engine/illegal-move errors (HAND_LIMIT, WRONG_PHASE, ...)
  }
}

/**
 * One Durable Object per game — the warm, single-writer, self-healing actor.
 *
 * Wave 2 surface (this file): schema init (constructor, unchanged from Wave
 * 1), the full SERVER-AUTHORITATIVE game-core route table (create/join/move/
 * sync/next-round/resign), and the WebSocket Hibernation nudge channel.
 * Presence/timers/AI-cover/the alarm wheel are Wave 3 — every seam that wave
 * needs is marked `// WAVE 3` below; this wave's handlers are correct and
 * complete WITHOUT them (a silently-absent player just never gets covered
 * yet — no stall risk introduced, since nothing here blocks on presence).
 */
export class GameDO extends DurableObject<Env> {
  private readonly repo: GameRepository

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // Boot smoke-assert: this must be the SQLite-backed DO (new_sqlite_classes),
    // not the paid KV-backed class. `sql` is absent on the KV backend.
    if (!ctx.storage.sql) {
      throw new Error('GameDO requires a SQLite-backed Durable Object (new_sqlite_classes)')
    }
    // Idempotent schema init/rehydration on every boot. blockConcurrencyWhile
    // guarantees no request/alarm runs until migrations complete.
    ctx.blockConcurrencyWhile(async () => {
      runMigrations(ctx.storage.sql as unknown as SqlLike)
    })
    this.repo = new GameRepository(ctx.storage.sql as unknown as SqlLike)
  }

  /** Proves the certified src/engine bundles and runs inside the workerd
   *  runtime (deterministic: seeded rng, seals [0,0], no prevLoser -> seat 0
   *  opens, same as `setupRound`'s default first-round call). */
  ping(): number {
    return setupRound([0, 0], undefined, mulberry32(1)).deck.length
  }

  async fetch(request: Request): Promise<Response> {
    if ((request.headers.get('Upgrade') ?? '').toLowerCase() === 'websocket') {
      return this.handleWebSocketUpgrade()
    }

    const url = new URL(request.url)
    const path = url.pathname

    // ADDENDUM R: the game-creation route is POST /games (not /create-room),
    // matching viota. The DO-internal handler name stays handleCreateRoom.
    if (request.method === 'POST' && path === '/games') return this.handleCreateRoom(request)
    if (request.method === 'POST' && path === '/join') return this.handleJoin(request)
    if (request.method === 'POST' && path === '/move') return this.handleMove(request)
    if (request.method === 'GET' && path === '/sync') return this.handleSync(request, url)
    if (request.method === 'POST' && path === '/next-round') return this.handleNextRound(request)
    if (request.method === 'POST' && path === '/resign') return this.handleResign(request)
    if (request.method === 'POST' && path === '/claim-win') return this.handleClaimWin(request)

    // WAVE 3: presence/timers/drive — stubs only, not wired into any Wave 2
    // call path (no handler above awaits or depends on these).
    if (request.method === 'POST' && path === '/heartbeat') return this.handleHeartbeat(request)
    if (request.method === 'POST' && path === '/reclaim') return this.handleReclaim(request)
    if (request.method === 'POST' && path === '/leave') return this.handleLeave(request)
    if (request.method === 'POST' && path === '/tick') return this.handleTick(request)

    return json({ error: 'not_found' }, 404)
  }

  // ---- WebSocket Hibernation API -----------------------------------------
  //
  // Sockets are accepted via ctx.acceptWebSocket (hibernatable) and handled
  // by the webSocket* DO METHODS below — NEVER server.accept()/
  // addEventListener, which pin the DO in memory and defeat hibernation.
  // Per-socket identity is stashed via serializeAttachment (survives
  // hibernation); fan-out enumerates ctx.getWebSockets() rather than any
  // in-memory Map. Ported from viota's game-do.ts (§3.6 wholesale-port note).

  private handleWebSocketUpgrade(): Response {
    const [client, server] = Object.values(new WebSocketPair())
    this.ctx.acceptWebSocket(server)
    // Unauthenticated until the first-frame auth handshake succeeds.
    server.serializeAttachment({ authed: false })
    return new Response(null, { status: 101, webSocket: client })
  }

  /**
   * Generic seat-agnostic fan-out to every attached socket (nudges, toasts).
   *
   * FIX 5 (minor): only sends to sockets that completed the `{type:'auth'}`
   * handshake (`deserializeAttachment().authed === true`). Previously this
   * sent nudge/ai_cover/started frames to EVERY attached socket, including
   * ones that never authenticated — an unauthenticated party who merely
   * guessed/observed a room code could open a WS connection and sniff live
   * activity metadata (move-index nudges, cover events) without ever proving
   * seat ownership. No hand/card data ever rides these frames (see `nudge`'s
   * docstring), but "there's activity right now" is itself metadata this
   * game never intended to leak pre-auth. Returns the count of sockets the
   * payload actually reached (not the total attached count).
   */
  broadcast(payload: unknown): number {
    const data = JSON.stringify(payload)
    const sockets = this.ctx.getWebSockets()
    let sent = 0
    for (const ws of sockets) {
      const att = ws.deserializeAttachment() as { authed?: boolean } | null
      if (!att?.authed) continue // never leak activity metadata pre-auth
      try {
        ws.send(data)
        sent++
      } catch {
        // socket gone; presence rides heartbeats (Wave 3), not socket state
      }
    }
    return sent
  }

  /** "There's news at index N" — never any hand data. */
  nudge(moveIndex: number): number {
    return this.broadcast({ type: 'nudge', moveIndex })
  }

  /** Deps for the drive loop (the ONLY code path that produces AI moves). */
  private driveDeps(): DriveDeps {
    return { ctx: this.ctx, nudge: (i: number) => this.nudge(i) }
  }

  /** Deps for auto-cover (broadcast the dismissible ai_cover toast). */
  private coverDeps(): CoverDeps {
    return { broadcast: (p: unknown) => this.broadcast(p) }
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const att =
      (ws.deserializeAttachment() as
        | { authed?: boolean; seatIndex?: number; accountId?: string | null }
        | null) ?? { authed: false }

    const text = typeof message === 'string' ? message : new TextDecoder().decode(message)
    let frame: { type?: string; token?: unknown } | null
    try {
      frame = JSON.parse(text)
    } catch {
      frame = null
    }

    if (!att.authed) {
      // First-frame auth handshake. The first frame MUST be
      // `{type:'auth', token}`: authenticate, then confirm the account owns
      // a seat in THIS game (resolved live from the seats table — never a
      // token claim). Close 4001 on a missing/invalid token OR a non-owner.
      if (!frame || frame.type !== 'auth' || typeof frame.token !== 'string') {
        ws.close(4001, 'auth required')
        return
      }
      const auth = await authenticateToken(frame.token, this.env)
      if (!auth) {
        ws.close(4001, 'invalid token')
        return
      }
      const seat = this.repo.seatOwnedBy(auth.accountId)
      if (!seat) {
        ws.close(4001, 'not a seat owner')
        return
      }
      ws.serializeAttachment({ authed: true, seatIndex: seat.seat_index, accountId: auth.accountId })
      ws.send(JSON.stringify({ type: 'auth_ok', seat: seat.seat_index }))
      return
    }

    // Authenticated app frame. Benign ack — correctness never rides the
    // socket (all mutation + recovery is idempotent HTTP); the socket is
    // only a nudge channel. WAVE 3: this is also where a heartbeat-on-message
    // convenience would refresh presence — not needed yet (no presence to
    // refresh in Wave 2).
    ws.send(JSON.stringify({ type: 'ack', seat: att.seatIndex, echo: frame?.type ?? null }))
  }

  async webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    // Deliberately a no-op (see viota: presence is heartbeat-based, not
    // socket-based). WAVE 3 wires presence off this via armDisconnectCoverIfAbsent.
  }

  async webSocketError(_ws: WebSocket, _error: unknown): Promise<void> {
    // No-op: presence is heartbeat-authoritative over socket state (Wave 3).
  }

  // ---- WAVE 3: presence / never-stall / AI-cover --------------------------

  /**
   * On any DO wake: compute the eviction gap from `last_processed_at`, credit
   * it to absence deadlines (grace/turn/round_wait — ADDENDUM J) when it
   * exceeds one presence window so a returning player gets a fresh window
   * instead of an instant cover, then stamp `last_processed_at = now`.
   * Returns the gap. Idempotent per wake.
   */
  private onWake(sql: SqlLike, now: number): number {
    const last = this.repo.getLastProcessedAt()
    const gap = last == null ? 0 : now - last
    if (gap > PRESENCE_MS) creditEvictionGap(sql, gap)
    this.repo.setLastProcessedAt(now)
    return gap
  }

  /** Ensure the abandon/re-drive self-tick is armed while the game is active. */
  private ensureHeal(sql: SqlLike, now: number): void {
    if (!hasTimer(sql, 'heal', GLOBAL_SEAT)) setTimer(sql, 'heal', GLOBAL_SEAT, now + HEAL_MS)
  }

  /**
   * The `heal` self-tick: while active, when ZERO humans have been present
   * for longer than the abandon window, mark the game abandoned (recoverable
   * by replay if reopened) — the only thing absence alone can ever resolve
   * (never a forfeit). While humans are present (or the abandon window has
   * not elapsed) it just re-arms itself and returns.
   *
   * Owner's decision (2026-07-18, no-AI-takeover rework): this used to ALSO
   * safety-re-drive any AI-covered seat and re-arm both absence covers
   * (`driveIfAI`/`armDisconnectCoverIfAbsent`/`armRoundWaitIfAbsent`) every
   * tick while a human watched. That machinery drove/armed COVER FROM
   * ABSENCE specifically — the thing Vijay explicitly no longer wants: an
   * absent player's turn now simply PAUSES (see `CLAIM_GRACE_MS`'s
   * docstring), never auto-covers, never auto-advances. Those three calls
   * are removed here; the functions themselves stay defined (still
   * unit/fuzz-tested, and `driveIfAI` still matters for `/leave`'s
   * deliberate, human-initiated AI-cover — see `handleLeave`/`handleHeartbeat`,
   * which are untouched) — this self-tick just no longer invokes them.
   */
  private healTick(sql: SqlLike, now: number): void {
    const meta = this.repo.getMeta()
    if (!meta || meta.status !== 'active') return // terminal -> stop ticking

    if (isAnyHumanPresent(this.repo, now)) {
      setTimer(sql, 'heal', GLOBAL_SEAT, now + HEAL_MS)
      return
    }

    const seen = maxLastSeen(this.repo)
    if (seen != null && now - seen > PAUSE_ABANDON_MS) {
      this.repo.putMeta({ ...meta, status: 'abandoned' })
      this.ctx.waitUntil(this.runArchiveTick(now)) // finalize the abandoned game in D1
      return // stop ticking — the game is abandoned
    }
    // Frozen but not yet abandoned -> keep checking.
    setTimer(sql, 'heal', GLOBAL_SEAT, now + HEAL_MS)
  }

  /**
   * The internal next-round-advance path — the deal helper `POST /next-round`
   * calls (`handleNextRound`). Mirrors `handleNextRound`'s deal logic exactly
   * (`prevLoser` from `scoreRound` of the just-ended snapshot). Idempotent
   * per round: the phase check re-runs INSIDE the synchronous span, so a
   * racing second caller is a benign no-op. Returns whether a deal actually
   * happened.
   *
   * Owner's decision (2026-07-18, no-AI-takeover rework): this was ALSO
   * previously the alarm's `round_wait` case's target — a server-initiated
   * forced advance so a present player was never stuck waiting on an absent
   * one to click Continue. That auto-advance-on-absence is gone (round_end
   * now simply PAUSES like every other absent turn — see `CLAIM_GRACE_MS`'s
   * docstring for the present player's new resolution), so `round_wait` is
   * never armed anymore and the alarm no longer calls this method at all —
   * `POST /next-round` (a human pressing Continue) is its only caller now.
   * The post-deal wheel is correspondingly trimmed: `driveIfAI`/
   * `armDisconnectCoverIfAbsent` drove/armed COVER FROM ABSENCE specifically
   * and are dropped (there is no AI to drive into a freshly-opened round);
   * `ensureHeal` + `rearmAlarm` stay (the abandon-after-long-inactivity heal
   * tick is unrelated to AI-cover and still needs to stay armed).
   */
  private async advanceRoundInternal(now: number): Promise<boolean> {
    const meta = this.repo.getMeta()
    if (!meta || meta.phase !== 'round_end') return false
    const snapshot = this.repo.getSnapshot()
    if (!snapshot) return false
    const result = scoreRound(snapshot)
    const prevLoser: 0 | 1 | undefined = result.sealAwardedTo === 0 ? 1 : result.sealAwardedTo === 1 ? 0 : undefined
    const targetRound = meta.round + 1

    let dealt = false
    this.ctx.storage.transactionSync(() => {
      const freshMeta = this.repo.getMeta()!
      if (freshMeta.phase !== 'round_end') return // raced — someone else already dealt
      dealRound(this.repo, targetRound, prevLoser, now)
      dealt = true
    })

    if (dealt) {
      const freshMeta = this.repo.getMeta()!
      this.nudge(freshMeta.move_index)
      const sql = this.ctx.storage.sql as unknown as SqlLike
      this.ensureHeal(sql, now)
      await rearmAlarm(this.ctx, sql)
    }
    return dealt
  }

  /**
   * The CPU-kill floor: an O(1) always-legal `floorMove` (ADDENDUM N) for
   * the current AI-covered seat. This CANNOT be CPU-killed the way the
   * smart medium AI search could be, so it guarantees the turn advances past
   * a seat whose computation was killed mid-invocation. The deterministic
   * `floor:seat:targetMoveIndex` id makes a re-fire benign. ADDENDUM K:
   * guarded by `phase === 'playing'` — never floors at round_end/match_over.
   */
  private applyFloor(sql: SqlLike, now: number): void {
    const meta = this.repo.getMeta()
    if (!meta || meta.status !== 'active') return
    if (meta.phase !== 'playing') return // ADDENDUM K
    const seat = meta.current_seat
    const seatRow = this.repo.getSeats()[seat]
    if (!seatRow || !seatRow.controlled_by_ai) return // only floor an AI-covered seat
    const snapshot = this.repo.getSnapshot()
    if (!snapshot) return

    const targetMoveIndex = meta.move_index + 1
    const result = this.ctx.storage.transactionSync(() =>
      applyAndPersist(this.repo, {
        seatIndex: seat,
        move: floorMove(snapshot),
        clientMoveId: `floor:${seat}:${targetMoveIndex}`,
        accountId: null,
        byAi: true,
        aiDifficulty: 'floor',
        expectedSeat: seat,
        requireAiControlled: true,
        now,
      }),
    )
    if ('ok' in result && result.ok) {
      this.nudge(result.moveIndex)
      // Keep the wheel turning: if the new current seat is AI (and still
      // mid-round), schedule a drive.
      const after = this.repo.getMeta()
      if (after && after.status === 'active' && after.phase === 'playing') {
        const nextRow = this.repo.getSeats()[after.current_seat]
        if (nextRow && nextRow.controlled_by_ai) setTimer(sql, 'ai_step', after.current_seat, now)
      }
    }
  }

  /**
   * POST /heartbeat — presence is the SOLE authority for the drive/freeze
   * decision. requireAuth; the seat is resolved LIVE from account ownership
   * (a client can never heartbeat a seat it does not own). Refreshes
   * `last_seen_at`, clears this seat's absence deadlines (grace/turn/
   * round_wait), and re-runs the drive loop (unfreezes a game / hands a
   * covered-but-returned table back on the next iteration).
   */
  private async handleHeartbeat(request: Request): Promise<Response> {
    const auth = await requireAuth(request, this.env)
    if (auth instanceof Response) return auth

    const meta = this.repo.getMeta()
    if (!meta) return json({ error: 'game_not_found' }, 404)

    const seat = this.repo.seatOwnedBy(auth.accountId)
    if (!seat) return json({ error: 'not_your_seat' }, 403)
    const seatIndex = seat.seat_index

    const sql = this.ctx.storage.sql as unknown as SqlLike
    const now = Date.now()
    // A heartbeat is the credit trigger too: it refreshes THIS seat's
    // presence first, so onWake's eviction credit protects the OTHER seat's
    // deadlines.
    this.repo.setPresence(seatIndex, now)
    this.onWake(sql, now)
    clearTimer(sql, 'grace', seatIndex)
    clearTimer(sql, 'turn', seatIndex)
    clearTimer(sql, 'round_wait', seatIndex)
    this.ensureHeal(sql, now)
    driveIfAI(this.driveDeps(), this.repo, sql, now)
    await rearmAlarm(this.ctx, sql)
    // A heartbeat can un-freeze the drive loop and commit an AI move — archive it.
    this.ctx.waitUntil(this.runArchiveTick(now))
    return json({ ok: true, seat: seatIndex })
  }

  /**
   * POST /reclaim — atomic SILENT reclaim. The authed account's own seat is
   * taken back from AI cover in ONE synchronous critical section, in order:
   *   1. cancel this seat's grace/turn/ai_step/round_wait timers;
   *   2. clear controlled_by_ai;
   *   3. clear disconnected_at + set last_seen_at = now (a fresh heartbeat);
   * then re-arm the platform alarm to the new min(fire_at).
   *
   * A committed AI move is NEVER rolled back here (veto is deferred —
   * ADDENDUM B) — the human resumes from the CURRENT snapshot. If the
   * reclaimed seat is the current turn, control is now the human's: no
   * auto-cover re-fires (controlled_by_ai is cleared) and driveIfAI is a
   * no-op for it. The redacted view is returned LAST.
   */
  private async handleReclaim(request: Request): Promise<Response> {
    const auth = await requireAuth(request, this.env)
    if (auth instanceof Response) return auth

    const meta = this.repo.getMeta()
    if (!meta) return json({ error: 'game_not_found' }, 404)

    const seat = this.repo.seatOwnedBy(auth.accountId)
    if (!seat) return json({ error: 'not_your_seat' }, 403)
    const seatIndex = seat.seat_index

    const snapshot = this.repo.getSnapshot()
    if (!snapshot) return json({ error: 'no_snapshot' }, 404)

    const sql = this.ctx.storage.sql as unknown as SqlLike
    const now = Date.now()
    this.onWake(sql, now) // credit any eviction gap + stamp last_processed_at

    // ONE critical section, zero awaits inside — ordered checklist.
    this.ctx.storage.transactionSync(() => {
      clearTimer(sql, 'grace', seatIndex)
      clearTimer(sql, 'turn', seatIndex)
      clearTimer(sql, 'ai_step', seatIndex)
      clearTimer(sql, 'round_wait', seatIndex)
      this.repo.setControlledByAi(seatIndex, false)
      this.repo.setPresence(seatIndex, now) // last_seen_at = now, disconnected_at = NULL
    })

    this.ensureHeal(sql, now)
    await rearmAlarm(this.ctx, sql)

    const freshMeta = this.repo.getMeta()!
    const view = buildClientView(this.repo.getSnapshot()!, freshMeta, seatIndex, this.repo.getSeats(), now)
    return json({ moveIndex: freshMeta.move_index, view })
  }

  /**
   * POST /leave — graceful "step away, resume later" (NOT a resign, NOT a
   * forfeit, and — since Vijay's 2026-07-18 no-AI-takeover ruling — NO AI
   * cover). The match keeps going, the seat stays OWNED, and the game persists
   * (the whole point of the DO: reopen it from "Your games" anytime). We simply
   * mark this seat away NOW (set `disconnected_at`, stale `last_seen_at`) so the
   * opponent immediately sees "away" and the CLAIM_GRACE_MS window for their
   * optional /claim-win starts from this instant instead of waiting for the
   * heartbeat to lapse. The leaver `/reclaim`s or just re-syncs on return. The
   * game is never auto-ended from a leave — only the present player can end it
   * (via /claim-win once the grace elapses), or it abandons after ~7 idle days.
   */
  private async handleLeave(request: Request): Promise<Response> {
    const auth = await requireAuth(request, this.env)
    if (auth instanceof Response) return auth

    const meta = this.repo.getMeta()
    if (!meta) return json({ error: 'game_not_found' }, 404)

    const seat = this.repo.seatOwnedBy(auth.accountId)
    if (!seat) return json({ error: 'not_your_seat' }, 403)

    const sql = this.ctx.storage.sql as unknown as SqlLike
    const now = Date.now()
    this.onWake(sql, now)

    // Mark this seat away immediately — NO AI cover, NO forfeit, seat kept.
    // last_seen_at is pushed back past PRESENCE_MS so the opponent's view flips
    // to "away" and claimWinAvailable becomes true after CLAIM_GRACE_MS from now.
    this.repo.setDisconnectedAt(seat.seat_index, now)
    this.repo.setPresence(seat.seat_index, now - PRESENCE_MS - 1)
    // Nudge the opponent so their client reflects the away state promptly.
    this.nudge(meta.move_index)
    this.ensureHeal(sql, now) // keep the ~7-day abandon backstop armed
    await rearmAlarm(this.ctx, sql)
    return json({ ok: true, seat: seat.seat_index })
  }

  /**
   * POST /tick — the cron sweep's self-heal poke (unauthenticated: only
   * reachable via the DO stub, never the public Worker router). On wake it
   * credits any eviction gap, runs the heal path (safety re-drive while
   * humans are present, or abandon after a long absence), re-arms the wheel,
   * and — since a cron tick is not latency-sensitive — AWAITS the archive
   * drain so any archive_outbox rows a prior D1 hiccup left behind are
   * retried synchronously.
   *
   * FIX 7 (minor): a still-`'waiting'` room (created, never joined) has no
   * `healTick`/never-stall path of its own — nothing else ever visits it
   * again once its DO goes idle. `index.ts`'s cron only invokes `/tick` on a
   * `'waiting'` game once D1's `last_activity_at` is ALREADY stale past
   * `WAITING_ABANDON_MS`, so this trusts that pre-filter rather than
   * re-deriving staleness from a DO-local timestamp (`createWaitingRoom`
   * never stamps one — a fresh, still-being-joined room simply never reaches
   * this branch, since the cron never pokes it). Flipping to `'abandoned'`
   * here also finalizes D1 via `runArchiveTick`'s terminal-status branch
   * below (belt and suspenders with the cron's own direct D1 update).
   */
  private async handleTick(_request: Request): Promise<Response> {
    const sql = this.ctx.storage.sql as unknown as SqlLike
    const now = Date.now()
    this.onWake(sql, now)
    const meta = this.repo.getMeta()
    if (meta && meta.status === 'active') this.healTick(sql, now)
    if (meta && meta.status === 'waiting') this.repo.putMeta({ ...meta, status: 'abandoned' })
    await rearmAlarm(this.ctx, sql)
    await this.runArchiveTick(now) // drain unflushed outbox + finalize on end
    return json({ ok: true })
  }

  /**
   * The never-stall floor + timer-wheel dispatch (grace/turn/ai_step/heal/
   * round_wait). The single platform Alarm fires at min(fire_at). Wrapped in
   * try/catch and ALWAYS re-arms before returning (CF abandons an alarm
   * after ~6 retries; the wheel must never be left unset while work
   * remains). On a RETRY (`alarmInfo.isRetry` — CF re-fires the SAME alarm
   * after a kill/throw), the O(1) CPU-kill floor runs instead of
   * recomputing, so a CPU limit degrades AI quality, never liveness. A
   * persisted attempt-counter is deliberately NOT used: a rolled-back
   * counter would re-run the killed path forever.
   */
  async alarm(alarmInfo?: { isRetry?: boolean; retryCount?: number }): Promise<void> {
    const sql = this.ctx.storage.sql as unknown as SqlLike
    const now = Date.now()
    try {
      // Boot grace-quarantine: credit any eviction gap to absence deadlines
      // BEFORE evaluating them, so a compute gap is never miscounted as absence.
      const gap = this.onWake(sql, now)

      if (alarmInfo?.isRetry) {
        this.applyFloor(sql, now)
        await rearmAlarm(this.ctx, sql)
        this.ctx.waitUntil(this.runArchiveTick(now)) // archive the floor move
        return
      }

      // Normal fire: the platform only fires at/after min(fire_at), so when
      // it fires the earliest timer IS due — process everything up to
      // max(now, min). After a LONG eviction we just credited (pushed out)
      // every absence deadline, so we must NOT sweep up to the (now-future)
      // min — use `now` and let the re-arm reschedule the credited deadlines
      // into the future (the quarantine window).
      const threshold = gap > PRESENCE_MS ? now : Math.max(now, minFireAt(sql) ?? now)
      for (const t of dueTimers(sql, threshold)) {
        switch (t.kind) {
          case 'grace':
          case 'turn':
            // Owner's decision (2026-07-18, no-AI-takeover rework): these
            // kinds are never armed by any live handler anymore (see
            // presence.ts's `armDisconnectCoverIfAbsent` — it still exists,
            // unit-tested, but nothing calls it) — an absent on-turn seat now
            // simply PAUSES the game (never auto-covered). This case only
            // fires at all if a pre-existing timer row from before this
            // change is still sitting in an already-live game's wheel;
            // clearing it (never `autoCover`) is a harmless one-time
            // cleanup, not a live behavior.
            clearTimer(sql, 'grace', t.seat)
            clearTimer(sql, 'turn', t.seat)
            break
          case 'ai_step':
            // Still real: `/leave` (untouched — a deliberate, human-initiated
            // "hand my seat to AI while I step away", not an absence auto-cover)
            // arms this, and `driveIfAI` is still the only path that ever
            // produces an AI move.
            clearTimer(sql, 'ai_step', t.seat)
            driveIfAI(this.driveDeps(), this.repo, sql, now)
            break
          case 'heal':
            clearTimer(sql, 'heal', t.seat)
            this.healTick(sql, now)
            break
          case 'round_wait':
            // Owner's decision (2026-07-18): never armed anymore (round_end
            // now pauses like every other absent turn — the present player's
            // resolution is POST /claim-win, not a forced advance). Same
            // harmless legacy-row cleanup as grace/turn above — never
            // `advanceRoundInternal`.
            clearTimer(sql, 'round_wait', t.seat)
            break
        }
      }
      await rearmAlarm(this.ctx, sql)
      // Archive any AI/floor/round-advance moves the wheel just committed.
      this.ctx.waitUntil(this.runArchiveTick(now))
    } catch {
      // Best-effort re-arm so the wheel is never lost, even on an unexpected throw.
      try {
        await rearmAlarm(this.ctx, sql)
      } catch {
        /* nothing more we can safely do here */
      }
    }
  }

  // ---- D1 archive write-through (Wave 4 fills archive.ts's bodies) --------

  /** Drain the DO-local archive_outbox to D1 + finalize on end. No-op stub
   *  until Wave 4 (see do/archive.ts). */
  private async runArchiveTick(now: number): Promise<void> {
    await archiveTick(this.env.DB, this.repo, now)
  }

  // ---- Handlers -------------------------------------------------------------

  /**
   * POST /games — create a 2-player waiting room (ADDENDUM R: the route is
   * /games, not /create-room). requireAuth resolves the host account from
   * the token (never a body field). Idempotent: a DO that already has a
   * `meta` row (a re-POST) returns the existing room untouched.
   */
  private async handleCreateRoom(request: Request): Promise<Response> {
    const auth = await requireAuth(request, this.env)
    if (auth instanceof Response) return auth

    let body: { matchLength?: unknown; displayName?: unknown; code?: unknown }
    try {
      body = (await request.json()) as typeof body
    } catch {
      return json({ error: 'bad_json' }, 400)
    }

    const existing = this.repo.getMeta()
    if (existing) {
      return json({ gameId: existing.game_uuid, code: existing.code, view: buildWaitingRoomView(this.repo) })
    }

    const matchLength = body.matchLength
    if (matchLength !== 1 && matchLength !== 3 && matchLength !== 5) {
      return json({ error: 'invalid_match_length' }, 400)
    }

    const hostDisplayName =
      typeof body.displayName === 'string' && body.displayName.trim().length > 0
        ? body.displayName.trim().slice(0, 40)
        : auth.displayName
    const code = typeof body.code === 'string' && body.code.length > 0 ? body.code : generateCode()

    const meta = createWaitingRoom(this.repo, {
      matchLength: matchLength as MatchLength,
      hostAccountId: auth.accountId,
      hostDisplayName,
      code,
    })

    // The lobby-registry row should be resolvable immediately (a friend may
    // join within seconds) — AWAIT this D1 write (currently a no-op stub;
    // Wave 4 fills the body), unlike the per-move archive below.
    await archiveGameCreate(this.env.DB, this.repo, Date.now(), meta.code)

    return json({ gameId: meta.game_uuid, code: meta.code, view: buildWaitingRoomView(this.repo) }, 201)
  }

  /**
   * POST /join — claim seat 1 in a `'waiting'` room. requireAuth; idempotent
   * for an account already seated (works mid-game = invite-link resume).
   * Since Jaipur is always 2-player, a fresh join immediately DEALS round 1
   * and flips the room active — there is no separate host-start ceremony
   * (design spec §3.8).
   */
  private async handleJoin(request: Request): Promise<Response> {
    const auth = await requireAuth(request, this.env)
    if (auth instanceof Response) return auth

    let body: { displayName?: unknown } = {}
    try {
      body = (await request.json()) as typeof body
    } catch {
      body = {}
    }

    const meta = this.repo.getMeta()
    if (!meta) return json({ error: 'game_not_found' }, 404)

    const seats = this.repo.getSeats()
    const already = seats.find((s) => s.owner_account_id === auth.accountId)
    if (already) {
      const view =
        meta.status === 'waiting'
          ? buildWaitingRoomView(this.repo)
          : buildClientView(this.repo.getSnapshot()!, meta, already.seat_index, seats, Date.now())
      return json({ seatIndex: already.seat_index, status: meta.status, view })
    }

    if (meta.status !== 'waiting') return json({ error: 'not_waiting' }, 409)

    const openSeat = seats.find((s) => s.owner_type === 'open')
    if (!openSeat) return json({ error: 'room_full' }, 409)

    const displayName =
      typeof body.displayName === 'string' && body.displayName.trim().length > 0
        ? body.displayName.trim().slice(0, 40)
        : auth.displayName

    // Claim the seat AND deal round 1 in ONE synchronous span, so two
    // racing joins can never both claim seat 1 / both deal.
    let joined = false
    this.ctx.storage.transactionSync(() => {
      const freshSeats = this.repo.getSeats()
      const freshOpen = freshSeats.find((s) => s.owner_type === 'open')
      if (!freshOpen) return // raced — someone else already claimed it
      this.repo.putSeat({
        ...freshOpen,
        owner_type: 'human',
        owner_account_id: auth.accountId,
        display_name: displayName,
        controlled_by_ai: false,
      })
      this.repo.putMeta({ ...this.repo.getMeta()!, status: 'active' })
      dealRound(this.repo, 1, undefined)
      joined = true
    })

    if (!joined) return json({ error: 'room_full' }, 409)

    this.ctx.waitUntil(archiveSeats(this.env.DB, this.repo, Date.now()))
    // Owner's decision (2026-07-18, no-AI-takeover rework): this used to ALSO
    // drive an AI-opening seat and arm cover for a silently-absent just-joined
    // seat (`driveIfAI`/`armDisconnectCoverIfAbsent`) — both dropped (no seat
    // is ever auto-covered from absence anymore; a silently-absent seat just
    // pauses the game on its turn, same as any other absence). `ensureHeal`
    // stays armed (the abandon-after-long-inactivity path is unrelated) and
    // the platform alarm still needs re-arming after touching the wheel.
    const now = Date.now()
    {
      const sql = this.ctx.storage.sql as unknown as SqlLike
      this.ensureHeal(sql, now)
      await rearmAlarm(this.ctx, sql)
    }

    const freshMeta = this.repo.getMeta()!
    const freshSeats = this.repo.getSeats()
    const joinedSeat = freshSeats.find((s) => s.owner_account_id === auth.accountId)!
    this.broadcast({ type: 'started' })

    const view = buildClientView(this.repo.getSnapshot()!, freshMeta, joinedSeat.seat_index, freshSeats, now)
    return json({ seatIndex: joinedSeat.seat_index, status: freshMeta.status, view })
  }

  /**
   * POST /move — the authoritative move endpoint. The ONLY awaits are
   * `request.json()` and `requireAuth`, both BEFORE the synchronous
   * `applyAndPersist` span, so the input gate stays closed across
   * read -> validate -> write.
   */
  private async handleMove(request: Request): Promise<Response> {
    let body: { seatIndex?: unknown; move?: unknown; clientMoveId?: unknown }
    try {
      body = (await request.json()) as typeof body
    } catch {
      return json({ error: 'bad_json' }, 400)
    }

    const auth = await requireAuth(request, this.env)
    if (auth instanceof Response) return auth

    const meta = this.repo.getMeta()
    if (!meta) return json({ error: 'game_not_found' }, 404)

    const seatIndex = body.seatIndex
    if (typeof seatIndex !== 'number' || !Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= meta.player_count) {
      return json({ error: 'invalid_seat' }, 400)
    }

    // Defense in depth: a caller may only move its OWN seat, resolved LIVE
    // from the token — closes the hand-leak at the HTTP door in addition to
    // the in-txn ownership check inside applyAndPersist.
    const ownSeat = this.repo.seatOwnedBy(auth.accountId)
    if (!ownSeat || seatIndex !== ownSeat.seat_index) return json({ error: 'not_your_seat' }, 403)

    const clientMoveId = body.clientMoveId ?? null
    if (clientMoveId !== null && (typeof clientMoveId !== 'string' || clientMoveId.length === 0)) {
      return json({ error: 'invalid_client_move_id' }, 400)
    }

    const shape = validateMovePayloadShape(body.move)
    if (!shape.ok) return json({ error: shape.error }, 400)

    // The acting account is token-derived (never a request-body field).
    const params: ApplyParams = { seatIndex, move: shape.move, clientMoveId, accountId: auth.accountId }
    const result = this.ctx.storage.transactionSync(() => applyAndPersist(this.repo, params))

    if ('error' in result) {
      return json(result, statusForError(result.error))
    }
    if ('duplicate' in result) {
      return json(result, 200) // benign ack, no new move -> no nudge
    }

    // Commit-then-nudge: only after the sync txn returned (committed).
    this.nudge(result.moveIndex)
    const now = Date.now()
    const sql = this.ctx.storage.sql as unknown as SqlLike
    this.ensureHeal(sql, now)
    // Owner's decision (2026-07-18, no-AI-takeover rework): this used to ALSO
    // drive a newly-current AI-covered seat and arm both absence covers
    // (`driveIfAI`/`armDisconnectCoverIfAbsent`/`armRoundWaitIfAbsent` on
    // round_end) — all dropped. A move landing on an absent seat's turn (or
    // ending the round with the other seat absent) now just PAUSES; the
    // present player's resolution is `POST /claim-win`, not an auto-cover or
    // a forced round-advance.
    const freshMeta = this.repo.getMeta()
    if (freshMeta && freshMeta.phase === 'match_over') {
      // A move naturally ended the match (a seat reached sealsNeeded). Same
      // defect class as resign: purge EVERY outstanding wheel timer for both
      // seats so a leftover grace/turn/round_wait can't fire autoCover / a
      // forced round-advance / a spurious ai_cover broadcast on a finished
      // game. runArchiveTick's terminal branch finalizes D1 + writes the
      // (idempotent) matches rows, so no separate archiveMatchEnd call.
      this.stopWheelTimers(sql)
    }
    await rearmAlarm(this.ctx, sql)
    this.ctx.waitUntil(this.runArchiveTick(now))
    return json(result, 200)
  }

  /** Cancel every outstanding absence/AI timer for both seats plus the heal
   *  self-tick — used whenever a match becomes terminal (resign or a natural
   *  sealsNeeded win) so the timer wheel goes fully quiet instead of
   *  zombie-ticking a finished game. Safe to call inside or outside a txn. */
  private stopWheelTimers(sql: SqlLike): void {
    for (const s of [0, 1] as const) {
      clearTimer(sql, 'grace', s)
      clearTimer(sql, 'turn', s)
      clearTimer(sql, 'ai_step', s)
      clearTimer(sql, 'round_wait', s)
    }
    clearTimer(sql, 'heal', GLOBAL_SEAT)
  }

  /**
   * GET /sync?since=k — the redacted recovery read. requireAuth; the
   * requesting seat is resolved from account ownership (403 if the account
   * owns no seat here); a `'waiting'` room has no board yet, so it returns
   * the roster instead.
   */
  private async handleSync(request: Request, url: URL): Promise<Response> {
    const auth = await requireAuth(request, this.env)
    if (auth instanceof Response) return auth

    const meta = this.repo.getMeta()
    if (!meta) return json({ error: 'game_not_found' }, 404)

    const ownSeat = this.repo.seatOwnedBy(auth.accountId)
    if (!ownSeat) return json({ error: 'not_your_seat' }, 403)

    if (meta.status === 'waiting') {
      return json(buildWaitingRoomView(this.repo))
    }

    const sinceRaw = url.searchParams.get('since')
    const since = sinceRaw == null ? 0 : Number(sinceRaw)
    if (!Number.isInteger(since) || since < 0) {
      return json({ error: 'invalid_since' }, 400)
    }

    const snapshot = this.repo.getSnapshot()
    if (!snapshot) return json({ error: 'no_snapshot' }, 404)

    const moves = this.repo.getMovesSince(since).map(toClientMove)

    return json({
      moveIndex: meta.move_index,
      view: buildClientView(snapshot, meta, ownSeat.seat_index, this.repo.getSeats(), Date.now()),
      moves,
    })
  }

  /**
   * POST /next-round — advance from `round_end` to the next deal. requireAuth;
   * seat owner; only legal in `phase:'round_end'` (`match_over` -> 409).
   * Idempotent per round: the phase check re-runs INSIDE the synchronous
   * span so a racing second caller sees `phase` already flipped to
   * `'playing'` and gets a benign `{already:true}` instead of double-dealing.
   * `prevLoser` (ADDENDUM F) is computed from `scoreRound` of the CURRENT
   * (just-ended) snapshot — the same value `buildClientView`'s
   * `lastRoundResult` would show — exactly mirroring gameStore.ts's offline
   * `nextRound` (~316-320): the OTHER seat from `sealAwardedTo`, `undefined`
   * on a complete tie (seat 0 opens).
   */
  private async handleNextRound(request: Request): Promise<Response> {
    const auth = await requireAuth(request, this.env)
    if (auth instanceof Response) return auth

    const meta = this.repo.getMeta()
    if (!meta) return json({ error: 'game_not_found' }, 404)

    const seat = this.repo.seatOwnedBy(auth.accountId)
    if (!seat) return json({ error: 'not_your_seat' }, 403)

    if (meta.phase === 'match_over') return json({ error: 'match_over' }, 409)

    const now = Date.now()

    if (meta.phase !== 'round_end') {
      // Not (yet, or any longer) in round_end — either a race with another
      // caller who already dealt (benign) or a genuinely wrong-phase call.
      const snapshot = this.repo.getSnapshot()
      if (!snapshot) return json({ error: 'no_snapshot' }, 404)
      return json({
        already: true,
        view: buildClientView(snapshot, meta, seat.seat_index, this.repo.getSeats(), now),
      })
    }

    // Delegate to advanceRoundInternal — the SINGLE source of the deal +
    // post-deal wheel (ensureHeal/rearmAlarm — no AI-cover wheel anymore,
    // see its docstring). Rebuild the view AFTER the call in case anything
    // advanced the state further.
    const dealt = await this.advanceRoundInternal(now)

    const freshMeta = this.repo.getMeta()!
    const view = buildClientView(this.repo.getSnapshot()!, freshMeta, seat.seat_index, this.repo.getSeats(), now)
    return json(dealt ? { view } : { already: true, view })
  }

  /**
   * POST /resign — mark the match over in the resigning player's favor for
   * the OTHER seat. requireAuth; seat owner; not already `match_over`.
   * Appends a server-minted `resign` move (attributed to the resigning seat
   * — unlike round_start/round_end, a resignation IS a specific seat's
   * action). Idempotent (a second resign on an already-resigned game is a
   * benign no-op inside the same synchronous span).
   *
   * FIX 3: unlike every OTHER mutating handler (move/join/heartbeat/reclaim/
   * leave), this used to commit `status:'resigned'`/`phase:'match_over'`
   * WITHOUT clearing any outstanding grace/turn/ai_step/round_wait timers (on
   * EITHER seat) or the heal self-tick, and without a `rearmAlarm` after —
   * leaving a zombie timer that could fire `autoCover`/`driveIfAI`/a forced
   * round-advance and broadcast on a match that has already ended. It also
   * archived via a direct `archiveMatchEnd` call rather than the
   * terminal-aware `runArchiveTick`, so D1's `games.status`/`ended_at` never
   * got finalized on a resign (only the `matches` stats rows did). Both are
   * fixed here: the timer sweep runs INSIDE the same synchronous span as the
   * resign commit (so it only happens once, on the call that actually wins
   * the race), and archiving now goes through `runArchiveTick` (whose
   * terminal branch calls `archiveMatchEnd` internally — idempotent per
   * FIX 1).
   */
  private async handleResign(request: Request): Promise<Response> {
    const auth = await requireAuth(request, this.env)
    if (auth instanceof Response) return auth

    const meta = this.repo.getMeta()
    if (!meta) return json({ error: 'game_not_found' }, 404)

    const seat = this.repo.seatOwnedBy(auth.accountId)
    if (!seat) return json({ error: 'not_your_seat' }, 403)

    if (meta.phase === 'match_over') return json({ error: 'match_over' }, 409)

    const otherSeat: 0 | 1 = seat.seat_index === 0 ? 1 : 0
    const now = Date.now()
    const sql = this.ctx.storage.sql as unknown as SqlLike

    this.ctx.storage.transactionSync(() => {
      const freshMeta = this.repo.getMeta()!
      if (freshMeta.phase === 'match_over') return // raced — already resolved
      const moveIndex = freshMeta.move_index + 1
      this.repo.insertMove({
        move_index: moveIndex,
        round: freshMeta.round,
        turn_number: this.repo.countTurnCompletingMoves(),
        seat_index: seat.seat_index,
        type: 'resign',
        payload: JSON.stringify({ type: 'resign', seat: seat.seat_index }),
        by_ai: false,
        ai_difficulty: null,
        controlling_account_id: seat.owner_account_id,
        client_move_id: null,
        reverted: false,
        created_at: now,
      })
      this.repo.putMeta({
        ...freshMeta,
        status: 'resigned',
        phase: 'match_over',
        winner_seat: otherSeat,
        move_index: moveIndex,
      })

      // FIX 3: the match is over — purge the whole timer wheel for both seats
      // + the heal self-tick so nothing zombie-ticks a dead match. Shared with
      // handleMove's natural match-over path via stopWheelTimers.
      this.stopWheelTimers(sql)
    })

    const freshMeta = this.repo.getMeta()!
    await rearmAlarm(this.ctx, sql)
    // FIX 3: route through the terminal-aware runArchiveTick (its terminal
    // branch calls archiveMatchEnd internally, idempotent per FIX 1) rather
    // than a direct archiveMatchEnd call, so D1's games.status/ended_at is
    // finalized too, not just the matches stats rows.
    this.ctx.waitUntil(this.runArchiveTick(now))
    this.nudge(freshMeta.move_index)

    const view = buildClientView(this.repo.getSnapshot()!, freshMeta, seat.seat_index, this.repo.getSeats(), now)
    return json({ view })
  }

  /**
   * POST /claim-win — NEW (owner's decision, 2026-07-18): the present
   * player's manual resolution when the opponent has genuinely, continuously
   * gone dark. Replaces AI-takeover as the "opponent ghosted" answer — Jaipur
   * is 2p, and an AI finishing the match wearing the absent player's name
   * would be misleading (muddies stats, reads as them still "playing"); the
   * new model is: absence just PAUSES the game on their turn, and the
   * present player alone gets to decide when enough is enough.
   *
   * requireAuth; seat owner; not already `match_over` (mirrors
   * `handleResign`'s shape exactly for these first three checks — same
   * error codes, same idempotency-via-race-recheck pattern). The ONE thing
   * this endpoint adds beyond resign: it VALIDATES the OTHER seat is
   * genuinely absent before allowing the claim — NOT merely
   * `!seatIndexPresent` (that only proves "no heartbeat in the last
   * `PRESENCE_MS`", true for anyone mid-reconnect) but continuously absent
   * for `CLAIM_GRACE_MS` LONGER on top of that, so a brief network blip can
   * never be raced into a stolen win. A seat that has never once heartbeated
   * (`last_seen_at === null`) can never be claimed against here either —
   * that is "not yet measured", not "measured and gone" (see the null guard
   * below; mirrors `buildClientView`'s `claimWinAvailable` — same formula,
   * checked independently server-side rather than trusted from the client).
   * A present/recently-seen opponent gets 409 `opponent_present`.
   *
   * On success: appends a server-minted `claim_win` move (never `by_ai` —
   * this is the CLAIMER's own action, just one that ends the match on the
   * absent seat's behalf), reuses the `'resigned'` terminal status (same
   * stats bucket as an explicit resignation — "opponent abandoned" and
   * "opponent resigned" are the same shape for leaderboard/history
   * purposes), sets `winner_seat` to the CLAIMER, and sweeps the whole timer
   * wheel via `stopWheelTimers` — identical terminal-state hygiene to
   * `handleResign`. Idempotent: a second call after `match_over` hits the
   * same 409 the first phase check would.
   */
  private async handleClaimWin(request: Request): Promise<Response> {
    const auth = await requireAuth(request, this.env)
    if (auth instanceof Response) return auth

    const meta = this.repo.getMeta()
    if (!meta) return json({ error: 'game_not_found' }, 404)

    const seat = this.repo.seatOwnedBy(auth.accountId)
    if (!seat) return json({ error: 'not_your_seat' }, 403)

    if (meta.phase === 'match_over') return json({ error: 'match_over' }, 409)

    const otherIndex: 0 | 1 = seat.seat_index === 0 ? 1 : 0
    const now = Date.now()
    const sql = this.ctx.storage.sql as unknown as SqlLike

    const otherSeat = this.repo.getSeats()[otherIndex]
    const otherGenuinelyAbsent =
      !!otherSeat &&
      !seatIndexPresent(this.repo, otherIndex, now) &&
      otherSeat.last_seen_at != null &&
      now - otherSeat.last_seen_at >= CLAIM_GRACE_MS
    if (!otherGenuinelyAbsent) return json({ error: 'opponent_present' }, 409)

    this.ctx.storage.transactionSync(() => {
      const freshMeta = this.repo.getMeta()!
      if (freshMeta.phase === 'match_over') return // raced — already resolved
      const moveIndex = freshMeta.move_index + 1
      this.repo.insertMove({
        move_index: moveIndex,
        round: freshMeta.round,
        turn_number: this.repo.countTurnCompletingMoves(),
        seat_index: seat.seat_index,
        type: 'claim_win',
        payload: JSON.stringify({ type: 'claim_win', seat: seat.seat_index }),
        by_ai: false,
        ai_difficulty: null,
        controlling_account_id: seat.owner_account_id,
        client_move_id: null,
        reverted: false,
        created_at: now,
      })
      this.repo.putMeta({
        ...freshMeta,
        status: 'resigned',
        phase: 'match_over',
        winner_seat: seat.seat_index as 0 | 1,
        move_index: moveIndex,
      })

      // Same terminal-state hygiene as handleResign/handleMove's natural
      // match-over path: purge the whole timer wheel so nothing zombie-ticks
      // a dead match.
      this.stopWheelTimers(sql)
    })

    const freshMeta = this.repo.getMeta()!
    await rearmAlarm(this.ctx, sql)
    // Route through the terminal-aware runArchiveTick (its terminal branch
    // calls archiveMatchEnd internally, idempotent) so D1's
    // games.status/ended_at AND the matches stats rows both finalize.
    this.ctx.waitUntil(this.runArchiveTick(now))
    this.nudge(freshMeta.move_index)

    const view = buildClientView(this.repo.getSnapshot()!, freshMeta, seat.seat_index, this.repo.getSeats(), now)
    return json({ view })
  }
}

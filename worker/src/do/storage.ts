import type { GameState } from '../../../src/engine'
import { encodeState, decodeState } from './state-codec'

/**
 * Durable Object SQLite schema + repository — PORTED from viota's
 * packages/worker/src/do/storage.ts and adapted to Jaipur's match model
 * (design spec §3.1/§6, ADDENDUM D/G/J).
 *
 * Uses the SYNCHRONOUS SQLite API (`ctx.storage.sql.exec(...)`) — NOT the
 * async `state.storage.transaction()`. The input gate only stays closed
 * across a synchronous span; an `await` in the middle of a read->write would
 * let a move POST and an alarm interleave onto the same move_index. Every
 * write path in the DO runs as one synchronous span (Wave 2+).
 *
 * Columns are TEXT + CHECK, never native ENUM (adding a new status later is
 * an insert, not a painful `ALTER TYPE`).
 *
 * This is the repository boundary (the exit hatch): the move log is
 * portable SQL that can re-home on Postgres/Turso.
 *
 * KEY DIFFERENCES FROM VIOTA'S SHAPE (all per the locked design docs):
 *  - `meta` carries MatchState's authoritative seals/round/phase directly
 *    (ADDENDUM D: "MatchState.seals/round/phase are the ONLY authoritative
 *    copies" — the embedded engine GameState also has stale `seals`/`round`/
 *    `phase` fields frozen at setup time; every consumer must read THESE
 *    meta columns, never the engine object's). `meta` also folds in viota's
 *    separate `runtime.last_processed_at` as a column directly (Jaipur
 *    simplification — one row to read/write instead of two tables).
 *  - a NEW `rounds` table (round, seed, initial_state) — ADDENDUM G: persist
 *    BOTH the seed and the post-deal state per round, so replay can use
 *    either once determinism is verified (Wave 2 test).
 *  - `initial_state` (viota's single-row, whole-GAME immutable anchor) does
 *    NOT exist here — its role is superseded by the per-round `rounds` table,
 *    since Jaipur is multi-round within one match and each round needs its
 *    OWN replay anchor, not just one for the whole game.
 *  - `moves.type` allows Jaipur's engine action union (TAKE_SINGLE,
 *    TAKE_CAMELS, TAKE_EXCHANGE, SELL) PLUS the server-minted match-lifecycle
 *    move types (round_start, round_end, resign) that narrate round/match
 *    transitions in the same continuous log (design spec §3.2). There is no
 *    Jaipur analog of viota's `wild_recycle` (every Jaipur move consumes the
 *    turn — design spec §3.3).
 *  - `moves.payload` for a real action is the TRANSLATED PUBLIC payload
 *    (ADDENDUM H), computed at commit time from the pre-move state — NEVER
 *    the raw `{marketIndices, handIndices}` action, which would require the
 *    private hand array to interpret. That translation happens in Wave 2's
 *    do/apply.ts; this table just stores whatever JSON string it's given.
 *  - `moves.score_delta` / `score_after` (viota, single running score) are
 *    DROPPED — Jaipur scores are per-round (scoreRound output) and per-seat
 *    rupee totals aren't a running per-move counter; round outcomes live in
 *    the server-minted `round_end` move's payload instead.
 *  - `seats` drops viota's `ghost_id` (no ghost-account concept here — every
 *    account is VGames-identity-authenticated, introspect-only, no local
 *    accounts table) and `final_score` (Jaipur's per-seat result lives in D1
 *    `game_players.result`, written at archive time, not per-seat in the
 *    DO — the DO doesn't need a running "final score" column since the match
 *    winner is derived from `seals` per ADDENDUM C).
 *  - `timers.kind` CHECK constraint includes `round_wait` (ADDENDUM J) up
 *    front, even though do/timers.ts (which defines the TS `TimerKind` union)
 *    is Wave 3 — the schema is forward-compatible from the start.
 *  - `archive_outbox` is copied verbatim (unchanged shape/semantics).
 *
 * DELIBERATELY NOT PORTED from viota's GameRepository (see design spec /
 * ADDENDUM B — veto is a deferred fast-follow, not built tonight):
 *  - `putInitialState`/`getInitialState` (superseded by putRound/getRound).
 *  - `markReverted` — the `moves.reverted` column exists (forward-compatible
 *    schema, mirrors viota's "never delete, columns land in the first
 *    schema" philosophy) but NO code path flips it in this repo yet; that is
 *    veto's job when it fast-follows. Wave 2/3 must not need it (ADDENDUM B:
 *    "no reverted-move machinery, no round-scoped tail scan" for v1).
 *  - `setDisconnectedAt` — viota's presence.ts calls this; Jaipur's Wave 3
 *    presence/timers port can add it back here in one line when it lands
 *    (trivial `UPDATE seats SET disconnected_at = ? WHERE seat_index = ?`),
 *    omitted now because nothing in Wave 1 calls it and the task scope is
 *    "at minimum" the listed surface.
 */

// A structural subset of Cloudflare's SqlStorage (avoids a hard type import).
export interface SqlLike {
  exec(query: string, ...bindings: unknown[]): { [Symbol.iterator](): Iterator<Record<string, unknown>> }
}

export type Migration = (sql: SqlLike) => void

// ---- Migrations ------------------------------------------------------------

const migrateV1: Migration = (sql) => {
  // The MatchState meta row (ADDENDUM D: THE authoritative seals/round/phase
  // — never the embedded engine GameState's stale setup-time fields).
  sql.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      id                 INTEGER PRIMARY KEY CHECK (id = 1),
      game_uuid          TEXT    NOT NULL,
      code               TEXT,
      status             TEXT    NOT NULL DEFAULT 'waiting'
                           CHECK (status IN ('waiting','active','completed','stalemate','resigned','abandoned')),
      player_count       INTEGER NOT NULL DEFAULT 2,
      match_length       INTEGER NOT NULL CHECK (match_length IN (1, 3, 5)),
      seals0             INTEGER NOT NULL DEFAULT 0,
      seals1             INTEGER NOT NULL DEFAULT 0,
      round              INTEGER NOT NULL DEFAULT 1,
      phase              TEXT    NOT NULL DEFAULT 'playing'
                           CHECK (phase IN ('playing', 'round_end', 'match_over')),
      current_seat       INTEGER NOT NULL DEFAULT 0,
      move_index         INTEGER NOT NULL DEFAULT 0,
      winner_seat        INTEGER,
      engine_version     TEXT    NOT NULL,
      last_processed_at  INTEGER
    )
  `)

  // Rebuildable cache of the CURRENT round's engine GameState.
  sql.exec(`
    CREATE TABLE IF NOT EXISTS snapshot (
      id         INTEGER PRIMARY KEY CHECK (id = 1),
      state_json TEXT NOT NULL
    )
  `)

  // Per-round replay anchor (ADDENDUM G): both the seed AND the post-deal
  // state, one row per round, written exactly once when that round is dealt.
  sql.exec(`
    CREATE TABLE IF NOT EXISTS rounds (
      round               INTEGER PRIMARY KEY,
      seed                INTEGER NOT NULL,
      initial_state_json  TEXT    NOT NULL
    )
  `)

  // Append-only move log — the source of truth for replay + analytics.
  // Covers real engine actions AND server-minted lifecycle events (design
  // spec §3.2/§3.4/§3.5) so the log fully narrates the match.
  sql.exec(`
    CREATE TABLE IF NOT EXISTS moves (
      move_index             INTEGER PRIMARY KEY,
      round                  INTEGER NOT NULL,
      turn_number             INTEGER NOT NULL,
      seat_index              INTEGER NOT NULL,
      type                     TEXT    NOT NULL
                                 CHECK (type IN ('TAKE_SINGLE', 'TAKE_CAMELS', 'TAKE_EXCHANGE', 'SELL',
                                                  'round_start', 'round_end', 'resign')),
      payload                  TEXT    NOT NULL,
      by_ai                    INTEGER NOT NULL DEFAULT 0,
      ai_difficulty            TEXT,
      controlling_account_id   TEXT,
      client_move_id           TEXT,
      reverted                 INTEGER NOT NULL DEFAULT 0,
      created_at               INTEGER NOT NULL,
      UNIQUE (client_move_id)
    )
  `)

  sql.exec(`
    CREATE TABLE IF NOT EXISTS seats (
      seat_index       INTEGER PRIMARY KEY,
      owner_type       TEXT    NOT NULL CHECK (owner_type IN ('human', 'ai', 'open')),
      owner_account_id TEXT,
      display_name     TEXT,
      controlled_by_ai INTEGER NOT NULL DEFAULT 0,
      ai_difficulty    TEXT,
      last_seen_at     INTEGER,
      disconnected_at  INTEGER
    )
  `)

  // Durable timer-wheel; the single platform alarm is set to min(fire_at).
  // 'round_wait' is included in the CHECK now (ADDENDUM J) even though the
  // TS `TimerKind` union that names it lives in Wave 3's do/timers.ts.
  sql.exec(`
    CREATE TABLE IF NOT EXISTS timers (
      kind    TEXT    NOT NULL CHECK (kind IN ('grace', 'turn', 'ai_step', 'heal', 'soft', 'round_wait')),
      seat    INTEGER,
      fire_at INTEGER NOT NULL,
      PRIMARY KEY (kind, seat)
    )
  `)

  // DO-local write-through queue to the D1 archive (copied verbatim from
  // viota's v3 migration — see viota storage.ts for the full write-through
  // rationale). A row is enqueued (`flushed=0`) when a move commits; a
  // `ctx.waitUntil` flush to D1 (Wave 4 do/archive.ts) marks it `flushed=1`.
  sql.exec(`
    CREATE TABLE IF NOT EXISTS archive_outbox (
      move_index INTEGER PRIMARY KEY,
      flushed    INTEGER NOT NULL DEFAULT 0
    )
  `)
}

/**
 * NEW (owner's decision, 2026-07-18): widen `moves.type`'s CHECK constraint
 * to allow `'claim_win'` — the server-minted terminal move `POST /claim-win`
 * appends (see `game-do.ts`'s `handleClaimWin`). SQLite has no
 * `ALTER TABLE ... ADD CONSTRAINT` / `MODIFY CHECK`, so widening a CHECK
 * requires the standard rebuild dance: create the new-shape table under a
 * temp name, copy every existing row across with a straight
 * `INSERT ... SELECT *` (safe ONLY because the column list/order below is
 * byte-identical to migrateV1's — verified by inspection), drop the old
 * table, rename. Runs at most once per DO (`runMigrations`'s
 * schema_version gate), so it never needs to be idempotent on its own.
 */
const migrateV2: Migration = (sql) => {
  sql.exec(`
    CREATE TABLE moves_v2 (
      move_index             INTEGER PRIMARY KEY,
      round                  INTEGER NOT NULL,
      turn_number             INTEGER NOT NULL,
      seat_index              INTEGER NOT NULL,
      type                     TEXT    NOT NULL
                                 CHECK (type IN ('TAKE_SINGLE', 'TAKE_CAMELS', 'TAKE_EXCHANGE', 'SELL',
                                                  'round_start', 'round_end', 'resign', 'claim_win')),
      payload                  TEXT    NOT NULL,
      by_ai                    INTEGER NOT NULL DEFAULT 0,
      ai_difficulty            TEXT,
      controlling_account_id   TEXT,
      client_move_id           TEXT,
      reverted                 INTEGER NOT NULL DEFAULT 0,
      created_at               INTEGER NOT NULL,
      UNIQUE (client_move_id)
    )
  `)
  sql.exec(`
    INSERT INTO moves_v2
      (move_index, round, turn_number, seat_index, type, payload, by_ai,
       ai_difficulty, controlling_account_id, client_move_id, reverted, created_at)
    SELECT
      move_index, round, turn_number, seat_index, type, payload, by_ai,
      ai_difficulty, controlling_account_id, client_move_id, reverted, created_at
    FROM moves
  `)
  sql.exec(`DROP TABLE moves`)
  sql.exec(`ALTER TABLE moves_v2 RENAME TO moves`)
}

/** Ordered migration list. Index i is schema version (i+1). */
export const MIGRATIONS: Migration[] = [migrateV1, migrateV2]

/**
 * Idempotent forward migrator. Safe to run on every DO boot: creates the
 * version table, applies only migrations newer than the stored version, and
 * leaves a single up-to-date `schema_version` row. A 2nd-generation binary
 * opens a 1st-generation DO cleanly.
 */
export function runMigrations(sql: SqlLike, migrations: Migration[] = MIGRATIONS): void {
  sql.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`)
  const rows = [...sql.exec(`SELECT version FROM schema_version LIMIT 1`)]
  let current = rows.length ? Number((rows[0] as { version: number }).version) : 0
  if (rows.length === 0) {
    sql.exec(`INSERT INTO schema_version (version) VALUES (0)`)
    current = 0
  }
  for (let v = current; v < migrations.length; v++) {
    migrations[v]!(sql)
  }
  sql.exec(`UPDATE schema_version SET version = ?`, migrations.length)
}

// ---- Row types -------------------------------------------------------------

export type MatchStatus = 'waiting' | 'active' | 'completed' | 'stalemate' | 'resigned' | 'abandoned'
export type MatchPhase = 'playing' | 'round_end' | 'match_over'
export type MatchLength = 1 | 3 | 5

export type MetaRow = {
  game_uuid: string
  code: string | null
  status: MatchStatus
  player_count: number
  match_length: MatchLength
  seals0: number
  seals1: number
  round: number
  phase: MatchPhase
  current_seat: number
  move_index: number
  winner_seat: 0 | 1 | null
  engine_version: string
  last_processed_at: number | null
}

export type SeatOwnerType = 'human' | 'ai' | 'open'

export type SeatRow = {
  seat_index: number
  owner_type: SeatOwnerType
  owner_account_id: string | null
  display_name: string | null
  controlled_by_ai: boolean
  ai_difficulty: string | null
  last_seen_at: number | null
  disconnected_at: number | null
}

export type MoveType =
  | 'TAKE_SINGLE'
  | 'TAKE_CAMELS'
  | 'TAKE_EXCHANGE'
  | 'SELL'
  | 'round_start'
  | 'round_end'
  | 'resign'
  | 'claim_win'

export type MoveRow = {
  move_index: number
  round: number
  turn_number: number
  seat_index: number
  type: MoveType
  /** JSON string. For a real action: the TRANSLATED PUBLIC payload
   *  (ADDENDUM H). For a lifecycle move: whatever shape do/apply.ts (Wave 2)
   *  defines for round_start/round_end/resign. */
  payload: string
  by_ai: boolean
  ai_difficulty: string | null
  controlling_account_id: string | null
  client_move_id: string | null
  reverted: boolean
  created_at: number
}

export type RoundRow = {
  round: number
  seed: number
  initialState: GameState
}

// ---- Repository ------------------------------------------------------------

export class GameRepository {
  constructor(private readonly sql: SqlLike) {}

  private all(query: string, ...bindings: unknown[]): Record<string, unknown>[] {
    return [...this.sql.exec(query, ...bindings)]
  }

  // ---- meta (MatchState) ----------------------------------------------------

  getMeta(): MetaRow | null {
    const r = this.all(`SELECT * FROM meta WHERE id = 1`)[0]
    if (!r) return null
    return {
      game_uuid: String(r.game_uuid),
      code: r.code == null ? null : String(r.code),
      status: r.status as MetaRow['status'],
      player_count: Number(r.player_count),
      match_length: Number(r.match_length) as MatchLength,
      seals0: Number(r.seals0),
      seals1: Number(r.seals1),
      round: Number(r.round),
      phase: r.phase as MatchPhase,
      current_seat: Number(r.current_seat),
      move_index: Number(r.move_index),
      winner_seat: r.winner_seat == null ? null : (Number(r.winner_seat) as 0 | 1),
      engine_version: String(r.engine_version),
      last_processed_at: r.last_processed_at == null ? null : Number(r.last_processed_at),
    }
  }

  putMeta(m: MetaRow): void {
    this.sql.exec(
      `INSERT INTO meta
         (id, game_uuid, code, status, player_count, match_length, seals0, seals1,
          round, phase, current_seat, move_index, winner_seat, engine_version, last_processed_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         game_uuid = excluded.game_uuid,
         code = excluded.code,
         status = excluded.status,
         player_count = excluded.player_count,
         match_length = excluded.match_length,
         seals0 = excluded.seals0,
         seals1 = excluded.seals1,
         round = excluded.round,
         phase = excluded.phase,
         current_seat = excluded.current_seat,
         move_index = excluded.move_index,
         winner_seat = excluded.winner_seat,
         engine_version = excluded.engine_version,
         last_processed_at = excluded.last_processed_at`,
      m.game_uuid,
      m.code,
      m.status,
      m.player_count,
      m.match_length,
      m.seals0,
      m.seals1,
      m.round,
      m.phase,
      m.current_seat,
      m.move_index,
      m.winner_seat,
      m.engine_version,
      m.last_processed_at,
    )
  }

  /** Wall-clock of the last handler/alarm entry (null before the first one).
   *  Folded into `meta` directly (Jaipur simplification of viota's separate
   *  `runtime` table — see file header). */
  getLastProcessedAt(): number | null {
    const r = this.all(`SELECT last_processed_at FROM meta WHERE id = 1`)[0]
    return r && r.last_processed_at != null ? Number(r.last_processed_at) : null
  }

  setLastProcessedAt(now: number): void {
    this.sql.exec(`UPDATE meta SET last_processed_at = ? WHERE id = 1`, now)
  }

  // ---- snapshot (current round's engine GameState) --------------------------

  putSnapshot(gs: GameState): void {
    this.sql.exec(
      `INSERT INTO snapshot (id, state_json) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json`,
      encodeState(gs),
    )
  }

  getSnapshot(): GameState | null {
    const r = this.all(`SELECT state_json FROM snapshot WHERE id = 1`)[0]
    return r ? decodeState(String(r.state_json)) : null
  }

  // ---- rounds (per-round replay anchor: seed + post-deal state) -------------

  /** Write a round's replay anchor exactly once; a re-insert of the same
   *  round number is a no-op (immutable, like viota's write-once
   *  initial_state — a round is dealt exactly once). */
  putRound(round: number, seed: number, initialState: GameState): void {
    this.sql.exec(
      `INSERT INTO rounds (round, seed, initial_state_json) VALUES (?, ?, ?)
       ON CONFLICT(round) DO NOTHING`,
      round,
      seed,
      encodeState(initialState),
    )
  }

  getRound(round: number): RoundRow | null {
    const r = this.all(`SELECT round, seed, initial_state_json FROM rounds WHERE round = ?`, round)[0]
    if (!r) return null
    return {
      round: Number(r.round),
      seed: Number(r.seed),
      initialState: decodeState(String(r.initial_state_json)),
    }
  }

  // ---- moves ------------------------------------------------------------

  private static mapMoveRow(r: Record<string, unknown>): MoveRow {
    return {
      move_index: Number(r.move_index),
      round: Number(r.round),
      turn_number: Number(r.turn_number),
      seat_index: Number(r.seat_index),
      type: r.type as MoveType,
      payload: String(r.payload),
      by_ai: Number(r.by_ai) === 1,
      ai_difficulty: r.ai_difficulty == null ? null : String(r.ai_difficulty),
      controlling_account_id: r.controlling_account_id == null ? null : String(r.controlling_account_id),
      client_move_id: r.client_move_id == null ? null : String(r.client_move_id),
      reverted: Number(r.reverted) === 1,
      created_at: Number(r.created_at),
    }
  }

  /**
   * Append one move row. `move_index` is the PK and `client_move_id` is
   * UNIQUE, so a duplicate index (impossible in a sync span — a backstop) or
   * a duplicate client id will THROW; the caller catches it and returns a
   * benign conflict. Enqueues the move for D1 archive write-through in the
   * SAME sync span it committed in (Wave 4 drains it via ctx.waitUntil).
   */
  insertMove(m: MoveRow): void {
    this.sql.exec(
      `INSERT INTO moves
         (move_index, round, turn_number, seat_index, type, payload, by_ai,
          ai_difficulty, controlling_account_id, client_move_id, reverted, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      m.move_index,
      m.round,
      m.turn_number,
      m.seat_index,
      m.type,
      m.payload,
      m.by_ai ? 1 : 0,
      m.ai_difficulty,
      m.controlling_account_id,
      m.client_move_id,
      m.reverted ? 1 : 0,
      m.created_at,
    )
    this.enqueueOutbox(m.move_index)
  }

  /** A single move row by index (for the archive write-through), or null. */
  getMove(moveIndex: number): MoveRow | null {
    const r = this.all(`SELECT * FROM moves WHERE move_index = ?`, moveIndex)[0]
    return r ? GameRepository.mapMoveRow(r) : null
  }

  getMovesSince(k: number): MoveRow[] {
    return this.all(`SELECT * FROM moves WHERE move_index > ? ORDER BY move_index ASC`, k).map(
      GameRepository.mapMoveRow,
    )
  }

  /** In-txn idempotency probe (SQLite permits multiple NULL client_move_id). */
  moveExistsByClientId(clientMoveId: string): boolean {
    return this.all(`SELECT 1 FROM moves WHERE client_move_id = ? LIMIT 1`, clientMoveId).length > 0
  }

  /**
   * Count of committed turn-completing moves (a real engine action:
   * TAKE_SINGLE/TAKE_CAMELS/TAKE_EXCHANGE/SELL — not reverted). Jaipur has no
   * wild_recycle analog: every engine action consumes the turn (design spec
   * §3.3), so this simply excludes the server-minted lifecycle move types
   * (round_start/round_end/resign), which don't belong to a player's turn.
   */
  countTurnCompletingMoves(): number {
    const r = this.all(
      `SELECT COUNT(*) AS c FROM moves
       WHERE type IN ('TAKE_SINGLE', 'TAKE_CAMELS', 'TAKE_EXCHANGE', 'SELL') AND reverted = 0`,
    )[0]
    return r ? Number(r.c) : 0
  }

  // ---- archive_outbox (DO-local write-through queue to D1) -----------------

  /** Enqueue (or re-arm) a move for D1 flush: sets flushed=0 even if
   *  present. Synchronous SQL — safe in a span. */
  enqueueOutbox(moveIndex: number): void {
    this.sql.exec(
      `INSERT INTO archive_outbox (move_index, flushed) VALUES (?, 0)
       ON CONFLICT(move_index) DO UPDATE SET flushed = 0`,
      moveIndex,
    )
  }

  /** Mark an outbox row flushed after its D1 write-through succeeded. */
  markOutboxFlushed(moveIndex: number): void {
    this.sql.exec(`UPDATE archive_outbox SET flushed = 1 WHERE move_index = ?`, moveIndex)
  }

  /** Move indices still awaiting a D1 flush (ascending) — the cron/tick
   *  retry set. */
  unflushedOutbox(): number[] {
    return this.all(`SELECT move_index FROM archive_outbox WHERE flushed = 0 ORDER BY move_index ASC`).map((r) =>
      Number(r.move_index),
    )
  }

  // ---- seats ------------------------------------------------------------

  getSeats(): SeatRow[] {
    return this.all(`SELECT * FROM seats ORDER BY seat_index ASC`).map((r) => ({
      seat_index: Number(r.seat_index),
      owner_type: r.owner_type as SeatOwnerType,
      owner_account_id: r.owner_account_id == null ? null : String(r.owner_account_id),
      display_name: r.display_name == null ? null : String(r.display_name),
      controlled_by_ai: Number(r.controlled_by_ai) === 1,
      ai_difficulty: r.ai_difficulty == null ? null : String(r.ai_difficulty),
      last_seen_at: r.last_seen_at == null ? null : Number(r.last_seen_at),
      disconnected_at: r.disconnected_at == null ? null : Number(r.disconnected_at),
    }))
  }

  putSeat(s: SeatRow): void {
    this.sql.exec(
      `INSERT INTO seats
         (seat_index, owner_type, owner_account_id, display_name,
          controlled_by_ai, ai_difficulty, last_seen_at, disconnected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(seat_index) DO UPDATE SET
         owner_type = excluded.owner_type,
         owner_account_id = excluded.owner_account_id,
         display_name = excluded.display_name,
         controlled_by_ai = excluded.controlled_by_ai,
         ai_difficulty = excluded.ai_difficulty,
         last_seen_at = excluded.last_seen_at,
         disconnected_at = excluded.disconnected_at`,
      s.seat_index,
      s.owner_type,
      s.owner_account_id,
      s.display_name,
      s.controlled_by_ai ? 1 : 0,
      s.ai_difficulty,
      s.last_seen_at,
      s.disconnected_at,
    )
  }

  /**
   * The seat this account owns in THIS game, or null. Ownership is resolved
   * LIVE per request (never trusted from a token claim). A game binds at
   * most one seat per account, so the first match is authoritative.
   */
  seatOwnedBy(accountId: string): SeatRow | null {
    return this.getSeats().find((s) => s.owner_account_id === accountId) ?? null
  }

  /** Targeted AI-control flip (avoids a full read-modify-write of the seat). */
  setControlledByAi(seat: number, value: boolean): void {
    this.sql.exec(`UPDATE seats SET controlled_by_ai = ? WHERE seat_index = ?`, value ? 1 : 0, seat)
  }

  /** Heartbeat: refresh presence and clear any disconnect mark for a seat. */
  setPresence(seat: number, now: number): void {
    this.sql.exec(`UPDATE seats SET last_seen_at = ?, disconnected_at = NULL WHERE seat_index = ?`, now, seat)
  }

  /** Mark a seat's disconnect timestamp. Wave 3 addition (see file header):
   *  the column has existed since Wave 1; this setter exists for interface
   *  parity with viota's presence.ts. Not called by Wave 3's own
   *  armDisconnectCoverIfAbsent/armRoundWaitIfAbsent (Jaipur's 2p turn-based
   *  model has no off-turn-grace caller — see do/presence.ts's file header)
   *  but is available for a future wave that needs it. */
  setDisconnectedAt(seat: number, now: number): void {
    this.sql.exec(`UPDATE seats SET disconnected_at = ? WHERE seat_index = ?`, now, seat)
  }
}

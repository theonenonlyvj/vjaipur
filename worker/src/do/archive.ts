import type { GameRepository, MoveRow, SeatRow } from './storage'

/**
 * D1 archive write-through — Wave 4 fills in the bodies Wave 2 pinned (design
 * spec §6, ADDENDUM S/T; port of viota's `do/archive.ts`).
 *
 * These are the ONLY functions that touch the D1 archive. `game-do.ts` calls
 * them from `ctx.waitUntil` after a move/join/resign commits (except
 * `archiveGameCreate`, which is `await`ed directly at `/games` create time so
 * the room code is resolvable immediately — see game-do.ts's
 * `handleCreateRoom`), so a D1 outage generally only ever leaves
 * `archive_outbox` rows unflushed (retried by `archiveTick`/the cron) — it
 * can never stall the live game, whose authoritative truth is the DO's own
 * SQLite. Every function takes `db` explicitly so it stays unit-testable
 * against a fake/broken D1 (matching viota's pattern).
 */

// ---- shared helpers ---------------------------------------------------------

/** Upsert the `players` display-name cache for every HUMAN seat (design spec
 *  §2: "every authenticated touch upserts players(...)"). Shared by
 *  `archiveGameCreate` and `archiveSeats` — both are "a seat roster changed"
 *  moments. */
async function upsertPlayers(db: D1Database, seats: SeatRow[], now: number): Promise<void> {
  const stmts = seats
    .filter((s): s is SeatRow & { owner_account_id: string } => s.owner_type === 'human' && !!s.owner_account_id)
    .map((s) =>
      db
        .prepare(
          `INSERT INTO players (account_id, display_name, last_seen_at)
           VALUES (?, ?, ?)
           ON CONFLICT(account_id) DO UPDATE SET
             display_name = excluded.display_name,
             last_seen_at = excluded.last_seen_at`,
        )
        .bind(s.owner_account_id, s.display_name, now),
    )
  if (stmts.length) await db.batch(stmts)
}

/** The `round_end` server-minted move payload shape (do/apply.ts), just
 *  enough of it to recover per-round scores for the match-total accumulator
 *  below. Parsed defensively — a payload this module itself wrote should
 *  never be malformed, but a corrupt/foreign row must never throw. */
function roundEndScores(payload: string): [number, number] | null {
  try {
    const parsed = JSON.parse(payload) as { result?: { scores?: unknown } }
    const scores = parsed?.result?.scores
    if (Array.isArray(scores) && scores.length === 2 && typeof scores[0] === 'number' && typeof scores[1] === 'number') {
      return [scores[0], scores[1]]
    }
    return null
  } catch {
    return null
  }
}

/**
 * The ACCUMULATED match score per seat — the sum of every round's
 * `scoreRound` result across the whole match (mirrors the client's online
 * `matchScores` running total; see `src/store/gameStore.ts`'s `nextRound`/
 * `startNextRound`, which add `result.scores[seat]` onto `matchScores` every
 * round). Derived from the server-minted `round_end` moves rather than
 * stored as its own column, so it's always exactly consistent with the move
 * log (the source of truth) and never a second copy that could drift.
 */
function accumulatedMatchScores(moves: MoveRow[]): [number, number] {
  let s0 = 0
  let s1 = 0
  for (const m of moves) {
    if (m.type !== 'round_end' || m.reverted) continue
    const scores = roundEndScores(m.payload)
    if (!scores) continue
    s0 += scores[0]
    s1 += scores[1]
  }
  return [s0, s1]
}

// ---- pinned exports (Wave 2 signatures — DO NOT change) --------------------

/** Write the `games` + `game_players` registry rows at creation. Called
 *  AWAITED (not waitUntil) from `handleCreateRoom` so a friend can resolve
 *  the room code as soon as create returns.
 *
 *  NEVER THROWS (like every function in this module): `handleCreateRoom`
 *  awaits this with no try/catch of its own, so a throw here would 5xx a
 *  create the DO itself actually completed successfully — worse than a
 *  quietly-unarchived room. A friend who can't yet resolve-by-code because
 *  D1 is having a moment can still be handed the code directly (or the
 *  create can be retried — `ON CONFLICT DO NOTHING` on `games`/`game_players`
 *  makes a retry idempotent); the DO's own SQLite is unaffected either way. */
export async function archiveGameCreate(
  db: D1Database,
  repo: GameRepository,
  now: number,
  code: string | null,
): Promise<void> {
  try {
    const meta = repo.getMeta()
    if (!meta) return
    const seats = repo.getSeats()

    await db
      .prepare(
        `INSERT INTO games
           (game_uuid, code, status, match_length, seals0, seals1, winner_seat,
            source, engine_version, created_at, last_activity_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'online_authoritative', ?, ?, ?, NULL)
         ON CONFLICT(game_uuid) DO NOTHING`,
      )
      .bind(
        meta.game_uuid,
        code,
        meta.status,
        meta.match_length,
        meta.seals0,
        meta.seals1,
        meta.winner_seat,
        meta.engine_version,
        now,
        now,
      )
      .run()

    const seatStmts = seats.map((s) =>
      db
        .prepare(
          `INSERT INTO game_players (game_uuid, seat_index, account_id, display_name)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(game_uuid, seat_index) DO NOTHING`,
        )
        .bind(meta.game_uuid, s.seat_index, s.owner_account_id, s.display_name),
    )
    if (seatStmts.length) await db.batch(seatStmts)

    await upsertPlayers(db, seats, now)
  } catch {
    // D1 hiccup (or, in tests that never applied the D1 schema, a missing
    // table): the DO's own room creation already committed regardless — the
    // archive row can catch up on the next touch (`archiveSeats` on /join,
    // or a re-POST to /games, both idempotent). Never stall/fail the create.
  }
}

/** Write-through a seat change (a `/join`) to the `game_players` index,
 *  UPDATING (unlike the create-time insert above, which DOes NOTHING on
 *  conflict) so an `open -> human` claim actually lands. Also writes
 *  `status` (mirroring `MatchState.status` — e.g. `waiting` -> `active` the
 *  moment seat 1 is claimed, per design spec §3.8's "the join immediately
 *  deals") and touches `last_activity_at` (keeps the cron sweep honest AND
 *  `/resolve`'s reported status current). Called via `ctx.waitUntil` — never
 *  awaited by the response; never throws (see `archiveGameCreate`'s
 *  docstring for why every function here is defensive). */
export async function archiveSeats(db: D1Database, repo: GameRepository, now: number): Promise<void> {
  try {
    const meta = repo.getMeta()
    if (!meta) return
    const seats = repo.getSeats()

    const seatStmts = seats.map((s) =>
      db
        .prepare(
          `INSERT INTO game_players (game_uuid, seat_index, account_id, display_name)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(game_uuid, seat_index) DO UPDATE SET
             account_id = excluded.account_id,
             display_name = excluded.display_name`,
        )
        .bind(meta.game_uuid, s.seat_index, s.owner_account_id, s.display_name),
    )
    if (seatStmts.length) await db.batch(seatStmts)

    await db
      .prepare(`UPDATE games SET status = ?, last_activity_at = ? WHERE game_uuid = ?`)
      .bind(meta.status, now, meta.game_uuid)
      .run()

    await upsertPlayers(db, seats, now)
  } catch {
    // D1 hiccup: the DO's own seat claim already committed — never stall the
    // live game over an archive write. The registry catches up on the next
    // touch (a move's archiveTick, or the cron's periodic sweep).
  }
}

/** Drain the DO-local `archive_outbox` to D1 (every enqueued move), touch
 *  activity, and — if the match has reached a terminal status — finalize the
 *  `games` row AND call `archiveMatchEnd` (a defensive backstop: the direct
 *  `ctx.waitUntil(archiveMatchEnd(...))` calls in `game-do.ts`'s
 *  `handleMove`/`handleResign` are the primary path; this is the cron/`/tick`
 *  retry path in case that fire-and-forget call was ever lost. `matches`
 *  writes are idempotent via the dedup index, so calling `archiveMatchEnd`
 *  twice for the same match-end moment is always safe).
 *
 *  NEVER THROWS: wrapped in one outer try/catch, so a D1 hiccup mid-drain
 *  simply leaves whatever wasn't flushed yet in the outbox for the next tick
 *  to retry — it can never stall or fail the live game. */
export async function archiveTick(db: D1Database, repo: GameRepository, now: number): Promise<void> {
  try {
    const meta = repo.getMeta()
    if (!meta) return

    for (const moveIndex of repo.unflushedOutbox()) {
      const m = repo.getMove(moveIndex)
      if (!m) {
        // Should be unreachable (the outbox only ever enqueues indices that
        // were just inserted), but a stale/orphaned reference must never
        // wedge the drain loop forever — drop it and move on.
        repo.markOutboxFlushed(moveIndex)
        continue
      }
      await db
        .prepare(
          `INSERT INTO moves
             (game_uuid, move_index, round, seat_index, type, payload, by_ai,
              ai_difficulty, client_move_id, reverted, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(game_uuid, move_index) DO NOTHING`,
        )
        .bind(
          meta.game_uuid,
          m.move_index,
          m.round,
          m.seat_index,
          m.type,
          m.payload,
          m.by_ai ? 1 : 0,
          m.ai_difficulty,
          m.client_move_id,
          m.reverted ? 1 : 0,
          m.created_at,
        )
        .run()
      repo.markOutboxFlushed(moveIndex)
    }

    await db.prepare(`UPDATE games SET last_activity_at = ? WHERE game_uuid = ?`).bind(now, meta.game_uuid).run()

    const TERMINAL_STATUSES = new Set(['completed', 'stalemate', 'resigned', 'abandoned'])
    if (TERMINAL_STATUSES.has(meta.status)) {
      await db
        .prepare(
          `UPDATE games
             SET status = ?, seals0 = ?, seals1 = ?, winner_seat = ?,
                 ended_at = COALESCE(ended_at, ?), last_activity_at = ?
           WHERE game_uuid = ?`,
        )
        .bind(meta.status, meta.seals0, meta.seals1, meta.winner_seat, now, now, meta.game_uuid)
        .run()
      await archiveMatchEnd(db, repo, now)
    }
  } catch {
    // D1 hiccup: leave whatever wasn't flushed for the cron/tick retry. Never
    // stall or fail the live game — the DO's own SQLite copy is the
    // authoritative truth regardless of archive state.
  }
}

/**
 * Write one `matches` row PER HUMAN SEAT at match end (`match_over` via a
 * natural completion OR a resignation). `opponent_type:'online'` (ADDENDUM S
 * — NOT 'human': the existing client UI keys on the literal 'online').
 * `won`/`winner` are read from `MatchState.winner_seat` — the ONLY
 * authoritative copy (ADDENDUM D), already computed correctly for BOTH
 * termination paths by the caller (`do/apply.ts`'s `seals[seat] >=
 * sealsNeeded` formula per ADDENDUM C for a natural match-over, or
 * `game-do.ts`'s `handleResign`'s "the other seat always wins" for a
 * resignation) — this function does not need to, and must not, re-derive a
 * winner from seals itself.
 *
 * Scores are the ACCUMULATED match scores (sum of every round's
 * `scoreRound` result across the whole match — see `accumulatedMatchScores`
 * above), mirroring exactly what the client's online path today writes into
 * `matchScores`/`addMatch` (`src/store/gameStore.ts`), NOT the seal count.
 *
 * A `winner_seat === null` match (only reachable via Wave 3's future
 * `abandoned` status — never a natural completion or a resignation, both of
 * which always set a winner) has no resolvable win/loss, so this is a
 * deliberate no-op: an abandoned game must never count as a win OR a loss
 * for either seat.
 *
 * Dedup via the UNIQUE(account_id, timestamp, opponent_type) index —
 * `ON CONFLICT DO NOTHING` — so calling this twice for the same match-end
 * moment (the direct `game-do.ts` call AND `archiveTick`'s backstop call,
 * which both pass the SAME `now`) writes each seat's row at most once.
 *
 * NEVER THROWS (see `archiveGameCreate`'s docstring for why every function
 * in this module is defensive): both direct call sites in `game-do.ts`
 * (`handleMove`/`handleResign`) invoke this via fire-and-forget
 * `ctx.waitUntil`, and `archiveTick` also calls it inline within its OWN
 * try/catch — self-guarding here too means an uncaught rejection never
 * reaches either caller regardless of path.
 */
export async function archiveMatchEnd(db: D1Database, repo: GameRepository, now: number): Promise<void> {
  try {
    const meta = repo.getMeta()
    if (!meta) return
    if (meta.winner_seat === null) return // no resolvable winner (e.g. abandoned) -> no stats row

    const seats = repo.getSeats()
    const humanSeats = seats.filter((s): s is SeatRow & { owner_account_id: string } => s.owner_type === 'human' && !!s.owner_account_id)
    if (humanSeats.length === 0) return

    const moves = repo.getMovesSince(0)
    const scores = accumulatedMatchScores(moves)

    const aiCoveredBySeat = new Set<number>()
    for (const m of moves) {
      if (m.by_ai && !m.reverted) aiCoveredBySeat.add(m.seat_index)
    }

    const matchStmts = []
    const resultStmts = []

    for (const seat of humanSeats) {
      const otherIndex = seat.seat_index === 0 ? 1 : 0
      const other = seats.find((s) => s.seat_index === otherIndex) ?? null
      const opponentAccountId = other && other.owner_type === 'human' ? other.owner_account_id : null
      const won = seat.seat_index === meta.winner_seat

      matchStmts.push(
        db
          .prepare(
            `INSERT INTO matches
               (account_id, opponent_type, opponent_account_id, player_score, opponent_score,
                won, source, ai_covered, game_uuid, timestamp, created_at)
             VALUES (?, 'online', ?, ?, ?, ?, 'online_authoritative', ?, ?, ?, ?)
             ON CONFLICT(account_id, timestamp, opponent_type) DO NOTHING`,
          )
          .bind(
            seat.owner_account_id,
            opponentAccountId,
            scores[seat.seat_index],
            scores[otherIndex],
            won ? 1 : 0,
            aiCoveredBySeat.has(seat.seat_index) ? 1 : 0,
            meta.game_uuid,
            now,
            now,
          ),
      )

      resultStmts.push(
        db
          .prepare(`UPDATE game_players SET result = ? WHERE game_uuid = ? AND seat_index = ?`)
          .bind(won ? 'win' : 'loss', meta.game_uuid, seat.seat_index),
      )
    }

    if (matchStmts.length) await db.batch(matchStmts)
    if (resultStmts.length) await db.batch(resultStmts)
  } catch {
    // D1 hiccup: the DO's own match-end state already committed — never
    // stall/fail on the stats write. `archiveTick`'s terminal-status
    // backstop will retry this on the next drive/cron poke.
  }
}

import type { GameRepository, SeatRow, SqlLike } from './storage'
import { setTimer, clearTimer, hasTimer } from './timers'
import { AWAY_TURN_MS, PRESENCE_MS, ROUND_WAIT_MS } from './constants'

/**
 * Presence + auto-cover — ported from viota's do/presence.ts (Wave 3,
 * ADDENDUM J/L).
 *
 * HEARTBEAT IS THE SOLE PRESENCE AUTHORITY: a seat is "present" iff its
 * `last_seen_at` is within PRESENCE_MS of now. The WebSocket connection is
 * NEVER consulted for the drive/freeze/cover decision — game-do.ts's
 * `webSocketClose`/`webSocketError` are deliberate no-ops (see their
 * comments): a socket close is not proof a player is gone (a locked phone /
 * flaky network reconnects without a clean close, or never closes at all),
 * and hibernated sockets would disagree with a mid-reconnect player. The
 * socket is only a nudge channel.
 *
 * DELIBERATELY NOT PORTED: viota's `markDisconnected` (the off-turn `grace`
 * arming triggered by `webSocketClose`). Jaipur is 2p turn-based: an
 * off-turn seat's absence never blocks anyone — only the CURRENT-turn seat
 * (`armDisconnectCoverIfAbsent` below) or an absent seat at `round_end`
 * (`armRoundWaitIfAbsent`, NEW below, ADDENDUM J) can actually stall a
 * present opponent, and neither depends on a socket-close event. Wave 2's
 * `webSocketClose` comment says as much: "WAVE 3 wires presence off this via
 * armDisconnectCoverIfAbsent." `OFF_TURN_GRACE_MS`/the `'grace'` timer kind
 * stay declared (constants.ts / do/timers.ts) for interface parity — the
 * `'grace'` case in game-do.ts's alarm() dispatch is simply unreachable
 * tonight, never armed.
 */

/** A single seat is present iff it heartbeated within the presence window. */
export function isSeatPresent(seat: SeatRow, now: number): boolean {
  return seat.last_seen_at != null && now - seat.last_seen_at <= PRESENCE_MS
}

/** True iff ANY seat is a present human (a pure-AI seat never heartbeats, so
 *  it never carries a fresh last_seen_at). This gates drive vs. freeze. */
export function isAnyHumanPresent(repo: GameRepository, now: number): boolean {
  return repo.getSeats().some((s) => isSeatPresent(s, now))
}

/** Present-check for a specific seat index. */
export function seatIndexPresent(repo: GameRepository, seatIndex: number, now: number): boolean {
  const s = repo.getSeats()[seatIndex]
  return !!s && isSeatPresent(s, now)
}

/** The most recent last_seen_at across all seats, or null if none ever seen. */
export function maxLastSeen(repo: GameRepository): number | null {
  let max: number | null = null
  for (const s of repo.getSeats()) {
    if (s.last_seen_at != null && (max == null || s.last_seen_at > max)) max = s.last_seen_at
  }
  return max
}

/**
 * Waiting-room host promotion — PORTED FOR INTERFACE PARITY ONLY. Viota's
 * multi-seat lobby needs this because ANY human seat may need to inherit the
 * host's exclusive `/start` privilege while the room is still `'waiting'`.
 * vjaipur has neither: there is no `meta.host_seat` column (the host is
 * always seat 0 — do/init.ts's `createWaitingRoom`) and no separate
 * host-start ceremony (design spec §3.8 / ADDENDUM R: `/join` deals
 * immediately and flips the room active). A 2-seat waiting room's only OTHER
 * seat is `'open'` until claimed, so there is never another HUMAN seat to
 * promote host to. Always returns null; not wired into any handler today.
 */
export function promoteHost(repo: GameRepository, departingSeat: number, _now: number): number | null {
  if (departingSeat !== 0) return null // vjaipur's host is always seat 0
  const meta = repo.getMeta()
  if (!meta || meta.status !== 'waiting') return null
  return null
}

/**
 * Auto-cover arming for a SILENTLY disconnected ON-TURN human — the reliable
 * trigger `webSocketClose` cannot be (a locked phone / dropped network /
 * crashed tab sends no close, so this can never ride a socket event).
 * Presence is heartbeat-based, so "silently gone" == the current seat is a
 * human whose `last_seen_at` is stale (`isSeatPresent` false). Called from
 * every always-running path (the heal self-tick, after each move/deal, and
 * the alarm), it is IDEMPOTENT and safe to call every tick:
 *  - only ever arms while `meta.phase === 'playing'` — round_end/match_over
 *    have no active turn to protect (round_end liveness is
 *    `armRoundWaitIfAbsent`'s job instead, below);
 *  - arms a `turn` cover deadline ONLY when the current seat is an ABSENT
 *    human with no cover timer yet, so a PRESENT player (who keeps
 *    heartbeating) is never armed and a long "thinking" turn is never
 *    interrupted;
 *  - ADDENDUM L: the deadline is the FIXED `AWAY_TURN_MS` (60s) — vjaipur
 *    has no host-configurable takeover patience (`meta.ai_takeover_ms` was
 *    explicitly cut, quick-match/host-config are both gone tonight);
 *  - bases the deadline on `now` — the moment THIS call detects the seat is
 *    current-and-absent — NOT on the seat's stale `last_seen_at`, so a
 *    backgrounded tab (which stops heartbeating entirely) always gets the
 *    full window from detection, never an instant/negative one. The
 *    single-arm guard (`hasTimer`) ensures this only happens ONCE per turn.
 * The alarm's `turn` branch re-checks presence and spares a player who
 * returns before it fires, so arming here can never wrongly cover a
 * reconnecting player.
 */
export function armDisconnectCoverIfAbsent(repo: GameRepository, sql: SqlLike, now: number): void {
  const meta = repo.getMeta()
  if (!meta || meta.status !== 'active' || meta.phase !== 'playing') return
  const seat = repo.getSeats()[meta.current_seat]
  if (!seat || seat.owner_type !== 'human' || seat.controlled_by_ai) return // not a human seat to cover
  if (isSeatPresent(seat, now)) return // connected → never auto-covered
  if (hasTimer(sql, 'turn', meta.current_seat)) return // already armed — don't push it out
  setTimer(sql, 'turn', meta.current_seat, now + AWAY_TURN_MS)
}

/**
 * NEW (ADDENDUM J): round_end liveness. While `meta.phase === 'round_end'`,
 * arm a `round_wait` timer for EVERY seat that is an absent human, at
 * `now + ROUND_WAIT_MS` — idempotent (only arms once per absence, mirroring
 * `armDisconnectCoverIfAbsent`'s `hasTimer` guard) — and CLEAR it for a seat
 * that is present (a player sitting on RoundEndScreen keeps heartbeating per
 * ADDENDUM Q, so their timer never fires). Unlike `armDisconnectCoverIfAbsent`
 * this considers BOTH seats, not just `meta.current_seat` — round_end has no
 * "current turn," either seat owner may click Continue, and either may be
 * the one who is absent. game-do.ts's alarm() dispatches a due `round_wait`
 * straight to the internal next-round-advance path (never `driveIfAI`/
 * `autoCover`), firing when EITHER seat's deadline expires so a present
 * player is never stuck waiting on an absent one.
 */
export function armRoundWaitIfAbsent(repo: GameRepository, sql: SqlLike, now: number): void {
  const meta = repo.getMeta()
  if (!meta || meta.status !== 'active' || meta.phase !== 'round_end') return
  for (const seat of repo.getSeats()) {
    if (seat.owner_type !== 'human') continue // an 'ai'/'open' seat has no owner to wait on
    if (isSeatPresent(seat, now)) {
      clearTimer(sql, 'round_wait', seat.seat_index)
    } else if (!hasTimer(sql, 'round_wait', seat.seat_index)) {
      setTimer(sql, 'round_wait', seat.seat_index, now + ROUND_WAIT_MS)
    }
  }
}

/** Broadcast surface for auto-cover (a dismissible `ai_cover` toast). */
export interface CoverDeps {
  broadcast(payload: unknown): void
}

/**
 * Auto-cover a seat with a fixed MEDIUM AI (never a blocking vote): flip
 * `controlled_by_ai`, cancel the seat's absence deadlines, kick the drive
 * loop with an immediate `ai_step`, and broadcast a dismissible `ai_cover`
 * toast. The caller re-arms the platform alarm after this returns.
 */
export function autoCover(deps: CoverDeps, repo: GameRepository, sql: SqlLike, seat: number, now: number): void {
  const seatRow = repo.getSeats()[seat]
  if (!seatRow) return
  repo.setControlledByAi(seat, true)
  clearTimer(sql, 'grace', seat)
  clearTimer(sql, 'turn', seat)
  setTimer(sql, 'ai_step', seat, now) // fire the drive loop on the next alarm
  deps.broadcast({ type: 'ai_cover', seat })
}

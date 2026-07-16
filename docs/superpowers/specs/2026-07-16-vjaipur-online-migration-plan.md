# vjaipur Online Migration Plan — trust-relay → server-authoritative

**Author:** Claude (review + planning pass, 2026-07-16)
**Status:** Proposal for Vijay's decision. Nothing here is built. See the
"Decisions needed" section — this plan has open architectural forks that are
Vijay's call, not mine.

Companion reading (already exists, do not duplicate):
- `../../../../vgames-platform/docs/P2-REFRAME-two-rings.md` — the Ring model.
- `../../../../vgames-platform/docs/STATS-FEDERATION.md` — federation + the
  `/stats/rollup` contract + the "vjaipur off Supabase onto its own D1" follow-up.
- `../../../../vgames-platform/docs/council/2026-07-15-account-stats-critique.md`
- `../../../../viota/docs/superpowers/specs/2026-07-06-viota-online-BEST-architecture.md`
  — the PROVEN Durable-Object architecture this plan ports.

---

## 1. Why migrate at all

vjaipur's single-player game is good (engine 7/10, six real AI tiers). Its
**online mode is the weak point** — reviewed at 3/10. Every problem below is a
*structural* consequence of one design choice: the server (`server/index.ts`,
Node + Socket.IO on Render) is a **trust-based state relay that runs zero Jaipur
rules**. It cannot be patched away inside the relay; it needs the server to
become authoritative. Concretely, today:

| Problem | Root cause in the relay | Evidence |
|---|---|---|
| **Scores are forgeable** | `ACTION` copies `room.state = data.state` and rebroadcasts it; `SYNC_MATCH` writes client-asserted `player_score/won` | `server/index.ts:94`, `:167` |
| **Both hands leak** | full `GameState` (both `players[].hand`) round-trips every move + on `REJOIN` | `src/shared/protocol.ts:33`, `server/index.ts:114` |
| **Active players get force-forfeited** | presence = socket liveness; a ~20s blip exhausts `reconnectionAttempts:5` and the client stops trying, while the server's 180s timer runs | `src/socket/socketService.ts:16`, `server/index.ts:293` |
| **Games vanish on restart/spin-down** | rooms are in-memory (`rm.rooms` Map), Render free tier idles out | `server/roomManager.ts:19` |
| **Whole server is one bad message from death** | handlers aren't wrapped; an uncaught throw kills the process for everyone | `server/index.ts:43` (being band-aided now; see §6) |
| **Seat spoofing** | `REJOIN` needs only `{code, playerIndex}` — no per-seat secret | `server/roomManager.ts:129` |

The identity layer is already correct and **carries over unchanged**:
`resolveSocketIdentity()` introspects the VGames JWT → canonical `accountId`,
fails closed (`server/vgamesAuth.ts`). We are not re-solving auth.

## 2. Target architecture (port viota's, proven in prod)

One **SQLite-backed Cloudflare Durable Object per game**, exactly as viota runs
today (Workers + WS-Hibernation + durable Alarms + D1 archive). The properties
we get *structurally* (not by patching):

- **Server-authoritative engine.** The DO imports the Jaipur engine
  (`src/engine`, pure TS, already certified) and is the ONLY thing that calls
  `applyAction`. Clients send an *intent* (the `Action`), never a `GameState`.
  Illegal/forged moves are rejected at the source. → kills score-forgery.
- **Per-seat redaction.** The DO sends each client a `GameState` with the
  opponent's `hand` replaced by a count, and never ships the deck/seed. → kills
  the hand leak.
- **Never-stall / durable presence.** Liveness lives in a durable timers table,
  not socket ping. A 20s off-turn blip does nothing; an on-turn absence is
  covered by a cheap "medium" AI move after a grace window (dismissible toast,
  never a blocking vote). Reconnect via `GET /sync?since=k`; seat bound to
  `accountId`. → kills the false forfeits, the #1 real-user complaint.
- **Idempotent HTTP moves, WS-as-nudge.** Every mutation is
  `POST /move` with a client-minted `clientMoveId` checked inside the write txn;
  WS is demoted to a "news at index N" nudge; a WS-blocked client degrades to
  polling instead of freezing.
- **Durable rooms + event-sourced replay.** `initial_state + move log` is truth;
  survives eviction/redeploy; D1 write-through for archive. → kills game-loss on
  restart.
- **Workers isolation + accountId-bound seats.** A malformed message can't take
  down other games; a reconnect must prove the account. → kills DoS + seat-spoof.

## 3. What migrates vs. what carries over

**Carries over UNTOUCHED:**
- `src/engine/*` — the Jaipur rules engine (now runs server-side too; viota did
  exactly this with its engine).
- VGames identity (`server/vgamesAuth.ts` logic → the DO/worker calls the same
  `/auth/introspect`; seats bound to the `accountId` it returns).
- The whole single-player / vs-AI client path (unchanged; it never touches the
  server).

**Migrates (retired):**
- `server/index.ts` Socket.IO relay, `server/roomManager.ts` in-memory rooms →
  the DO worker.
- The `ActionPayload {action, state}` wire contract → `{action}` only; state is
  server-derived and per-seat-redacted (`src/shared/protocol.ts`).
- Client online net layer (`src/socket/socketService.ts`, `gameStore` online
  paths) → HTTP-first + nudge, mirroring viota's `packages/client/src/net/*`.
- Render backend service → Cloudflare Worker + DO (frontend can stay on Render
  Pages or move to CF Pages; independent decision).

## 4. Stats store: Supabase → own D1 (the federation follow-up)

Separable, smaller, and already ratified in `STATS-FEDERATION.md`. A like-for-
like store move (not a re-model): recreate the `matches`/`players` shape in a
vjaipur-owned D1, back the existing `db.ts` functions with it, retire Supabase
(removes the Free-tier pause availability risk). This is also the natural moment
to fix the **leaderboard-keys-on-mutable-display_name** bug — key aggregates on
the canonical `accountId` (already available server-side) instead of
`display_name`, so same-named friends stop merging into one row. Then expose the
one-page `/stats/rollup` contract for the future cross-game player card.

## 5. Suggested phasing

1. **P3a — stand up the vjaipur DO** with the engine server-side, per-seat
   redaction, idempotent `POST /move` + `GET /sync`, seats bound to `accountId`.
   Dual-run: keep Render live; new games can be steered to the DO behind a flag.
2. **P3b — client net rewrite** to HTTP-first + nudge (lift viota's net layer);
   flip online play to the DO; retire the Socket.IO relay.
3. **P4 — stats to own D1**, leaderboard re-keyed on `accountId`, Supabase
   decommissioned, `/stats/rollup` exposed.

Each phase ends green + reviewed; no push/deploy/live-DB mutation without Vijay.
There ARE active users (~10) → dual-run and a gated cutover, like the P1 auth
migration. History carries over (matches already keyed to `accountId`).

## 6. Relationship to the 2026-07-16 hardening pass

The review that produced this plan ALSO shipped defensive fixes to the *current*
relay so it's less dangerous while it still exists: per-handler try/catch +
`typeof cb` guards + `process.on('uncaughtException')` (DoS), lazy Supabase
(boot no longer coupled to the DB), and the client-side forfeit/reconnect/
freeze fixes. **These are band-aids on a relay this plan retires** — they buy
safety now; they are not a substitute for the migration. The score-forgery and
hand-leak holes CANNOT be closed inside the relay and are intentionally left for
P3.

## 7. Decisions needed from Vijay

1. **Extract a shared "Ring A" now, or port viota's DO into a vjaipur worker
   directly?** `P2-REFRAME` says extract Ring A *later, from real duplication*.
   vjaipur is now a real second consumer — so either (a) extract the generic room
   primitive now (more up-front work, pays off for game #3), or (b) copy viota's
   DO into a vjaipur-specific worker now and extract later (faster, some
   duplication). The docs lean (b); vjaipur being a genuine 2nd consumer makes
   (a) defensible. **Your architectural call.**
2. **Identity worker reuse.** Reuse the live `vgames-identity` worker's D1 for
   vjaipur's game data, or a separate vjaipur D1 that only *verifies* against
   identity? (Federation says each game owns its store → separate D1, identity
   is the only shared spine. Recommend separate.)
3. **Timeline.** This is a multi-session rebuild (viota's took several). Confirm
   you want to start it, or park it behind the hardening band-aids for now.
4. **Frontend hosting.** Keep the client on Render, or move to CF Pages when the
   backend moves to Workers? (Independent; Render Pages is fine to keep.)

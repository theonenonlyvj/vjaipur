# Worker spec ADDENDUM — red-team amendments (2026-07-18, LOCKED)

Applies on top of `2026-07-18-vjaipur-worker-online-design.md`. Where this
addendum and the base spec conflict, **the addendum wins.** Product of the
4-lens red-team council (liveness/security/rules/migration). Read this before
building any wave.

## Scope changes (de-risk the night)

- **A. Quick-match is CUT from tonight** (fast-follow). Delete §5 (MatchmakerDO)
  and the `/quick-match*` routes from §4 entirely. Friends play via create-room
  + shareable code/link. This removes the no-precedent MatchmakerDO and its
  auth/expiry/status findings wholesale. (Client Lobby shows Create + Join by
  code only; no "Quick match" button.)
- **B. Veto is DEFERRED** (fast-follow). Do NOT port `do/veto.ts`. Reclaim alone
  is v1: a returning player resumes from the CURRENT board (AI moves made in
  their absence stand). No `/veto` route, no reverted-move machinery, no
  round-scoped tail scan. Simplifies storage + replay.

## Rules / engine correctness (blockers)

- **C. winnerSeat + `matches.won` are ALWAYS `seals[seat] >= sealsNeeded ? seat :
  other`**, per seat, where `sealsNeeded = floor(matchLength/2)+1`. NEVER a
  literal `>= 2`. This overrides gameStore.ts's online-path `startNextRound`
  (line ~481) win logic, which is bugged for matchLength ∈ {1,5}. Use the
  offline `nextRound`/GameOverScreen formula.
- **D. MatchState.seals/round/phase are the ONLY authoritative copies.** The
  embedded engine `game` object ALSO has `.seals/.round/.phase` (setup-time
  artifacts, frozen until the next `setupRound`). Every consumer (view builder,
  client adapter, round-end detection) MUST read MatchState's, never the
  engine object's. Strip `game.seals/round/phase` before wire-serializing, or
  document they're ignored. Engine phase strings (`playing`/`round-end`/
  `game-over`) ≠ MatchState phase (`playing`/`round_end`/`match_over`) — keep
  them separate literal sets; detect round end from the engine's own
  round-over signal (read setup.ts/scoring.ts/gameStore for the exact signal),
  then set MatchState.phase.
- **E. Move-shape validation is PER-FIELD, not a uniform bounds check:**
  - `marketIndices[i]`: integer, `0 <= i < market.length` (never -1/camel).
  - TAKE_EXCHANGE `handIndices[i]`: integer, EITHER exactly `-1` (give a herd
    camel) OR `0 <= i < hand.length`. No other field accepts `-1`.
  - Mirror the exact `Action` shapes in src/engine/types.ts; the engine stays
    the legality gate (it already guards these post-hardening).
- **F. `setupRound`'s `prevLoser` arg must be threaded on every round after the
  first**, computed from `lastRoundResult.sealAwardedTo` exactly as
  gameStore.ts (~316-320) does (loser = the OTHER seat when a seal was awarded;
  `undefined` on a complete tie → seat 0 starts). Loser-goes-first is a real
  rule.
- **G. Determinism:** VERIFY first with a test — `setupRound(seals, prevLoser,
  rng(seed))` + a fixed move list, replayed twice, yields identical state
  (bonus-token draws ride the seeded rng inside GameState). If ANY
  nondeterminism (e.g. a stray Math.random) exists, persist the full
  post-deal `initial_state` per round in `rounds(round, seed, initial_state)`
  and replay from THAT instead of re-running setup. Persist both; prefer seed
  if the test proves determinism.

## Redaction (blockers)

- **H. TAKE_EXCHANGE (and every take/sell) must be stored as a TRANSLATED PUBLIC
  payload, computed at commit time inside the txn from the authoritative
  PRE-move state** — never the raw `{marketIndices, handIndices}` action (raw
  hand indices index the private hand). Store, and serve via `/sync`/
  `toClientMove`, e.g.:
  - TAKE_EXCHANGE → `{takenCards: Card[] (pre-move market@marketIndices),
    givenGoods: Card[] (pre-move hand@non-(-1) handIndices, type only),
    camelsGiven: n (count of -1 entries)}`
  - TAKE_SINGLE → `{takenCard}`; TAKE_CAMELS → `{count}`; SELL →
    `{good, cards, tokens, bonusTierDrawn?}`. All of these are PUBLIC in real
    Jaipur. Never serve a payload that requires knowing the private hand array
    to interpret. Keep the raw action too if convenient for replay, but the
    CLIENT-SERVED move is the translated one.
- **I. ClientView is a CLOSED allowlist (pin it before coding), never a
  denylist.** Audit GameScreen.tsx / StatusBar.tsx / OpponentStrip.tsx /
  MarketRow / HandRow / ScoreCard for exact data needs. Final `game` shape:
  `market: Card[]`, `myHand: Card[]`, `oppHandCount: number`, `herds:[n,n]`,
  `tokens: TokenPiles` (the remaining goods-token stacks — public),
  `myGoodsTokens: GoodsToken[]` (own, full), `oppGoodsTokenCount: number`,
  `myBonusTokens: BonusToken[]` (own, full values), `oppBonusTokens:{tier}[]`
  (tier only, NEVER values), `deckCount: number`, `myScore: number`,
  `activePlayer: 0|1`. NEVER: opp hand cards, deck contents/order, seed,
  opp bonus values, opp running score mid-round (scores go public only in
  `lastRoundResult` at round_end/match_over). Any field not in the allowlist is
  not serialized. Redaction is grep-asserted in tests (serialize every payload,
  assert opp hand cards / deck array / seed / opp bonus values never appear).

## Liveness / never-stall (blockers/majors)

- **J. round_end liveness needs a NEW timer kind `round_wait`:**
  - Add `round_wait` to the `TimerKind` union AND the SQLite CHECK constraint.
  - When a move ends a round (phase→`round_end`), arm a `round_wait` timer
    PER absent-human seat (both seats considered, not just `current_seat`) at
    `now + ROUND_WAIT_MS` (new constant, 45_000). A present seat's timer isn't
    armed / is cleared on its heartbeat.
  - The alarm handler gets a `round_wait` case that calls the internal
    next-round-advance path DIRECTLY (not `driveIfAI`/`autoCover`), firing when
    EITHER seat's deadline expires — so a present player never waits forever on
    an absent one to click Continue.
  - Add `round_wait` to `creditEvictionGap`'s credited-kinds
    (`WHERE kind IN ('grace','turn','soft','round_wait')`) so an eviction
    spanning round_end doesn't auto-advance instantly on wake.
- **K. `driveIfAI` and `applyFloor`/the CPU-floor MUST early-return when
  `MatchState.phase !== 'playing'`.** Otherwise they call the AI/engine on a
  round_end/match_over state (Jaipur's `pickMediumAction` returns null for
  non-'playing' phase; `toMovePayload(null)` throws; the engine rejects with
  WRONG_PHASE). Add the guard explicitly.
- **L. On-turn cover deadline = 60s, wired for real.** Since quick-match/host
  config is gone, set Jaipur's `AWAY_TURN_MS = 60_000` DIRECTLY in constants.ts
  (do not rely on `meta.ai_takeover_ms`; drop that column). Off-turn grace =
  120_000 (viota's). `PRESENCE_MS` stays viota's (~45s) — but see M.
- **M. `/next-round` must run the post-deal wheel sequence** viota's `/start`
  runs: `ensureHeal(now)` → `driveIfAI(...)` → `armDisconnectCoverIfAbsent(...)`
  → `rearmAlarm(...)`, so an already-absent/AI opening seat is handled without
  waiting a heal tick. `/next-round` is idempotent per round (2nd caller →
  benign `{already:true}` + view).
- **N. The floor move (CPU-kill floor) for Jaipur:** implement `floorMove(state)`
  = first legal of: TAKE_CAMELS (if market has ≥1 camel) → SELL the largest
  legal single-type hand group → TAKE_SINGLE the lowest-value market good that
  keeps hand ≤7. It MUST be a member of `getLegalActions(state)`. Test: for
  1000 seeded reachable states, `getLegalActions` is non-empty AND `floorMove`
  ∈ it. (Jaipur always has a legal move — if a zero-legal-move state is ever
  found, STOP and flag; that's an engine bug.)

## Auth (major)

- **O. `VGAMES_URL` = `https://vgames-identity.theonenonlyvj.workers.dev`**
  (the canonical shared identity service — NOT `viota-worker...`). Set it as a
  worker var in wrangler.toml `[vars]` (public URL, not a secret). e2e go-live
  check: a FRESHLY created VGames ghost account authenticates through
  vjaipur-worker before cutover.
- **P. Introspect cache bound is EXPLICIT + tested:** positive results cached 5
  min keyed by SHA-256(token); a merged/revoked token may still authenticate
  for ≤5 min (accepted at this scale). Tests: entries are timestamped and
  expire (bounded Map, not unbounded); a cached-then-expired token is
  re-introspected; negatives are NEVER cached; fail-closed on network error /
  `status==='merged'`.
- **Q. Heartbeat runs for the WHOLE online-match lifetime** — a top-level
  online-session hook / net-layer interval (NOT a per-screen `useEffect`), so a
  player sitting on RoundEndScreen keeps heartbeating and isn't misread as
  absent right when round_end liveness depends on it. 20s interval.

## Naming / schema (minor→major)

- **R. Game-creation route is `POST /games`** (not `/create-room`) everywhere,
  matching viota. The DO-internal handler may still be `handleCreateRoom`.
- **S. Keep `opponent_type: 'online'` for online human matches** (NOT 'human').
  Every historical row + the existing UI (StatsDashboard.tsx:76/111 rivals
  card + tab visibility; GameOverScreen.tsx:24-30) keys on the literal
  `'online'`. Writing 'human' would silently break the rivals UI. The
  per-opponent rival breakdown continues to key on the opponent identifier the
  client already uses; online rows carry `opponent_account_id` additionally for
  the account-id-correct path, but `opponent_type` stays `'online'`.
- **T. `verified` leaderboard bucket scope is documented, not oversold:**
  `online_authoritative` = rule-legal + server-authoritative, NOT proof of two
  distinct humans (a user can self-play two ghost accounts). State this in the
  code comment + any UI copy. No collusion mitigation tonight (quick-match cut
  removes the easy vector anyway).

## Migration (blockers/majors)

- **U. Do NOT join `opponent_id`→account.** In legacy Supabase `matches`,
  `opponent_id` is the opponent's SELF-REPORTED friend_code (VJ-####/synthetic
  VG-####), not a `players.id` — no reliable account join exists. Migrate
  `opponent_type`/scores/`won`/`timestamp` only; leave `opponent_account_id`
  NULL for all migrated online rows; report the count of such rows.
- **V. Convert timestamps ISO-string → epoch-ms** in the migration
  (`new Date(row.timestamp).getTime()`, assert JS-safe integer) since D1
  `timestamp` is `INTEGER` and the rollup contract mandates epoch-ms. Client
  `/stats/history` merge must reuse statsStore.ts's existing string-vs-number
  timestamp normalization (~lines 260-272) so D1 rows dedupe against
  localStorage copies. A history pull must NEVER clobber local identity fields
  (displayName/claimed) — carry the prior lesson forward: pull ONLY matches.
- **W. Rollback target is `checkpoint-2026-07-18-pre-online-worker`** (= current
  main tip 4fab714, incl. hardening + AI lineup + assets), re-verified `==
  main` at build start. NOT the older `-hardening` tag (2 commits behind —
  would discard the AI-lineup + assets commits). Rollback =
  `git push origin checkpoint-2026-07-18-pre-online-worker^{}:main --force-with-lease`.

## Net effect on the build waves

W1 scaffold+storage(+rounds table, no reverted/veto cols)+constants(L). W2
DO init/deal(F,G)/apply(C,D,E,H)/view(I). W3 presence/timers(J)/drive+floor(K,N)/
reclaim/heartbeat(no veto). W4 router(R, no quick-match)/auth(O,P)/archive/stats(S,T)/
migration(U,V). Client 2C(Q,S,V). Deploy(O,W).

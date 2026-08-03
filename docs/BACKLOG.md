# vjaipur — Backlog

The only live backlog for this repo. Every item below was extracted from the
chronicle (`docs/superpowers/notes/2026-07-20-post-launch-fixes-and-backlog.md`)
and deduped against later entries that resolved or superseded it — if
something isn't here, either it shipped (check the chronicle) or it was never
opened. Each item is tagged:

- **HELD** — deliberately not doing this until Vijay gives an explicit go.
- **PARKED** — designed/scoped, deliberately not building yet.
- **WATCH** — nothing to build; a signal to keep an eye on.
- **IDEA** — raised, not scoped, not committed to.
- *(untagged)* — open and actionable whenever someone picks it up.

For current architecture/state, read `docs/STATE.md` first.

---

## HELD — Decommission the legacy Render Node backend + Supabase

`server/` (Node/Express + Socket.IO relay) and its Supabase-backed account/
leaderboard storage were superseded by the Cloudflare Worker + D1 rebuild on
2026-07-18, but are still deployed on Render (service `vjaipur-server`) and
still present in the repo. Explicitly **HELD for Vijay's go** once he's fully
confident in the new stack — most recently reaffirmed 2026-07-26 ("will
retire later") and again in the 2026-08-03 cleanup pass, which deliberately
left `server/` + `socketService` wiring untouched.

- **Rollback anchor**: tag `checkpoint-2026-07-18-pre-online-worker`.
- **Scoped out of any decommission pass until then**: `server/`, its
  Supabase client/schema, `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` env vars,
  `docs/operations/supabase-schema.md` / `admin-runbook.md` /
  `render-deployment.md` (these describe the live-but-HELD system accurately
  today — don't touch them as part of a docs pass either).

## Omniscient bot telegraphs the deck

`hard3` ("Omniscient Bot") reads the true hand and deck order, and its
*timing* leaks that information back to the player: if it waits before
acting, good cards are coming, because it can see them. No code changes
address this yet (confirmed via `grep` — no "telegraph"/"unpredictab-"
handling in `src/ai/hardAi3.ts`). Fix direction from the chronicle: add
unpredictability (e.g. randomized think-time or decision jitter) so the
bot's pacing stops leaking deck information. Flagged as a fast-follow when
the original lineup shipped (2026-07-20); still open.

## PARKED — "Bonus Race" variant

Vijay's idea (2026-07-26): ordered 3/4/5 bonus piles (highest-value first,
rewarding whoever sells big *first*), consistent with the goods tokens'
existing descending order. Decision: keep the official random draw as
**default** (preserves round-end reveal suspense, protects casual players,
avoids compounding first-mover advantage); build this as an **opt-in
variant toggle** (like Match Length; online = a room setting) if/when picked
up.

Implementation notes for whoever picks it up: the engine change itself is
one line (sorted vs. shuffled setup), but it ripples —
certified-engine change-control applies, bot evals assume random draws
(would need re-benchmarking under the variant — deterministic bonuses make
ISMCTS stronger vs. humans), and redaction changes character (opponent bonus
*values* become inferable once the order is known, where today only counts
are public).

## WATCH — Vijay's next ~30 games vs. ISMCTS eval v2

Eval v2 (`df8b9ac`) gated at 60% (36-24) vs. the pre-v2 eval and shipped
2026-08-02, alongside the 25,000-iteration floor (`f7e78b2`) that closed the
throttled-phone loophole discovered the same day (a device in Low Power Mode
was running the bot at 6-12k iterations/move vs. 35-48k at full power — a
materially easier opponent without anyone intending it). Open question: does
eval v2's real-world winrate hold up over Vijay's next ~30 games against
**depth-controlled** data — i.e. compare like-for-like on search depth/
iteration count, not raw winrate, since the iteration floor already changed
what "the bot" means mid-stream. Use `tools/mlogs/analyze.mjs` (see
`docs/STATE.md`'s Tooling section) once enough games have been logged.

## ISMCTS retune leads (not yet independently gated)

The eval v2 package (`src/ai/ismctsBot.ts`'s `staticEval`, gated behind
`__setEvalV2`) passed its gate as one bundle (60% vs. the pre-v2 eval,
2026-08-02) — its individual hand-set weights were not independently
ablated/tuned. Candidates for a future focused retune pass, if the WATCH
item above shows more headroom:

- **Precious pair-momentum weight** — `(pile[1] ?? 0) * 0.35 * clock`
  (`ismctsBot.ts` ~line 276): credits progress toward a still-incomplete
  precious pair. `0.35` was chosen by design judgment, not swept.
- **Fair denial coefficient** — `(oppCount - 1) * top * 0.25`
  (`ismctsBot.ts` ~line 292): penalizes states where the opponent is building
  a sellable stack. `0.25` reads as a conservative starting value; untested
  at other magnitudes.
- **Three uncoupled precious-value weights** — the full-stack precious
  multiplier (`1.3`, vs. `1.0` non-precious), the partial-stack precious
  multiplier (`0.7`, vs. `0.35` non-precious), and the pair-momentum weight
  above (`0.35`) are three separate constants that all modulate "how much do
  we value precious goods," set independently rather than derived from one
  shared parameter. Worth checking whether coupling them (or re-deriving from
  a single precious-premium term) changes behavior before hand-tuning each
  in isolation.

## Render Blueprint sync (optional)

`render.yaml` has accumulated routes/headers that are live in the repo but
**not yet applied** to the actual Render service, because Render's
auto-deploy-on-push rebuilds the app without re-running the Blueprint's
`routes`/`headers` sections — that needs a one-time manual sync in the Render
dashboard. Currently inert until synced:

- The `/api/*` → worker and `/id-api/*` → identity same-origin rewrite
  proxies (workaround for iOS content blockers / DNS filters that block
  `*.workers.dev` wholesale at the network layer). The client-side fallback
  code (`src/net/proxyFallback.ts`) already handles the "not synced yet"
  case harmlessly (detects the SPA's HTML fallback and ignores it), so this
  is genuinely optional, not a live bug.
- `index.html`'s explicit `no-cache, must-revalidate` header (defense in
  depth — the update-available banner already covers the same failure mode
  client-side).

## IDEA — In-app online-match style feed

Today the MY STYLE tab only covers local vs-AI games (full per-move logging
is client-side, vs-AI only). Raised during the MY STYLE build (2026-07-28):
online matches could feed the same style stats later from the public moves
archive (`games`/`moves` tables), since that data is already fully public
(server-authoritative, redaction-safe by construction). Not scoped — no
endpoint or client-compute design decided.

## Anything else still open

A full-repo standing-bugs audit ran 2026-08-03 (18 agents: 6 finders →
adversarial verify) and found 10 confirmed bugs — **all 10 were fixed** in
the same pass (`10ac3e4`); 2 further claims were investigated and **refuted**
(resign win/loss inversion, ISMCTS tree stat corruption — recorded so they
aren't re-investigated). Deep systems (engine, redaction, idempotency,
games-first SQL, eval v2 math) came back clean. Nothing from that audit is
open as of this writing.

`analyze.mjs`'s ply-bucketing bug (dormant, noted during the MY STYLE build)
was patched 2026-08-03 — also closed, not open.

If you find something genuinely open that isn't listed above, add it here
with a status tag rather than back into the chronicle — the chronicle is
history-only now (see its header).

# ISMCTS baseline eval — 2026-07-27

Frozen baseline for `tools/mlogs/analyze.mjs`. This is the numeric snapshot
future runs get compared against — if a re-run on the same underlying data
produces different numbers, the script drifted (bug), not the baseline.

## Corpus

- 87 games, Vijay (`theonenonlyvj`, account `c02875a7-0470-5ef3-b87a-38abcbdcd952`)
  vs the **ismcts** tier ("Hard (ISMCTS)"), played 2026-07-25 → 07-27.
- Every logged game in this corpus is single-round (`round: 1` only) — the
  per-move logger evidently hadn't captured multi-round matches yet at this
  point. This is a genuine property of the data, not a script bug — see the
  round-end trigger note below.
- Record vs ismcts **overall: 44W-66L** (all 110 rows in the `matches` table
  for this account+tier). **Logged subset: 34W-53L** (the 87 games that
  actually have a `match_logs` row — analysis below only covers these).

## Bot (ISMCTS) health

- ai moves: 1681, with candidates: 1645
- **iterations/move** (top1 candidate's visit count — the closest proxy this
  logger captures to total tree iterations): median **60,612**  p10 19,964
  p90 93,552  min 5,364
- top1 share of top3 visits: median **0.84**
- near-ties (top1/top2 visits < 1.15): **166 (10%)**
- decisiveness (top1/top2 visit ratio ≥ threshold, over the same eligible
  population as near-ties): **≥2x 74%  ≥3x 65%  ≥5x 56%  ≥10x 46%** of moves
- root q (bot's own perspective), mean **+0.196**
  - in games the bot eventually **WON**: mean **+0.432** (n=991 ai moves)
  - in games the bot eventually **LOST**: mean **-0.163** (n=654 ai moves)
- **Verdict: healthy, well-calibrated, no strength-knob tuning warranted** —
  this was the conclusion reached in-session on 2026-07-27 (see
  `docs/superpowers/notes/2026-07-20-post-launch-fixes-and-backlog.md`,
  "UPDATE 2026-07-27").

### earlyStopped — not measurable yet

`IsmctsDebugInfo` carries an `earlyStopped` flag (shipped alongside the
unconditional-winner early stop, see below), but `IsmctsCandidateLog` /
`AiLogEntry.candidates` (`src/store/aiGameLog.ts`) does **not** carry it —
the per-move logger predates the early-stop feature. Fire-rate in the wild
can't be computed from match_logs until the logger is extended to record it.
Noted, not blocking.

## Vijay (theonenonlyvj) style vs ismcts

- **Action mix** (per-move %): human `SELL:39 TAKE_EXCHANGE:24 TAKE_SINGLE:20
  TAKE_CAMELS:17`  vs  ai `SELL:39 TAKE_EXCHANGE:24 TAKE_CAMELS:21
  TAKE_SINGLE:16`
- **Sell size distribution**: human n=680 `1c:34% 2c:39% 3c:20% 4c:6% 5c:2%`
  vs  ai n=651 `1c:22% 2c:47% 3c:21% 4c:9% 5c:2%`
- **Bonus sales** (quantity buckets, min(qty,5) — "3+/4+/5+" labels are the
  count at exactly that bucket, not cumulative): human `3+:134 4+:38 5+:11`
  vs  ai `3+:137 4+:56 5+:11`. **The 4-bonus gap (38 vs 56) is the single
  biggest structural difference in selling behavior** — the bot converts a
  meaningfully higher share of its sells into 4-card bonuses.
- **Precious-at-2** (diamond/gold/silver sold in pairs, of all precious
  sells): human `184 of 278 (66%)`  vs  ai `164 of 215 (76%)`
- **Tokens-per-card** (mean of per-sale got/quantity, from pile state at the
  moment of sale): human **3.79**  vs  ai **3.44** — Vijay sells into
  fuller/higher-value piles on average.
- **Camels**: both `TAKE_CAMELS` median herd-before = **1** (human n=299, ai
  n=357 — the bot takes camels noticeably more often, consistent with the
  action-mix gap above: 21% vs 17%).
- **Score trajectory** (human minus bot, mean per-move score delta by game
  quartile P0-P3):
  - **WINS**: `P0:-1.8  P1:+1.9  P2:+7.2  P3:+12.9` — wins are a **late
    surge**: Vijay is usually slightly behind early, pulls ahead by the
    midgame, and the lead compounds hard in the endgame.
  - **LOSSES**: `P0:-0.7  P1:-1.6  P2:-2.0  P3:-5.1` — losses are **small,
    compounding deficits**, not one big blunder: the gap widens steadily
    every quarter rather than swinging on a single mistake.
- **Round-end trigger** (who made the last move of the game): `ai_final: 39
  human_final: 48`. (No mid-match "round transition" events fire in this
  corpus — see the single-round-logs note above; only the `_final` — i.e.
  end-of-match — counters are populated today.)

## What changed after this baseline was taken (read before comparing future runs)

Shortly after this corpus was captured, the **unconditional-winner early
stop** shipped (`430c2ac`-era / earlystop_gate.ts gate, ~b3317dc-era in the
worker), cutting average ISMCTS think-time by roughly **30%** on wall-clock
budget runs by stopping once the visit lead is provably unbeatable (gated:
0/69 sampled stops changed the chosen move — provably the same top1 pick,
latency-only). **This means future runs will show LOWER median/p10/p90
iteration counts on settled moves BY DESIGN, not because the bot got
weaker.** When comparing a future run against this baseline:

- **Do** compare **decisiveness ratios** (top1/top2 visit ratio thresholds)
  and **top1 share** — these describe how conclusively the search settled,
  and are largely invariant to how many iterations it took to get there.
- **Do** compare **root q calibration** (mean q in eventual wins vs losses)
  — a search-quality signal, not a budget signal.
- **Don't** read a lower median iteration count alone as "the bot got
  weaker" or "something regressed" — check decisiveness/q first.

## Re-run instructions

```bash
cd /Users/vijayram/Cursor/vjaipur

# 1. Pull a fresh dump from remote D1 (requires wrangler auth; run from repo
#    root — the script itself cd's into worker/ for the wrangler calls).
node tools/mlogs/analyze.mjs --pull

# 2. Print the report (bot health + per-player style reports).
node tools/mlogs/analyze.mjs --tier ismcts

# Optional: scope to one account (id or a case-insensitive substring of
# their display_name).
node tools/mlogs/analyze.mjs --account theonenonlyvj --tier ismcts

node tools/mlogs/analyze.mjs --help   # full usage
```

`--pull` batches `match_logs` by id (~15 rows/query) to stay under D1's
per-response size limit — this corpus (87 rows) was ~1.6MB total across 5
batches. Data lands in `tools/mlogs/data/` (gitignored — contains account
ids and full per-move game state, never commit it).

### Verified against this baseline (2026-07-27)

This baseline was produced by running `tools/mlogs/analyze.mjs` against the
exact dump used for the original one-off Python analysis (converted into the
`--pull` output format: the same `batch_*.json` / `matches.json` /
`players.json` files, byte-identical `match_logs`/`matches` content). Every
number above — including decisiveness, near-ties, action mix, sell-size
distribution, bonus sales, precious-at-2, tokens-per-card, camel herd
medians, score trajectory, round-end trigger, and both the overall (44-66)
and logged-subset (34-53) records — reproduced **exactly**, digit-for-digit,
against the original Python script's output. See
`tests/tools/mlogsAnalyze.test.ts` for the pinned unit-level metric
definitions (sell-size %, tokens-per-card, record) that keep this from
silently drifting.

## What to watch in 3 months (once more players' data accumulates)

- **Per-player 4-bonus gap.** Vijay's is 38 vs the bot's 56 today — does
  everyone underconvert to 4-bonuses relative to the bot, or is this
  Vijay-specific? A wide per-player spread would suggest coachable technique
  ("hold for the 4th card") rather than an inherent bot advantage.
- **Tokens-per-card vs the bot's.** Vijay sells into higher-value piles
  (3.79 vs 3.44) — is that skill (patience) or just variance from a small
  sample? Worth re-checking once n is larger, and per-player once there's
  more than one account.
- **Whether Vijay's win% moves off ~40%** (44-66 overall, 34-53 logged) as
  more games accumulate — the bot health block above says the search itself
  is healthy and untouched, so a shift here is signal about play technique
  (his or future patches to himself), not the bot drifting.
- **Whether other players show the same win-trajectory shape** (late surge
  in wins, compounding small deficits in losses) or something different —
  right now this is n=1 (Vijay only); the per-player report is built
  specifically so this generalizes the moment a second account has ≥5
  logged games.
- **Multi-round logs.** Today's corpus is 100% single-round — once matches
  with real round-transition events show up, the "round-end trigger" plain
  (non-`_final`) counters should start populating; worth a sanity check that
  they look reasonable when that happens.
- **earlyStopped fire-rate in the wild**, once/if `AiLogEntry.candidates` is
  extended to carry it (currently only `IsmctsDebugInfo` does — see above).

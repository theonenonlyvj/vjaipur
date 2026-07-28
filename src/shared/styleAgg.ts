// "MY STYLE" (You vs the Bot) — pure, dependency-free aggregation over a
// player's per-move vs-AI logs (src/store/aiGameLog.ts's AiLogEntry[], as
// stored JSON-encoded in the D1 `match_logs.log` column).
//
// DEPENDENCY-FREE ON PURPOSE: no import from src/engine or
// src/store/aiGameLog.ts. `StyleLogEntry` below is a minimal STRUCTURAL
// subset of the real `AiLogEntry`/`WireAiLogEntry` shapes — every real log
// entry satisfies it via TypeScript's structural typing, so callers (the
// worker, the client, tests) can pass real log arrays straight through with
// no adapter.
//
// MERGEABILITY IS THE WHOLE POINT (worker/src/do/style.ts's incremental
// cache relies on it): `StyleAgg` is a tree of plain sums/counts — nothing
// derived (an average, a rate) is ever stored raw. `aggregateGame` folds ONE
// game into an existing agg; `mergeStyleAgg` combines two aggs. Because
// every field is a sum, merging is trivially associative AND commutative.
// Only `finalizeStyle` ever divides.
//
// NO FABRICATED NUMBERS (2026-07-27 design council review of the first cut
// of this feature): every number this module puts in front of a player is
// either a direct real aggregate (a count, a sum, a rate over real moves) or
// — for `pointImpact` — an ESTIMATE built from the game's own OFFICIAL,
// ENGINE-SOURCED constants (bonus-tile face values, the camel majority token
// value), never an invented figure. `pointImpact` is INTERNAL ONLY: it
// drives row ordering and the coaching pick, but is never itself rendered as
// a specific claimed "+N points" figure in any coaching string — the
// coaching strings only ever cite counts/rates this module actually computed
// from real per-move data.

// ---------------------------------------------------------------------------
// Minimal structural log-entry shape (see the file header for why this isn't
// imported from src/store/aiGameLog.ts).
// ---------------------------------------------------------------------------

export interface StyleLogAction {
  type: string
  /** Present on SELL actions only. */
  good?: string
  /** Present on SELL actions only. */
  quantity?: number
}

export interface StyleLogPreState {
  /** Remaining goods-token pile VALUES per good, GOOD_ORDER index order,
   *  index 0 = next value to be taken (src/store/aiGameLog.ts's
   *  CompactSnapshot.tok). */
  tok: number[][]
  /** Realized round score so far, [player0, player1] — human is always
   *  player 0, ai always player 1 for a local vs-AI match. */
  score: [number, number]
  /** Camel herd size, [player0, player1] — CompactSnapshot.herd. Always
   *  present whenever preState survived capping (capping strips the WHOLE
   *  preState object, never individual fields of it). */
  herd: [number, number]
}

export interface StyleLogEntry {
  actor: 'human' | 'ai'
  /** 1-indexed, monotonic across the whole match — SURVIVES cap-driven
   *  trimming of `preState` (src/store/aiGameLog.ts's `ply` docstring: it's
   *  derived from the entry's own field, never array position). Trajectory
   *  bucketing below uses this — NOT the entry's position in a
   *  preState-filtered array — precisely because it stays meaningful even
   *  when older entries have had `preState` stripped. */
  ply: number
  round: number
  action: StyleLogAction
  /** May be ABSENT on the oldest entries of a capped/trimmed log (see
   *  src/store/aiGameLog.ts#capLogForReport) — every metric below that reads
   *  it tolerates that; action-only tallies (action mix, sell sizes, bonus
   *  tiers, precious counts, camel-move count) never need it. */
  preState?: StyleLogPreState
}

export interface StyleGameOutcome {
  won: boolean
}

// ---------------------------------------------------------------------------
// Constants. GOOD_ORDER/PRECIOUS/CHEAP are kept in sync BY HAND with
// src/store/aiGameLog.ts's GOOD_ORDER and tools/mlogs/analyze.mjs's
// PRECIOUS (deliberately not imported, see the file header). The two VALUE
// tables below are the REAL, OFFICIAL Jaipur constants this engine already
// ships — src/engine/setup.ts#initialBonusPiles (bonus-tile face values) and
// src/engine/scoring.ts's CAMEL_TOKEN_VALUE — copied here (not invented) so
// `pointImpact` estimates below are grounded in the game's actual scoring,
// not guesses. Kept in sync by hand for the same dependency-free reason as
// GOOD_ORDER.
// ---------------------------------------------------------------------------

const GOOD_ORDER = ['diamond', 'gold', 'silver', 'cloth', 'spice', 'leather']
const PRECIOUS = new Set(['diamond', 'gold', 'silver'])
const CHEAP = new Set(['cloth', 'spice', 'leather'])

/** Mean face value per bonus-token tier, from src/engine/setup.ts's real
 *  tile tables: three=[3,3,2,2,2,1,1] (mean 2), four=[6,6,5,5,4,4] (mean 5),
 *  five=[10,10,9,8,8] (mean 9). Used ONLY to weight `pointImpact` estimates
 *  (see the file header) — never surfaced as a literal per-sale value claim,
 *  since a single sale's ACTUAL tile value isn't observable from a
 *  CompactSnapshot (only the remaining-pile COUNT is, and BonusToken.value
 *  is revealed exclusively at round scoring). */
const BONUS_TIER_MEAN_VALUE: Record<3 | 4 | 5, number> = { 3: 2, 4: 5, 5: 9 }

/** src/engine/scoring.ts's CAMEL_TOKEN_VALUE — the fixed point swing for
 *  holding camel majority at round end. */
const CAMEL_TOKEN_VALUE = 5

// ---------------------------------------------------------------------------
// The mergeable aggregate.
// ---------------------------------------------------------------------------

export type Actor = 'human' | 'ai'

export interface SellSizeHist {
  1: number
  2: number
  3: number
  4: number
  5: number
}

export interface BonusByTier {
  3: number
  4: number
  5: number
}

export interface PerActorAgg {
  /** action.type -> count, over EVERY logged move for this actor (never
   *  gated on preState — see the file header). */
  actionCounts: Record<string, number>
  /** SELL count by quantity, bucketed via min(quantity, 5) — "1..5+". Backs
   *  the cherry-picker signature (1-card share) and the sale-count floor. */
  sellSizeHist: SellSizeHist
  /** SELL count for quantity>=3 sales (the ones that earn a bonus token),
   *  bucketed by min(quantity,5), over ALL goods. */
  bonusSalesByTier: BonusByTier
  /** Same bucketing, restricted to CHEAP goods (cloth/spice/leather) only —
   *  backs the "hold the 3-stack for a 4th" coaching line, which must never
   *  extend to precious goods (only 5-7 copies of each exist; selling a
   *  precious 3-stack early is frequently correct, so this module never
   *  advises holding one). */
  cheapBonusSalesByTier: BonusByTier
  /** Precious-good (diamond/gold/silver) sells made at EXACTLY quantity 2. */
  preciousAt2: number
  /** All precious-good sells, any quantity. */
  preciousTotal: number
  /** Sum of pile-top token VALUES earned across every SELL whose preState
   *  survived capping — the numerator of "tokens per card sold". */
  tokensEarned: number
  /** Sum of quantities sold across those same preState-bearing SELLs — the
   *  denominator of "tokens per card sold". */
  cardsSold: number
  takeCamelsCount: number
  /** Every logged move by this actor, regardless of type or preState. */
  totalMoves: number
}

export interface PhaseBucket {
  sum: number
  count: number
}

/** Human-minus-bot score, by game-phase quartile — bucketed by each entry's
 *  `ply` POSITION WITHIN THE GAME'S OWN PLY RANGE (min/max ply across the
 *  whole logged game, including entries whose preState was stripped by
 *  capping), never by an index into a preState-filtered array — see
 *  StyleLogEntry.ply's docstring for why that distinction matters under
 *  capping. Accumulated separately for games the human won vs lost. sum+count
 *  (not a running mean) so merging two aggs is exact. */
export interface Trajectory {
  wins: [PhaseBucket, PhaseBucket, PhaseBucket, PhaseBucket]
  losses: [PhaseBucket, PhaseBucket, PhaseBucket, PhaseBucket]
}

/** Round-end camel majority (src/engine/scoring.ts: strictly more camels at
 *  round end wins a fixed CAMEL_TOKEN_VALUE-point token; a tie awards
 *  neither). Determined per round from the LAST log entry of that round
 *  that still carries `preState` (walking backward past any capped
 *  trailing entries) — its `preState.herd` is a PRE-MOVE snapshot, so this
 *  is a close proxy for the round's true final herd, not a guaranteed exact
 *  read; a round with NO preState-bearing entry at all is excluded from
 *  `roundsAnalyzed` entirely rather than guessed at. */
export interface CamelMajorityAgg {
  roundsAnalyzed: number
  humanMajority: number
  aiMajority: number
}

export interface StyleAgg {
  games: number
  wins: number
  losses: number
  human: PerActorAgg
  ai: PerActorAgg
  trajectory: Trajectory
  camelMajority: CamelMajorityAgg
}

function emptyPerActorAgg(): PerActorAgg {
  return {
    actionCounts: {},
    sellSizeHist: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    bonusSalesByTier: { 3: 0, 4: 0, 5: 0 },
    cheapBonusSalesByTier: { 3: 0, 4: 0, 5: 0 },
    preciousAt2: 0,
    preciousTotal: 0,
    tokensEarned: 0,
    cardsSold: 0,
    takeCamelsCount: 0,
    totalMoves: 0,
  }
}

function emptyPhaseBucket(): PhaseBucket {
  return { sum: 0, count: 0 }
}

function emptyPhases(): [PhaseBucket, PhaseBucket, PhaseBucket, PhaseBucket] {
  return [emptyPhaseBucket(), emptyPhaseBucket(), emptyPhaseBucket(), emptyPhaseBucket()]
}

export function emptyStyleAgg(): StyleAgg {
  return {
    games: 0,
    wins: 0,
    losses: 0,
    human: emptyPerActorAgg(),
    ai: emptyPerActorAgg(),
    trajectory: { wins: emptyPhases(), losses: emptyPhases() },
    camelMajority: { roundsAnalyzed: 0, humanMajority: 0, aiMajority: 0 },
  }
}

// ---------------------------------------------------------------------------
// aggregateGame — fold ONE game's log entries into an existing agg.
// ---------------------------------------------------------------------------

/** Fold a single game (its log entries + final outcome) into `agg`,
 *  returning a NEW StyleAgg (never mutates its inputs). Implemented as
 *  `mergeStyleAgg(agg, <this one game's own agg>)`, which is what makes the
 *  associativity property (see the file header) hold by construction. */
export function aggregateGame(agg: StyleAgg, logEntries: readonly StyleLogEntry[], outcome: StyleGameOutcome): StyleAgg {
  return mergeStyleAgg(agg, aggregateSingleGame(logEntries, outcome))
}

function bucket5(q: number): 1 | 2 | 3 | 4 | 5 {
  return Math.min(Math.max(Math.trunc(q), 1), 5) as 1 | 2 | 3 | 4 | 5
}

function computeCamelMajority(logEntries: readonly StyleLogEntry[]): CamelMajorityAgg {
  const byRound = new Map<number, StyleLogEntry[]>()
  for (const e of logEntries) {
    const bucket = byRound.get(e.round)
    if (bucket) bucket.push(e)
    else byRound.set(e.round, [e])
  }

  let roundsAnalyzed = 0
  let humanMajority = 0
  let aiMajority = 0
  for (const entries of byRound.values()) {
    let last: StyleLogEntry | undefined
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].preState) {
        last = entries[i]
        break
      }
    }
    if (!last?.preState) continue // no preState-bearing entry this round — excluded, not guessed at
    roundsAnalyzed += 1
    const [h, a] = last.preState.herd
    if (h > a) humanMajority += 1
    else if (a > h) aiMajority += 1
    // exact tie: counted in roundsAnalyzed, wins neither side (matches the
    // real rule — no camel token on a tie)
  }
  return { roundsAnalyzed, humanMajority, aiMajority }
}

function aggregateSingleGame(logEntries: readonly StyleLogEntry[], outcome: StyleGameOutcome): StyleAgg {
  const agg = emptyStyleAgg()
  agg.games = 1
  if (outcome.won) agg.wins = 1
  else agg.losses = 1

  for (const e of logEntries) {
    const per = e.actor === 'human' ? agg.human : e.actor === 'ai' ? agg.ai : null
    if (!per) continue // defensive: unknown actor label

    const type = e.action?.type
    if (!type) continue
    per.actionCounts[type] = (per.actionCounts[type] ?? 0) + 1
    per.totalMoves += 1

    if (type === 'SELL') {
      const q = e.action.quantity ?? 0
      const b = bucket5(q)
      per.sellSizeHist[b] += 1
      if (q >= 3) {
        per.bonusSalesByTier[b as 3 | 4 | 5] += 1
        if (e.action.good && CHEAP.has(e.action.good)) per.cheapBonusSalesByTier[b as 3 | 4 | 5] += 1
      }
      if (e.action.good && PRECIOUS.has(e.action.good)) {
        per.preciousTotal += 1
        if (q === 2) per.preciousAt2 += 1
      }
      if (e.preState) {
        const gi = GOOD_ORDER.indexOf(e.action.good ?? '')
        if (gi !== -1) {
          const pile = e.preState.tok[gi] ?? []
          const got = pile.slice(0, q).reduce((s, v) => s + v, 0)
          per.tokensEarned += got
          per.cardsSold += q
        }
      }
    } else if (type === 'TAKE_CAMELS') {
      per.takeCamelsCount += 1
    }
  }

  // Score trajectory — bucketed by ply POSITION within the game's own ply
  // range (see StyleLogEntry.ply / Trajectory's docstrings), over the full
  // log (capped entries included, so the range is always the game's TRUE
  // ply span), skipping only individual entries that lack preState.
  if (logEntries.length > 0) {
    const plies = logEntries.map((e) => e.ply)
    const minPly = Math.min(...plies)
    const maxPly = Math.max(...plies)
    const range = Math.max(1, maxPly - minPly + 1)
    const phases = outcome.won ? agg.trajectory.wins : agg.trajectory.losses
    for (const e of logEntries) {
      if (!e.preState) continue
      const ph = Math.min(3, Math.floor((4 * (e.ply - minPly)) / range))
      const diff = e.preState.score[0] - e.preState.score[1]
      phases[ph].sum += diff
      phases[ph].count += 1
    }
  }

  agg.camelMajority = computeCamelMajority(logEntries)

  return agg
}

// ---------------------------------------------------------------------------
// mergeStyleAgg — associative, commutative combination of two aggs.
// ---------------------------------------------------------------------------

function mergeActionCounts(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...a }
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v
  return out
}

function mergeBonusByTier(a: BonusByTier, b: BonusByTier): BonusByTier {
  return { 3: a[3] + b[3], 4: a[4] + b[4], 5: a[5] + b[5] }
}

function mergePerActorAgg(a: PerActorAgg, b: PerActorAgg): PerActorAgg {
  return {
    actionCounts: mergeActionCounts(a.actionCounts, b.actionCounts),
    sellSizeHist: {
      1: a.sellSizeHist[1] + b.sellSizeHist[1],
      2: a.sellSizeHist[2] + b.sellSizeHist[2],
      3: a.sellSizeHist[3] + b.sellSizeHist[3],
      4: a.sellSizeHist[4] + b.sellSizeHist[4],
      5: a.sellSizeHist[5] + b.sellSizeHist[5],
    },
    bonusSalesByTier: mergeBonusByTier(a.bonusSalesByTier, b.bonusSalesByTier),
    cheapBonusSalesByTier: mergeBonusByTier(a.cheapBonusSalesByTier, b.cheapBonusSalesByTier),
    preciousAt2: a.preciousAt2 + b.preciousAt2,
    preciousTotal: a.preciousTotal + b.preciousTotal,
    tokensEarned: a.tokensEarned + b.tokensEarned,
    cardsSold: a.cardsSold + b.cardsSold,
    takeCamelsCount: a.takeCamelsCount + b.takeCamelsCount,
    totalMoves: a.totalMoves + b.totalMoves,
  }
}

function mergePhases(
  a: [PhaseBucket, PhaseBucket, PhaseBucket, PhaseBucket],
  b: [PhaseBucket, PhaseBucket, PhaseBucket, PhaseBucket],
): [PhaseBucket, PhaseBucket, PhaseBucket, PhaseBucket] {
  return [0, 1, 2, 3].map((i) => ({ sum: a[i].sum + b[i].sum, count: a[i].count + b[i].count })) as [
    PhaseBucket,
    PhaseBucket,
    PhaseBucket,
    PhaseBucket,
  ]
}

/** Combine two aggregates. Associative AND commutative (every field is a
 *  plain sum) — this is the property worker/src/do/style.ts's incremental
 *  cache depends on: `mergeStyleAgg(cachedAgg, foldOf(newRowsOnly))` must
 *  equal `foldOf(allRowsFromScratch)`. */
export function mergeStyleAgg(a: StyleAgg, b: StyleAgg): StyleAgg {
  return {
    games: a.games + b.games,
    wins: a.wins + b.wins,
    losses: a.losses + b.losses,
    human: mergePerActorAgg(a.human, b.human),
    ai: mergePerActorAgg(a.ai, b.ai),
    trajectory: {
      wins: mergePhases(a.trajectory.wins, b.trajectory.wins),
      losses: mergePhases(a.trajectory.losses, b.trajectory.losses),
    },
    camelMajority: {
      roundsAnalyzed: a.camelMajority.roundsAnalyzed + b.camelMajority.roundsAnalyzed,
      humanMajority: a.camelMajority.humanMajority + b.camelMajority.humanMajority,
      aiMajority: a.camelMajority.aiMajority + b.camelMajority.aiMajority,
    },
  }
}

// ---------------------------------------------------------------------------
// finalizeStyle — the display shape. The ONLY place this module divides.
// ---------------------------------------------------------------------------

export type TugRowId = 'tokensPerCard' | 'bonus4Rate' | 'bonus3Rate' | 'bonus5Rate' | 'camelMajority'
export type TugRowFormat = 'percent' | 'decimal'
export type TugRowGapKind = 'relative' | 'points'
export type TugRowSide = 'human' | 'ai' | 'even'
/** 'gap' = this row carries the single biggest live (eligible, !dead) gap on
 *  its side (see finalizeStyle's tagging comment) — deliberately ONE neutral
 *  tag text for both sides (no "decider"/"craft" editorializing; a
 *  human-favored gap is not framed as an achievement, a bot-favored one is
 *  not framed as a verdict — just "this is the biggest measured gap"). */
export type TugRowTag = 'gap' | null

export interface TugRow {
  id: TugRowId
  label: string
  /** Plain-language explainer for a jargon-y metric name, shown as a small
   *  sub-line under the label (e.g. tokensPerCard -> "how much each card
   *  you sell is worth"). Absent when the label is already plain. */
  sublabel?: string
  human: number
  ai: number
  format: TugRowFormat
  gapKind: TugRowGapKind
  /** Unsigned gap magnitude — a RELATIVE % (of whichever side is behind) for
   *  gapKind:'relative', or a raw PERCENTAGE-POINT difference for
   *  gapKind:'points' (both `human`/`ai` are already 0-100 rates for a
   *  'points' row, so this is just |human - ai|, capped defensively at
   *  100). Capped at 999 for 'relative' so a divide-by-zero blowout stays
   *  finite/JSON-safe instead of Infinity. */
  gapPct: number
  side: TugRowSide
  /** True when |gap| < 5 (points or relative, per gapKind). */
  dead: boolean
  tag: TugRowTag
  /** False when the row's own sample-size floor isn't cleared yet — the row
   *  still renders (dimmed) with `sampleNote` explaining why, rather than
   *  disappearing (a player should never wonder where a row went). */
  eligible: boolean
  /** Human-readable "why this is dimmed" note, e.g. "needs more data (n=18,
   *  need 30)" — empty string when `eligible`. */
  sampleNote: string
  /** Extra real-number context for a rate row (e.g. raw N-of-M sale counts
   *  behind a percentage) — always built from real aggregates, never
   *  invented. Absent when the row has nothing extra to add. */
  subCaption?: string
  /** INTERNAL ranking key only (see the file header) — an estimated
   *  per-game point-swing magnitude, built from real aggregates and the
   *  engine's own official scoring constants. Never rendered as a literal
   *  "+N points" claim anywhere; used solely to order `rows` and to pick
   *  the coaching target. Always finite. */
  pointImpact: number
}

export interface StyleSignatures {
  cherryPicker: boolean
  cherryPickerPct: number
  cherryPickerEligible: boolean
  preciousTempo: boolean
  preciousTempoHumanPct: number
  preciousTempoAiPct: number
  preciousTempoEligible: boolean
  boomPlayer: boolean
  boomPlayerEligible: boolean
}

export interface TrajectoryPhaseOut {
  mean: number
  count: number
}

export interface StyleFinalized {
  games: number
  wins: number
  losses: number
  winPct: number
  rows: TugRow[]
  /** Call-outs for data that was folded away rather than shown as its own
   *  (confidently even) row — see finalizeStyle's 3-/5-bonus drop rule. */
  notes: string[]
  signatures: StyleSignatures
  trajectoryWins: [TrajectoryPhaseOut, TrajectoryPhaseOut, TrajectoryPhaseOut, TrajectoryPhaseOut]
  trajectoryLosses: [TrajectoryPhaseOut, TrajectoryPhaseOut, TrajectoryPhaseOut, TrajectoryPhaseOut]
  coaching: string
}

function safeDiv(num: number, den: number): number {
  return den > 0 ? num / den : 0
}

function sumHist(h: SellSizeHist): number {
  return h[1] + h[2] + h[3] + h[4] + h[5]
}

function sumBonusEligible(b: BonusByTier): number {
  return b[3] + b[4] + b[5]
}

const GAP_CAP = 999
/** Below this |gap| (points or relative-%, per row), a row renders as "dead
 *  even". */
const DEAD_EVEN_THRESHOLD = 5

// ---- sample-size floors (design council, 2026-07-27) -----------------------
// Every floor below with a code comment citing the council's own wording is
// literal; ones marked ADAPTED are a reasoned scaling choice made because the
// council's delta didn't name an exact number for that specific gate — see
// this feature's final report for the explicit call-out.
const TOKENS_PER_CARD_FLOOR = 30 // "tokens/card requires ≥30 cards sold"
const BONUS_RATE_FLOOR = 10 // "4-bonus rate requires ≥10 bonus-eligible (3+) sales by each side"
const CAMEL_MOVE_FREQUENCY_FLOOR = 50 // "camel rows ≥50 moves"
const SALE_SIZE_FLOOR = 20 // "sale-size ≥20 sales" (cherry-picker)
// ADAPTED: the council didn't name a rounds-count floor for the NEW
// round-outcome camel-majority metric (it's rounds, not moves) — scaled to
// roughly the same statistical weight as the 50-move camel floor, since a
// round averages several moves; documented here rather than silently guessed.
const CAMEL_MAJORITY_ROUNDS_FLOOR = 10
// ADAPTED: no explicit floor was named for precious-tempo; matched to the
// same order of magnitude as BONUS_RATE_FLOOR (10) since both are "at least
// a double-digit sample of a specific sale pattern" gates.
const PRECIOUS_TEMPO_FLOOR = 10
// The boom-player signature reads trajectoryWins directly, so it inherits
// the trajectory section's own wins-count gate (see finalizeStyle) rather
// than defining a separate number.
const BOOM_PLAYER_WINS_FLOOR = 10

/** FIXED tie-break order for `rows` when two rows land on the exact same
 *  `pointImpact` (rare, but sorting must never depend on Array.prototype
 *  .sort's incidental stability across re-renders/re-computations — see
 *  TugRowId ordering below, chosen once and never reordered). */
const ROW_TIE_BREAK_ORDER: TugRowId[] = ['tokensPerCard', 'bonus4Rate', 'camelMajority', 'bonus3Rate', 'bonus5Rate']

interface RowInput {
  id: TugRowId
  label: string
  sublabel?: string
  human: number
  ai: number
  format: TugRowFormat
  gapKind: TugRowGapKind
  eligible: boolean
  sampleN: number
  floorN: number
  subCaption?: string
  pointImpact: number
}

function buildRow(input: RowInput): TugRow {
  const { human, ai, gapKind } = input
  let side: TugRowSide
  let gapPct: number
  if (human === ai) {
    side = 'even'
    gapPct = 0
  } else {
    side = human > ai ? 'human' : 'ai'
    if (gapKind === 'points') {
      gapPct = Math.min(100, Math.abs(human - ai))
    } else {
      const base = Math.min(human, ai)
      const diff = Math.abs(human - ai)
      gapPct = base > 0 ? Math.min(GAP_CAP, (diff / base) * 100) : GAP_CAP
    }
  }
  const dead = gapPct < DEAD_EVEN_THRESHOLD
  const sampleNote = input.eligible ? '' : `needs more data (n=${input.sampleN}, need ${input.floorN})`
  return {
    id: input.id,
    label: input.label,
    sublabel: input.sublabel,
    human,
    ai,
    format: input.format,
    gapKind,
    gapPct,
    side,
    dead,
    tag: null,
    eligible: input.eligible,
    sampleNote,
    subCaption: input.subCaption,
    pointImpact: Number.isFinite(input.pointImpact) ? input.pointImpact : 0,
  }
}

function fmtCount(n: number): string {
  return String(Math.round(n))
}

/** Rule-based coaching text for the given (already-selected) row, pulling
 *  every number directly from `agg` — never from an invented figure, and
 *  never asserting `row.pointImpact` as a literal point value (see the file
 *  header). Each message is CONDITIONED (not a blanket imperative) and the
 *  bonus4Rate message NEVER extends its advice to precious goods. */
function coachMessage(row: TugRow, agg: StyleAgg): string {
  switch (row.id) {
    case 'bonus4Rate': {
      const humanCheap4 = agg.human.cheapBonusSalesByTier[4]
      const aiCheap4 = agg.ai.cheapBonusSalesByTier[4]
      if (humanCheap4 === 0 && aiCheap4 === 0) {
        return (
          `The bot converts 3-card stacks into 4-card bonus sales more often than you do, as a share of its ` +
          `bonus-eligible sales (${fmtCount(row.ai)}% vs your ${fmtCount(row.human)}%). Only worth chasing on cheap goods ` +
          `(cloth/spice/leather) when the round isn't about to end — never on precious (diamond/gold/silver): only ` +
          `5-6 copies of each exist, and selling a precious 3-stack is often correct.`
        )
      }
      return (
        `With cheap goods (cloth/spice/leather), when the round isn't about to end, holding a 3-stack for the 4th ` +
        `card usually pays — the bot does this ${aiCheap4} times to your ${humanCheap4}. Never hold a PRECIOUS ` +
        `(diamond/gold/silver) 3-stack for this: only 5-6 copies of each exist, so selling 3 is often correct.`
      )
    }
    case 'bonus3Rate':
      return (
        `The bot cashes out right at 3 more often than you do, as a share of its bonus-eligible sales — ` +
        `${agg.ai.bonusSalesByTier[3]} sales to your ${agg.human.bonusSalesByTier[3]}. When a round's about to end ` +
        `or a pile's nearly dry, banking the 3 instead of reaching for a 4th is usually the safer read.`
      )
    case 'bonus5Rate':
      return (
        `The bot pushes bonus sales all the way to 5 more often than you do — ${agg.ai.bonusSalesByTier[5]} sales ` +
        `to your ${agg.human.bonusSalesByTier[5]}. That only pays off when you can hold a big stack safely, without ` +
        `the round ending underneath you.`
      )
    case 'tokensPerCard':
      return (
        `The bot earns more per card sold than you do, across the cards each of you has sold this tier. Selling ` +
        `earlier in a pile — before its best-value tokens are taken — is the usual explanation for a gap like this.`
      )
    case 'camelMajority':
      return (
        `The bot ends rounds holding camel majority more often than you do — ${agg.camelMajority.aiMajority} of ` +
        `${agg.camelMajority.roundsAnalyzed} analyzed rounds, vs your ${agg.camelMajority.humanMajority}. Camel ` +
        `majority is a fixed swing at round end; grabbing camels late in a round, once few goods are worth taking, ` +
        `is usually the highest-leverage moment for it.`
      )
    default:
      return `Close the gap on ${row.label.toLowerCase()}: the bot leads here.`
  }
}

const NO_COACHING_YET = 'Play more games — your style read sharpens as you go.'

/** Produce the display shape from a mergeable aggregate. Every division here
 *  is guarded (safeDiv) so an all-zero agg finalizes to a sane all-zero
 *  shape instead of NaN/Infinity. */
export function finalizeStyle(agg: StyleAgg): StyleFinalized {
  const winPct = safeDiv(agg.wins, agg.games) * 100

  // ---- tokensPerCard (relative-%, per design council item 6) -------------
  const humanTokensPerCard = safeDiv(agg.human.tokensEarned, agg.human.cardsSold)
  const aiTokensPerCard = safeDiv(agg.ai.tokensEarned, agg.ai.cardsSold)
  const tokensPerCardSampleN = Math.min(agg.human.cardsSold, agg.ai.cardsSold)
  const tokensPerCardRow = buildRow({
    id: 'tokensPerCard',
    label: 'Tokens per card sold',
    sublabel: 'how much each card you sell is worth',
    human: humanTokensPerCard,
    ai: aiTokensPerCard,
    format: 'decimal',
    gapKind: 'relative',
    eligible: tokensPerCardSampleN >= TOKENS_PER_CARD_FLOOR,
    sampleN: tokensPerCardSampleN,
    floorN: TOKENS_PER_CARD_FLOOR,
    pointImpact: Math.abs(humanTokensPerCard - aiTokensPerCard) * safeDiv(agg.human.cardsSold, agg.games),
  })

  // ---- bonus rate rows (percentage-points, per design council item 6) ----
  const humanBonusEligible = sumBonusEligible(agg.human.bonusSalesByTier)
  const aiBonusEligible = sumBonusEligible(agg.ai.bonusSalesByTier)
  const bonusRateSampleN = Math.min(humanBonusEligible, aiBonusEligible)
  const bonusRateEligible = bonusRateSampleN >= BONUS_RATE_FLOOR

  function bonusRateRow(id: 'bonus4Rate' | 'bonus3Rate' | 'bonus5Rate', tier: 3 | 4 | 5, label: string): TugRow {
    const humanCount = agg.human.bonusSalesByTier[tier]
    const aiCount = agg.ai.bonusSalesByTier[tier]
    const humanPct = safeDiv(humanCount, humanBonusEligible) * 100
    const aiPct = safeDiv(aiCount, aiBonusEligible) * 100
    return buildRow({
      id,
      label,
      human: humanPct,
      ai: aiPct,
      format: 'percent',
      gapKind: 'points',
      eligible: bonusRateEligible,
      sampleN: bonusRateSampleN,
      floorN: BONUS_RATE_FLOOR,
      subCaption: `${fmtCount(humanCount)} of ${fmtCount(humanBonusEligible)} bonus sales · bot ${fmtCount(aiCount)} of ${fmtCount(aiBonusEligible)}`,
      pointImpact: (Math.abs(humanPct - aiPct) / 100) * safeDiv(humanBonusEligible, agg.games) * BONUS_TIER_MEAN_VALUE[tier],
    })
  }

  const bonus4Row = bonusRateRow('bonus4Rate', 4, '4-card bonus rate')
  const bonus3Row = bonusRateRow('bonus3Rate', 3, '3-card bonus rate')
  const bonus5Row = bonusRateRow('bonus5Rate', 5, '5-card bonus rate')

  // Drop the 3/5 pair to a note ONLY when both are confidently (eligible)
  // even — an under-sampled row is dimmed and shown instead, never silently
  // dropped (a player should never wonder where a row went).
  const notes: string[] = []
  const bonus35BothConfidentlyEven = bonus3Row.eligible && bonus3Row.dead && bonus5Row.eligible && bonus5Row.dead
  if (bonus35BothConfidentlyEven) {
    notes.push('3- and 5-card bonus rates are dead even too.')
  }

  // ---- camel majority at round end (percentage-points) --------------------
  const humanMajorityPct = safeDiv(agg.camelMajority.humanMajority, agg.camelMajority.roundsAnalyzed) * 100
  const aiMajorityPct = safeDiv(agg.camelMajority.aiMajority, agg.camelMajority.roundsAnalyzed) * 100
  const camelMajorityEligible = agg.camelMajority.roundsAnalyzed >= CAMEL_MAJORITY_ROUNDS_FLOOR

  // The frequency-only "how often do you even reach for camels" stat folds
  // into this row's sub-caption (design council item 8) rather than standing
  // alone as its own outcome-linked-looking row — tagged explicitly as
  // style, not verdict, and gated by its OWN (moves-based) floor.
  const camelMoveSampleN = Math.min(agg.human.totalMoves, agg.ai.totalMoves)
  const humanCamelMovePct = safeDiv(agg.human.takeCamelsCount, agg.human.totalMoves) * 100
  const aiCamelMovePct = safeDiv(agg.ai.takeCamelsCount, agg.ai.totalMoves) * 100
  const camelFrequencyNote =
    camelMoveSampleN >= CAMEL_MOVE_FREQUENCY_FLOOR
      ? `you take camels on ${fmtCount(humanCamelMovePct)}% of your moves vs bot ${fmtCount(aiCamelMovePct)}% (style, not verdict)`
      : `camel-taking frequency needs more data (n=${camelMoveSampleN}, need ${CAMEL_MOVE_FREQUENCY_FLOOR})`

  const camelMajorityRow = buildRow({
    id: 'camelMajority',
    label: 'Camel majority at round end',
    human: humanMajorityPct,
    ai: aiMajorityPct,
    format: 'percent',
    gapKind: 'points',
    eligible: camelMajorityEligible,
    sampleN: agg.camelMajority.roundsAnalyzed,
    floorN: CAMEL_MAJORITY_ROUNDS_FLOOR,
    subCaption: `${fmtCount(agg.camelMajority.humanMajority)} of ${fmtCount(agg.camelMajority.roundsAnalyzed)} analyzed rounds · bot ${fmtCount(agg.camelMajority.aiMajority)} · ${camelFrequencyNote}`,
    pointImpact:
      (Math.abs(humanMajorityPct - aiMajorityPct) / 100) * safeDiv(agg.camelMajority.roundsAnalyzed, agg.games) * CAMEL_TOKEN_VALUE,
  })

  const rows: TugRow[] = [tokensPerCardRow, bonus4Row, camelMajorityRow]
  if (!bonus35BothConfidentlyEven) rows.push(bonus3Row, bonus5Row)

  // Sort by absolute point impact, FIXED metric-order tie-break (design
  // council item 13) — never a stateful/incidental tie-break, so row order
  // never flickers between identical re-computations.
  rows.sort((a, b) => b.pointImpact - a.pointImpact || ROW_TIE_BREAK_ORDER.indexOf(a.id) - ROW_TIE_BREAK_ORDER.indexOf(b.id))

  // Tag exactly ONE biggest-gap row per side — ONLY among rows that clear
  // their own floor and aren't dead-even (an under-sampled or even row is
  // never "the" gap). Rows are already sorted by pointImpact desc, so the
  // first match per side is that side's biggest LIVE gap. Neutral 'gap' tag
  // on both sides (see TugRowTag's docstring) — no "decider"/"craft"
  // editorializing.
  const decider = rows.find((r) => r.eligible && !r.dead && r.side === 'ai')
  const biggestHumanGap = rows.find((r) => r.eligible && !r.dead && r.side === 'human')
  if (decider) decider.tag = 'gap'
  if (biggestHumanGap) biggestHumanGap.tag = 'gap'

  // ---- signatures -----------------------------------------------------
  const totalHumanSells = sumHist(agg.human.sellSizeHist)
  const cherryPickerEligible = totalHumanSells >= SALE_SIZE_FLOOR
  const cherryPickerPct = safeDiv(agg.human.sellSizeHist[1], totalHumanSells) * 100

  const preciousTempoSampleN = Math.min(agg.human.preciousTotal, agg.ai.preciousTotal)
  const preciousTempoEligible = preciousTempoSampleN >= PRECIOUS_TEMPO_FLOOR
  const preciousTempoHumanPct = safeDiv(agg.human.preciousAt2, agg.human.preciousTotal) * 100
  const preciousTempoAiPct = safeDiv(agg.ai.preciousAt2, agg.ai.preciousTotal) * 100

  const boomPlayerEligible = agg.wins >= BOOM_PLAYER_WINS_FLOOR
  const winTrajFinalMean = safeDiv(agg.trajectory.wins[3].sum, agg.trajectory.wins[3].count)

  const signatures: StyleSignatures = {
    cherryPicker: cherryPickerEligible && cherryPickerPct > 30,
    cherryPickerPct,
    cherryPickerEligible,
    preciousTempo: preciousTempoEligible && preciousTempoHumanPct >= 60,
    preciousTempoHumanPct,
    preciousTempoAiPct,
    preciousTempoEligible,
    boomPlayer: boomPlayerEligible && winTrajFinalMean > 8,
    boomPlayerEligible,
  }

  const toPhaseOut = (b: PhaseBucket): TrajectoryPhaseOut => ({ mean: safeDiv(b.sum, b.count), count: b.count })

  // ---- coaching pick: floor-clearing, live, ai-favored rows only ---------
  const coaching = decider ? coachMessage(decider, agg) : NO_COACHING_YET

  return {
    games: agg.games,
    wins: agg.wins,
    losses: agg.losses,
    winPct,
    rows,
    notes,
    signatures,
    trajectoryWins: agg.trajectory.wins.map(toPhaseOut) as StyleFinalized['trajectoryWins'],
    trajectoryLosses: agg.trajectory.losses.map(toPhaseOut) as StyleFinalized['trajectoryLosses'],
    coaching,
  }
}

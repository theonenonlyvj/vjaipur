// Single source of truth for AI difficulty tier metadata: display labels,
// picker flavor copy, and picker visibility.
//
// `id` is the STABLE engine id — it's exactly what gets written as
// `opponent_type` on a MatchRecord (see gameStore.ts `runAi` / `nextRound`
// and statsStore.ts `addMatch`). It must NEVER change, even when a tier is
// renamed or retired from the picker, or historical stats rows silently
// stop resolving to a name. Only `label`/`tagline` may change over time.
//
// "Retired" tiers (old MCTS hardAi, fairBot) are removed from the active
// picker but keep a full entry here so any UI (StatsDashboard, GameOverScreen,
// etc.) can still render a name for historical matches played against them.
// Their engine/worker files (hardAi.ts, fairBot.ts, aiWorker.ts,
// fairBotWorker.ts) are untouched — only their presence in the picker
// changed.

export type TierId = 'easy' | 'medium' | 'hard' | 'hard2' | 'ismcts' | 'hard3' | 'fair'

/**
 * Leaderboard grouping tag (StatsDashboard.tsx's "Hard" drill-down, 2026-07-25
 * lineup-crowding fix). Tiers sharing the same `family` collapse into ONE
 * top-level leaderboard chip once 2+ of them have data, with a secondary
 * "All <Family> + one chip per data-bearing member" drill-down row — see
 * `getFamilyMembers`/`getFamilyPrimary` below. A tier with no `family` is
 * always its own flat top-level chip, same as before this feature existed.
 *
 * The tag is a GROUPING KEY, deliberately its own (small) type rather than
 * reusing `TierId` — it happens to read the same as 'hard' (the retired
 * Classic MCTS tier's own id) and 'medium' (the active Medium tier's own id)
 * today, but that's naming convenience, not a structural link. Nothing here
 * ever compares `family === id`; every family operation goes through the
 * `family` field alone. This is what lets 'medium' become a family of its
 * own later (e.g. if 'fair' is reassigned `family: 'medium'` because it
 * benchmarks closer to Medium than to hardAi2) — 'medium' the tier just
 * needs `family: 'medium'` added alongside it, and the SAME generic
 * mechanism collapses/drills-down for it exactly like it does for 'hard'
 * today. No component-side changes required for that move.
 */
export type TierFamily = 'hard' | 'medium'

export interface Tier {
  /** Stable engine id, stored verbatim as opponent_type. Never rename. */
  id: TierId
  /** Display name — shown in the picker and in stats/history. */
  label: string
  /** Picker flavor copy. Empty for retired tiers (never shown in the picker). */
  tagline: string
  /** 1-based position in the active picker; null when retired. */
  pickerOrder: number | null
  /** Retired tiers are hidden from the picker but still resolve in stats. */
  retired: boolean
  /** Optional leaderboard grouping tag — see `TierFamily`'s docstring.
   *  Undefined = never grouped, always a flat top-level leaderboard chip. */
  family?: TierFamily
}

export const TIERS: Tier[] = [
  {
    id: 'easy',
    label: 'Easy',
    tagline: 'A relaxed intro opponent.',
    pickerOrder: 1,
    retired: false,
  },
  {
    id: 'medium',
    label: 'Medium',
    tagline: 'A solid club player.',
    pickerOrder: 2,
    retired: false,
    // Canonical member of the medium family (the two demoted Classics below
    // file under it in the leaderboard drill-down).
    family: 'medium',
  },
  {
    // Engine: hardAi2 (src/ai/hardAi2.ts, via aiWorker2). FAIR determinization
    // + alpha-beta search — reconstructs a plausible opponent hand from only
    // public info (revealedHands), never reads the true hidden hand or deck
    // order. This is the active "Hard" as of the 2026-07-20 lineup rework:
    // hardAi2 already beat the previous "Hard" (fairBot) 82% head-to-head and
    // runs in a tightened ~1500ms budget (vs fairBot's old 7-12s); it also
    // picked up fairBot's/hardAi3's endgame tactics it was missing (locking a
    // round-ending sell while ahead, avoiding one while behind, camel-majority
    // swings, selling before a known opponent threat drains a pile).
    id: 'hard2',
    label: 'Hard',
    tagline: 'No peeking. Reads the odds. Genuinely tough.',
    pickerOrder: 3,
    retired: false,
    family: 'hard',
  },
  {
    // Engine: ismctsBot (src/ai/ismctsBot.ts, via ismctsWorker). Information-
    // Set Monte Carlo Tree Search — same FAIR determinization contract as
    // hardAi2 (never reads the true hidden hand or deck order), but searches
    // via repeated determinized playouts instead of depth-bounded alpha-beta.
    // Shipped ALONGSIDE hardAi2 ("Hard") as its own A/B tier per the
    // 2026-07-21 lineup addition, after passing its benchmark gate (90% vs
    // hardAi2 head-to-head) and its fairness proof. hardAi2 is untouched.
    id: 'ismcts',
    label: 'Hard (ISMCTS)',
    tagline: 'Imagines every hand you could hold. Fair — and furious.',
    pickerOrder: 4,
    retired: false,
    family: 'hard',
  },
  {
    // Engine: hardAi3 (src/ai/hardAi3.ts, via aiWorker3). Reads the opponent's
    // hand and the deck order — omniscient search. Named honestly instead of
    // hidden behind a disclaimer.
    id: 'hard3',
    label: 'Omniscient Bot',
    tagline: 'It can see your hand. It can see the deck. Beat it anyway.',
    pickerOrder: 5,
    retired: false,
  },
  {
    // Retired 2026-07-18 lineup rework: the original MCTS "Hard" (hardAi.ts /
    // aiWorker.ts). Left out of the picker in favor of fairBot ("Hard") and
    // hardAi3 ("Omniscient Bot"). Code and worker untouched.
    id: 'hard',
    label: 'Hard (Classic)',
    tagline: '',
    pickerOrder: null,
    retired: true,
    // DEMOTED to the medium family 2026-07-21 (Vijay's call, data-backed):
    // benchmarked only 70% vs Medium — the real hard family (hard2/ismcts)
    // runs ~100%. It keeps its historical label; it just files under Medium.
    family: 'medium',
  },
  {
    // Retired 2026-07-20 lineup rework: fairBot (src/ai/fairBot.ts, via
    // fairBotWorker) — the "Hard" from the 2026-07-18 rework — was replaced
    // as the active "Hard" by hardAi2 (see above): fairBot was fair but slow
    // (7-12s think time) and measurably weaker head-to-head (~18% win rate
    // vs hardAi2 pre-fix). Code and worker untouched, just off the picker.
    id: 'fair',
    label: 'Hard (FairBot, Classic)',
    tagline: '',
    pickerOrder: null,
    retired: true,
    // DEMOTED to the medium family 2026-07-21 (Vijay's call, data-backed):
    // benchmarked only 73% vs Medium. Label keeps its history; placement
    // tells the truth.
    family: 'medium',
  },
]

const TIERS_BY_ID: Record<string, Tier> = Object.fromEntries(TIERS.map((t) => [t.id, t]))

/** Active tiers only, sorted into picker display order. */
export const ACTIVE_TIERS: Tier[] = TIERS
  .filter((t) => !t.retired)
  .sort((a, b) => (a.pickerOrder ?? 0) - (b.pickerOrder ?? 0))

/** Look up a tier (active or retired) by id. */
export function getTier(id: string): Tier | undefined {
  return TIERS_BY_ID[id]
}

/** Look up a tier's family tag (active or retired), if any. */
export function getTierFamily(id: string): TierFamily | undefined {
  return TIERS_BY_ID[id]?.family
}

/** Every distinct `family` tag declared in TIERS, in first-seen TIERS order.
 *  Single source of truth for "which families exist" — a caller checking
 *  whether some string is a family tag (as opposed to a tier id or 'online')
 *  should check membership here rather than hardcoding 'hard'/'medium'. */
export const FAMILIES: TierFamily[] = Array.from(
  new Set(TIERS.map((t) => t.family).filter((f): f is TierFamily => f !== undefined)),
)

/** Every tier (active or retired) tagged with the given family, in TIERS'
 *  own declared order (e.g. for 'hard': hard2, ismcts, hard, fair). */
export function getFamilyMembers(family: TierFamily): Tier[] {
  return TIERS.filter((t) => t.family === family)
}

/**
 * A family's canonical/anchor member — the tier whose label and picker
 * position the family's own TOP-LEVEL leaderboard chip borrows when it's
 * collapsed (see StatsDashboard.tsx): the non-retired member with the
 * lowest `pickerOrder` (ties broken by TIERS' own declaration order via
 * Array.prototype.sort's stability). For 'hard' today that's hard2 (order 3,
 * beating ismcts's order 4) — retired members (hard/fair) are never
 * candidates. Falls back to the family's first declared member if every
 * member is somehow retired (defensive; a real family should always have at
 * least one active member).
 */
export function getFamilyPrimary(family: TierFamily): Tier {
  const members = getFamilyMembers(family)
  const active = members
    .filter((t) => !t.retired)
    .sort((a, b) => (a.pickerOrder ?? 0) - (b.pickerOrder ?? 0))
  return active[0] ?? members[0]
}

/**
 * Resolve any historical (or current) opponent_type id to a display label.
 * Falls back to the raw id for anything not in TIERS (e.g. 'online' isn't an
 * AI tier at all — callers handle that separately).
 */
export function getTierLabel(id: string): string {
  return TIERS_BY_ID[id]?.label ?? id
}

/**
 * The default picker selection must never be a retired tier. `tiers` is
 * injectable for testing; real callers use the module's own TIERS list.
 */
export function resolveDefaultTierId(preferred: TierId, tiers: Tier[] = TIERS): TierId {
  const preferredTier = tiers.find((t) => t.id === preferred)
  if (preferredTier && !preferredTier.retired) return preferred
  const medium = tiers.find((t) => t.id === 'medium' && !t.retired)
  return medium ? medium.id : preferred
}

export const DEFAULT_TIER_ID: TierId = resolveDefaultTierId('easy')

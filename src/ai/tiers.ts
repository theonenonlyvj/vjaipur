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

export type TierId = 'easy' | 'medium' | 'hard' | 'hard2' | 'hard3' | 'fair'

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
  },
  {
    // Engine: hardAi3 (src/ai/hardAi3.ts, via aiWorker3). Reads the opponent's
    // hand and the deck order — omniscient search. Named honestly instead of
    // hidden behind a disclaimer.
    id: 'hard3',
    label: 'Omniscient Bot',
    tagline: 'It can see your hand. It can see the deck. Beat it anyway.',
    pickerOrder: 4,
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

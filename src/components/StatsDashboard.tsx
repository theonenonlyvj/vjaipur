import { useState, useEffect, type CSSProperties } from 'react'
import { useStatsStore, resolveMatchGames } from '../store/statsStore'
import { leaderboard as fetchLeaderboard, myStyle as fetchMyStyle, rivalry as fetchRivalry } from '../net/online'
import type { LeaderboardResponse, MyStyleResponse, RivalryResponse } from '../net/online'
import type { TugRow, TugRowFormat } from '../shared/styleAgg'
import { TIERS, FAMILIES, getTierLabel, getTierFamily, getFamilyMembers, getFamilyPrimary, getFamilyLabel, type TierFamily } from '../ai/tiers'
import { ProfileOverlay } from './ProfileOverlay'
import { RivalryModal } from './RivalryModal'
import { closeBtnStyle, sectionHeaderStyle, closePrimaryBtnStyle, tugTrackStyle, tugClineStyle, tugPullBaseStyle } from './hallStyles'

interface StatsDashboardProps {
  onClose: () => void
}

// Every AI tier that has ever recorded a match — active AND retired — so
// historical rows (e.g. the old MCTS "Hard"/"Hard II") keep displaying under
// their own label instead of disappearing from Hall of Records. Order:
// active tiers in picker order, then retired tiers. Sourced from
// src/ai/tiers.ts, the single source of truth for tier display metadata.
const AI_TIERS = TIERS.map((t) => ({ id: t.id, label: t.label }))

const EMPTY_LEADERBOARD: LeaderboardResponse = { overall: [], verified: [] }

// The global-leaderboard TOP-LEVEL filter: 'all' (everything, the original
// Overall/Verified board), 'online', a standalone tier id, or a FAMILY tag
// (src/ai/tiers.ts's TierFamily — e.g. 'hard' collapses hard2/ismcts/hard/
// fair under one "Hard" chip once 2+ of them have data; see
// buildOpponentGroups below). Kept as a plain string (not a union) for the
// same reason as before: the tier-id set legitimately grows/retires over
// time and this only ever round-trips through the worker (or, for a family,
// resolves locally via tiers.ts), never branches on a specific id here.
const ALL_OPPONENTS = 'all'

/** Same order the tier picker/Hall-of-Records "vs AI" table already uses
 *  (TIERS' own array order: active tiers in picker order, then retired) —
 *  so the leaderboard toggle lines up with every other tier listing in the
 *  app instead of following the server's unordered `SELECT DISTINCT`. */
const TIER_ORDER: string[] = TIERS.map((t) => t.id)

/** 'online' isn't a tier (getTierLabel would just echo it back unresolved),
 *  so it gets its own explicit label; everything else is a tier id resolved
 *  via tiers.ts (the single source of truth, including retired tiers — e.g.
 *  'fair' -> "Hard (FairBot, Classic)", 'hard' -> "Hard (Classic)"). */
function opponentLabel(id: string): string {
  return id === 'online' ? 'Online' : getTierLabel(id)
}

// ── Family grouping (2026-07-25 "Hard" drill-down) ──────────────────────────
//
// A top-row entry is either a plain opponent_type (a standalone tier, or
// 'online') or a COLLAPSED family: 2+ of that family's tiers.ts members have
// recorded data, so they fold into one chip — labeled and positioned after
// the family's canonical member (see getFamilyPrimary in ai/tiers.ts) —
// instead of cluttering the top row with every member separately. A family
// with 0 or 1 data-bearing members is indistinguishable from a plain
// standalone tier (isFamily: false) — there's nothing to drill into.
interface OpponentGroup {
  /** 'online' | a standalone tier id | a family tag (ai/tiers.ts's
   *  TierFamily) — whichever this entry represents; also the value passed
   *  to selectOpponentFilter/stored in `opponentFilter` when clicked. */
  key: string
  label: string
  isFamily: boolean
  /** For an isFamily group: every family member that actually has data
   *  (from tiers.ts, in TIERS order) — the drill-down row's member chips.
   *  For a non-family group this is just `[key]` (unused by rendering). */
  members: string[]
}

/** Build the leaderboard's top-row tier/family entries (everything except
 *  'all' and 'online', which the caller renders separately) from the
 *  worker's `availableOpponents` — purely a function of tiers.ts + which ids
 *  have data, never a hardcoded id list. */
function buildOpponentGroups(availableOpponents: string[]): OpponentGroup[] {
  const tierIds = availableOpponents.filter((id) => id !== 'online')
  const seenFamilies = new Set<TierFamily>()
  const groups: OpponentGroup[] = []

  for (const id of tierIds) {
    const family = getTierFamily(id)
    if (!family) {
      groups.push({ key: id, label: opponentLabel(id), isFamily: false, members: [id] })
      continue
    }
    if (seenFamilies.has(family)) continue // already handled via an earlier member
    seenFamilies.add(family)
    const dataMembers = getFamilyMembers(family)
      .map((t) => t.id)
      .filter((memberId) => tierIds.includes(memberId))
    if (dataMembers.length >= 2) {
      groups.push({ key: family, label: getFamilyLabel(family), isFamily: true, members: dataMembers })
    } else {
      // Only one member of this family has data — behaves exactly like a
      // flat standalone chip for THAT member (nothing to drill into).
      const soleId = dataMembers[0]
      groups.push({ key: soleId, label: opponentLabel(soleId), isFamily: false, members: [soleId] })
    }
  }

  // Order by each entry's REPRESENTATIVE tier's TIER_ORDER position (a
  // family's representative is its canonical/primary member) so a collapsed
  // "Hard" lands exactly where hardAi2 always has.
  return groups.sort((a, b) => {
    const aRep = a.isFamily ? getFamilyPrimary(a.key as TierFamily).id : a.key
    const bRep = b.isFamily ? getFamilyPrimary(b.key as TierFamily).id : b.key
    return TIER_ORDER.indexOf(aRep) - TIER_ORDER.indexOf(bRep)
  })
}

/** What to pass to `leaderboard()` for a given top-level filter plus (when
 *  that filter is a family) drill-down selection. `drillMember: null` means
 *  "All <Family>" — the family's FULL tiers.ts member roster, not just the
 *  data-bearing ones (an extra id with zero matches costs nothing server-
 *  side, and this way the aggregate list is a pure function of tiers.ts,
 *  never of the fetched `availableOpponents`). */
function fetchArgFor(filter: string, drillMember: string | null): string | string[] | undefined {
  if (filter === ALL_OPPONENTS) return undefined
  if ((FAMILIES as string[]).includes(filter)) {
    return drillMember ?? getFamilyMembers(filter as TierFamily).map((t) => t.id)
  }
  return filter
}

function winPct(wins: number, games: number) {
  return games > 0 ? ((wins / games) * 100).toFixed(0) + '%' : '—'
}

function deltaColor(d: number) {
  return d > 0 ? '#60ff60' : d < 0 ? '#ff6060' : '#888'
}

function fmtDelta(d: number) {
  const s = d.toFixed(1)
  return d > 0 ? `+${s}` : s
}

function fmtWinRate(rate: number) {
  return `${Math.round(rate * 100)}%`
}

// ── MY STYLE (You vs the Bot) ────────────────────────────────────────────
//
// Server-side lazy + incrementally cached (worker/src/do/style.ts) — this
// tab's job is to never call fetchMyStyle until it's actually opened, and to
// only ever fetch once per tier per session (styleCache below), never on
// mount and never speculatively for a tier the player hasn't picked.

/** Below this many logged (preState-joined) games for a tier, the style read
 *  isn't statistically meaningful yet — show the placeholder instead. */
const MIN_STYLE_GAMES = 5

/** Design council item 5: the hero's win% is only bolded/shown once the
 *  record has enough games to mean something — below this, the W-L count
 *  alone is shown (still always present). */
const MIN_HERO_WINPCT_GAMES = 15

/** Design council item 4: the whole trajectory ("game shape") section is
 *  gated on having at least this many WINS and this many LOSSES for the
 *  selected tier — a lopsided or tiny record produces a misleading shape. */
const MIN_TRAJECTORY_GAMES_PER_OUTCOME = 10

/** The tab's opening tier, computed PURELY from data already loaded locally
 *  (statsStore's own `matches` — no network round-trip needed to pick a
 *  reasonable starting point): the vs-AI opponent_type with the most local
 *  match rows. Returns null when the player has no vs-AI matches at all
 *  (nothing to default to — the tab shows its own empty state instead of
 *  fetching anything). */
function computeDefaultStyleTier(matches: { opponent_type: string }[]): string | null {
  const counts = new Map<string, number>()
  for (const m of matches) {
    if (m.opponent_type === 'online') continue
    counts.set(m.opponent_type, (counts.get(m.opponent_type) ?? 0) + 1)
  }
  let best: string | null = null
  let bestCount = 0
  for (const [tier, count] of counts) {
    if (count > bestCount) {
      best = tier
      bestCount = count
    }
  }
  return best
}

function fmtStyleValue(v: number, format: TugRowFormat): string {
  if (format === 'percent') return `${v.toFixed(0)}%`
  return v.toFixed(2)
}

/** Bar width (0..45, leaving margin so it never overflows its half of the
 *  track) for a tug-of-war row's pull — magnitude only, direction comes from
 *  which side of the track it's anchored to. */
function tugBarWidth(row: TugRow): number {
  return Math.min(45, row.gapPct)
}

/** Design council item 11: "tier label spells it out once" — a short,
 *  hand-authored plain-language tag per tier id, appended to the tier's own
 *  label ONLY at the hero subtitle (the tier PICKER buttons keep the plain
 *  getTierLabel text — see the render below). Purely descriptive UI copy
 *  (not a numeric claim), so it's fine to author directly rather than reuse
 *  ai/tiers.ts's longer marketing `tagline`. Falls back to no tag for any
 *  tier id not listed (never throws on an unrecognized/future id). */
const TIER_PLAIN_TAG: Record<string, string> = {
  easy: 'a relaxed intro',
  medium: 'a solid club player',
  hard2: 'reads the odds, no peeking',
  ismcts: 'the fair bot — imagines every hand',
  hard3: 'sees your hand and the deck',
  hard: 'the original hard bot',
  fair: 'the original fair bot',
}

function tierPlainLabel(tier: string): string {
  const tag = TIER_PLAIN_TAG[tier]
  return tag ? `${getTierLabel(tier)} — ${tag}` : getTierLabel(tier)
}

/** Design council item 5's reassurance line ("Hard bots are built to beat
 *  most players — losing here is the point") only makes sense against a
 *  genuinely hard opponent — showing it under an Easy/Medium record would be
 *  a non-sequitur. Reuses ai/tiers.ts's family tag (hard2/ismcts/hard/fair
 *  are all `family:'hard'`) plus hard3 (Omniscient Bot, undefeated-by-design
 *  and family-less in tiers.ts). */
function isHardTier(tier: string): boolean {
  return getTierFamily(tier) === 'hard' || tier === 'hard3'
}

/** Design council item 4: both trajectory sparkline columns share ONE scale
 *  (the max |mean| across every phase of BOTH wins and losses) so a "surge"
 *  in one column is visually comparable to a "drift" in the other, instead
 *  of each column silently rescaling itself to its own max. */
function sparkScale(wins: { mean: number }[], losses: { mean: number }[]): number {
  const allMeans = [...wins, ...losses].map((p) => Math.abs(p.mean))
  return Math.max(1, ...allMeans)
}

export function StatsDashboard({ onClose }: StatsDashboardProps) {
  const matches = useStatsStore((state) => state.matches)
  const pendingReports = useStatsStore((state) => state.pendingReports)
  const lastSyncError = useStatsStore((state) => state.lastSyncError)
  const sessionExpired = useStatsStore((state) => state.sessionExpired)
  const [syncing, setSyncing] = useState(false)
  const [showProfile, setShowProfile] = useState(false)

  // ── RIVALRY modal ─────────────────────────────────────────────────────
  //
  // Click an Online Rival row -> head-to-head panel vs that opponent
  // (worker/src/do/rivalry.ts). Same lazy/on-demand contract as MY STYLE
  // (fetch ONLY on click, session-cached per opponent id so re-opening the
  // same rival never re-fetches).
  const [rivalryOpponent, setRivalryOpponent] = useState<{ id: string; name: string } | null>(null)
  const [rivalryCache, setRivalryCache] = useState<Record<string, RivalryResponse>>({})
  const [rivalryLoading, setRivalryLoading] = useState(false)
  const [rivalryError, setRivalryError] = useState('')
  // Subtle hover affordance on a clickable rival row (StatsStrip.tsx's own
  // onMouseEnter/onMouseLeave convention) — a single id, not per-row state.
  const [hoveredRivalId, setHoveredRivalId] = useState<string | null>(null)

  function openRivalry(id: string, name: string) {
    setRivalryOpponent({ id, name })
  }

  useEffect(() => {
    if (!rivalryOpponent) return
    if (rivalryCache[rivalryOpponent.id]) return // session-cached — re-opening never re-fetches
    setRivalryLoading(true)
    setRivalryError('')
    fetchRivalry(rivalryOpponent.id)
      .then((data) => setRivalryCache((prev) => ({ ...prev, [rivalryOpponent.id]: data })))
      .catch(() => setRivalryError('Could not load head-to-head — you may not have shared any games yet.'))
      .finally(() => setRivalryLoading(false))
  }, [rivalryOpponent, rivalryCache])

  // Drain the on-device pending-report queue ON DEMAND. Before this existed,
  // queued games only retried at app boot (retryPendingReports in main.tsx) —
  // invisible and never firing for a long-lived mobile tab, which is exactly
  // how 19 finished ISMCTS games sat unsynced on Vijay's phone (2026-07-21).
  async function handleSyncNow() {
    setSyncing(true)
    try {
      await useStatsStore.getState().retryPendingReports()
    } finally {
      setSyncing(false)
    }
  }
  const [view, setView] = useState<'mine' | 'global' | 'style'>('mine')
  // 'verified' = online_authoritative only (server-enforced, but NOT proof of
  // two distinct humans — worker/src/do/stats.ts's ADDENDUM T comment). Only
  // meaningful for the ALL_OPPONENTS board — a specific opponent filter shows
  // its `overall` rows directly (see opponentFilter's docstring below).
  const [lbTab, setLbTab] = useState<'overall' | 'verified'>('overall')
  // Which TOP-LEVEL bucket the global board is scoped to: ALL_OPPONENTS (the
  // original Overall/Verified board), a real opponent_type ('online' or a
  // standalone tier id), or a FAMILY tag (ai/tiers.ts's TierFamily — e.g.
  // 'hard', see buildOpponentGroups). Selecting a specific filter re-fetches
  // and re-ranks over just those matches (worker/src/do/stats.ts's
  // `?opponentType=`, single id OR comma list for a family); its rows are
  // inherently server-authoritative-or-not on their own terms, so the
  // Overall/Verified sub-tabs fold away in favor of just showing `overall`
  // (see `activeRows` below) rather than a redundant/near-empty "Verified".
  const [opponentFilter, setOpponentFilter] = useState<string>(ALL_OPPONENTS)
  // When `opponentFilter` is a family: which member to drill into, or `null`
  // for the "All <Family>" aggregate (the default every time a family is
  // freshly selected — see selectOpponentFilter). Meaningless (and ignored
  // by fetchArgFor) when `opponentFilter` isn't a family.
  const [drillMember, setDrillMember] = useState<string | null>(null)
  // The full set of opponent_types with data, as reported by the worker's
  // unfiltered call (`availableOpponents` — only that call carries it; a
  // filtered response leaves this untouched so the toggle row doesn't blink
  // away options while a specific filter is loading).
  const [availableOpponents, setAvailableOpponents] = useState<string[]>([])
  const [leaderboardData, setLeaderboardData] = useState<LeaderboardResponse>(EMPTY_LEADERBOARD)
  const [lbLoading, setLbLoading] = useState(false)
  const [lbError, setLbError] = useState('')

  /** Top-level toggle click handler: switching filters always resets the
   *  family drill-down back to its "All <Family>" default (see
   *  `drillMember`'s docstring) — selecting a DIFFERENT top-level filter
   *  hides/discards whatever drill-down selection was active. */
  function selectOpponentFilter(id: string) {
    setOpponentFilter(id)
    setDrillMember(null)
  }

  // Fetch the (already server-ranked — worker/src/do/stats.ts#getLeaderboard
  // reuses the exact same rankBySkill comparator) leaderboard when switching
  // to global view, or when the opponent filter or drill-down selection
  // changes. fetchArgFor resolves ALL_OPPONENTS/family/standalone-id purely
  // from `opponentFilter`/`drillMember` (never from `availableOpponents`),
  // so this effect doesn't need it as a dependency.
  useEffect(() => {
    if (view !== 'global') return
    setLbLoading(true)
    setLbError('')
    fetchLeaderboard(fetchArgFor(opponentFilter, drillMember))
      .then((data) => {
        setLeaderboardData(data)
        if (data.availableOpponents) setAvailableOpponents(data.availableOpponents)
      })
      .catch(() => setLbError('Could not load leaderboard.'))
      .finally(() => setLbLoading(false))
  }, [view, opponentFilter, drillMember])

  // ── MY STYLE ───────────────────────────────────────────────────────────
  //
  // The selected tier — null until the tab has been opened at least once
  // (see the effect below, which seeds it from computeDefaultStyleTier the
  // first time `view === 'style'`). Clicking a tier chip sets this directly.
  const [styleTier, setStyleTier] = useState<string | null>(null)
  // Per-tier response cache for THIS SESSION (component lifetime) — once a
  // tier's data has been fetched, re-selecting it (or re-opening the tab)
  // never re-fetches. Keyed by tier id.
  const [styleCache, setStyleCache] = useState<Record<string, MyStyleResponse>>({})
  const [styleLoading, setStyleLoading] = useState(false)
  const [styleError, setStyleError] = useState('')

  // Fetch ONLY on first activation of the tab (view === 'style') and ONLY
  // for a tier not already cached this session — this is the entire
  // enforcement of the "zero compute for a player who never opens the tab"
  // contract on the client side (the real enforcement is server-side: see
  // worker/src/do/style.ts's docstring — nothing computes there either
  // unless this exact call fires). `matches` seeds the opening tier from
  // data already loaded locally, no network round-trip required just to
  // pick a starting tier.
  useEffect(() => {
    if (view !== 'style') return
    const tier = styleTier ?? computeDefaultStyleTier(matches)
    if (!tier) return // no vs-AI matches at all locally — nothing to default to
    if (styleTier === null) {
      setStyleTier(tier)
      return // let the state update land; the next run of this effect fetches
    }
    if (styleCache[tier]) return // already have this tier's data this session
    setStyleLoading(true)
    setStyleError('')
    fetchMyStyle(tier)
      .then((data) => setStyleCache((prev) => ({ ...prev, [tier]: data })))
      .catch(() => setStyleError('Could not load your style read.'))
      .finally(() => setStyleLoading(false))
  }, [view, styleTier, styleCache, matches])

  const styleData = styleTier ? styleCache[styleTier] : undefined

  // ── MY RECORDS ─────────────────────────────────────────────────────────
  //
  // Owner's 2026-07-28 GAMES-first ruling (matches the shipped RIVALRY modal
  // precedent — worker/src/do/rivalry.ts's file header): W/L/Win%/Avg Δ below
  // are all computed on GAMES (deals/rounds), not matches (best-of-N
  // sittings). Per-record splits (`resolveMatchGames`, statsStore.ts) are
  // exact when a MatchRecord carries one — every vs-ai match reported from
  // now on (gameStore.ts's nextRound), or ANY record pulled via
  // pullVGamesHistory (the worker always resolves a split for history rows)
  // — and fall back to "1 game by won" for a legacy locally-persisted record
  // with no split. Avg Δ's numerator (a match's whole net score) is exact
  // regardless; dividing by GAMES rather than MATCHES turns it into a true
  // per-game average once a match can span more than one game.
  const aiStats = AI_TIERS.map((tier) => {
    const ms = matches.filter((m) => m.opponent_type === tier.id)
    let wins = 0
    let losses = 0
    for (const m of ms) {
      const split = resolveMatchGames(m)
      wins += split.gamesWon
      losses += split.gamesLost
    }
    const games = wins + losses
    const totalDelta = ms.reduce((acc, m) => acc + (m.player_score - m.opponent_score), 0)
    return { label: tier.label, games, wins, losses, totalDelta }
  })

  const onlineMatches = matches.filter((m) => m.opponent_type === 'online')
  // Keyed by opponent_id (unchanged — the account UUID is still the only
  // stable join key), but now also carries the first non-null opponent_name
  // seen for that id (worker/src/do/stats.ts#getHistory's `players` LEFT
  // JOIN, threaded through statsStore's pullVGamesHistory) so the table can
  // render a real name instead of the raw UUID (2026-07-27 fix — "Online
  // Rivals" was showing e.g. "a1b2c3d4-..." for every rival). GAMES are now
  // primary (wins/losses below); MATCHES are tracked alongside as secondary
  // context (matchWins/matchLosses — rendered as a muted "m NW-NL" line,
  // same idiom as the GLOBAL leaderboard below and the RivalryModal's
  // shipped precedent).
  const rivalMap = new Map<string, { name: string | null; wins: number; losses: number; matchWins: number; matchLosses: number; totalDelta: number }>()
  onlineMatches.forEach((m) => {
    const id = m.opponent_id || 'Unknown'
    const s = rivalMap.get(id) ?? { name: null, wins: 0, losses: 0, matchWins: 0, matchLosses: 0, totalDelta: 0 }
    if (!s.name && m.opponent_name) s.name = m.opponent_name
    if (m.won) s.matchWins++; else s.matchLosses++
    const split = resolveMatchGames(m)
    s.wins += split.gamesWon
    s.losses += split.gamesLost
    s.totalDelta += (m.player_score - m.opponent_score)
    rivalMap.set(id, s)
  })
  const rivals = Array.from(rivalMap.entries())
    .map(([id, s]) => ({
      id,
      // No resolved name (an older locally-cached match from before this
      // field existed, or a genuinely never-synced opponent): fall back to a
      // short id-derived label rather than a bare UUID. The synthetic
      // 'Unknown' id (no opponent_id at all) keeps its own plain label
      // instead of a nonsensical "Player Unknow".
      name: s.name ?? (id === 'Unknown' ? 'Unknown' : `Player ${id.slice(0, 8)}`),
      wins: s.wins,
      losses: s.losses,
      matchWins: s.matchWins,
      matchLosses: s.matchLosses,
      totalDelta: s.totalDelta,
      games: s.wins + s.losses,
    }))
    .sort((a, b) => b.games - a.games)

  // ── GLOBAL LEADERBOARD ─────────────────────────────────────────────────
  // The worker aggregates by account_id (never display_name) and ranks with
  // the SAME rankBySkill comparator this app used to apply client-side
  // (worker/src/do/stats.ts#getLeaderboard reuses src/components/
  // leaderboardRank.ts directly) — these rows arrive already ranked.
  // ALL_OPPONENTS keeps the original Overall/Verified choice; a specific
  // opponent filter always shows `overall` (its own definition of "verified"
  // folds in per the opponentFilter state docstring above).
  const activeRows = opponentFilter === ALL_OPPONENTS ? leaderboardData[lbTab] : leaderboardData.overall
  // Top-row entries: standalone tiers/families with data, already server-
  // filtered to only non-empty buckets (see getAvailableOpponentTypes) and
  // ordered per TIER_ORDER — see buildOpponentGroups's docstring.
  const opponentGroups = buildOpponentGroups(availableOpponents)
  // The currently-selected group, if `opponentFilter` names one — drives
  // whether the secondary drill-down row renders at all (only for a
  // collapsed family; a standalone tier/'online'/'all' never has one).
  const selectedGroup = opponentGroups.find((g) => g.key === opponentFilter)
  const showDrillDown = selectedGroup?.isFamily ?? false

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, color: '#f0c030', letterSpacing: 2, fontSize: 22, fontWeight: 900 }}>HALL OF RECORDS</h2>
          <button onClick={onClose} style={closeBtnStyle}>✕</button>
        </div>

        {/* View toggle */}
        <div style={viewToggleStyle}>
          <button onClick={() => setView('mine')} style={view === 'mine' ? activeViewBtnStyle : viewBtnStyle}>MY RECORDS</button>
          <button onClick={() => setView('global')} style={view === 'global' ? activeViewBtnStyle : viewBtnStyle}>GLOBAL</button>
          <button onClick={() => setView('style')} style={view === 'style' ? activeViewBtnStyle : viewBtnStyle}>MY STYLE</button>
        </div>

        {/* ── MY RECORDS ── */}
        {view === 'mine' && (
          <>
            {pendingReports.length > 0 && (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                background: '#3a2a00', border: '1px solid #f0c030', borderRadius: 8,
                padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#f0c030',
              }}>
                <span>
                  ⚠ {pendingReports.length} finished game{pendingReports.length === 1 ? '' : 's'} not yet
                  synced to the server — they count here but not on the Global board yet.
                  {lastSyncError && (
                    <span style={{ display: 'block', color: '#ff8080', marginTop: 4 }}>
                      Last sync failed: {lastSyncError}
                    </span>
                  )}
                </span>
                {sessionExpired ? (
                  // Sync Now cannot succeed until login happens first —
                  // offering it here is a dead-end retry loop, so the CTA
                  // becomes Log In instead (same visual weight as Sync now).
                  <button
                    onClick={() => setShowProfile(true)}
                    style={{
                      background: '#f0c030', color: '#000', border: 'none', borderRadius: 6,
                      padding: '6px 14px', fontWeight: 900, cursor: 'pointer', whiteSpace: 'nowrap',
                    }}
                  >
                    Log In
                  </button>
                ) : (
                  <button
                    onClick={handleSyncNow}
                    disabled={syncing}
                    style={{
                      background: '#f0c030', color: '#000', border: 'none', borderRadius: 6,
                      padding: '6px 14px', fontWeight: 900, cursor: syncing ? 'wait' : 'pointer',
                      whiteSpace: 'nowrap', opacity: syncing ? 0.6 : 1,
                    }}
                  >
                    {syncing ? 'Syncing…' : 'Sync now'}
                  </button>
                )}
              </div>
            )}
            <section style={{ marginBottom: 28 }}>
              <h3 style={sectionHeaderStyle}>VS ARTIFICIAL INTELLIGENCE</h3>
              <div style={unitCaptionStyle}>W-L-Win %-Avg Δ are all counted by GAMES played, not matches.</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={tableStyle}>
                  <thead>
                    <tr style={tableHeaderRowStyle}>
                      <th style={thStyle}>Difficulty</th>
                      <th style={thStyle}>W</th>
                      <th style={thStyle}>L</th>
                      <th style={thStyle}>Win %</th>
                      <th style={thStyle}>Avg Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aiStats.map((s) => (
                      <tr key={s.label} style={trStyle}>
                        <td style={{ ...tdStyle, fontWeight: 700 }}>{s.label}</td>
                        <td style={tdStyle}>{s.wins}</td>
                        <td style={tdStyle}>{s.losses}</td>
                        <td style={tdStyle}>{winPct(s.wins, s.games)}</td>
                        <td style={{ ...tdStyle, fontWeight: 700, color: deltaColor(s.games > 0 ? s.totalDelta / s.games : 0) }}>
                          {s.games > 0 ? fmtDelta(s.totalDelta / s.games) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h3 style={sectionHeaderStyle}>ONLINE RIVALS</h3>
              {rivals.length === 0 ? (
                <div style={{ color: '#666', fontStyle: 'italic', textAlign: 'center', padding: '20px 0' }}>
                  No online games yet.
                </div>
              ) : (
                <>
                <div style={unitCaptionStyle}>W-L-Win %-Avg Δ are GAMES; the muted "m W-L" line under each name is matches.</div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={tableStyle}>
                    <thead>
                      <tr style={tableHeaderRowStyle}>
                        <th style={thStyle}>Rival</th>
                        <th style={thStyle}>W</th>
                        <th style={thStyle}>L</th>
                        <th style={thStyle}>Win %</th>
                        <th style={thStyle}>Avg Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rivals.map((r) => (
                        <tr
                          key={r.id}
                          style={{
                            ...trStyle,
                            cursor: 'pointer',
                            background: hoveredRivalId === r.id ? 'rgba(240,192,48,.06)' : undefined,
                          }}
                          onClick={() => openRivalry(r.id, r.name)}
                          onMouseEnter={() => setHoveredRivalId(r.id)}
                          onMouseLeave={() => setHoveredRivalId((prev) => (prev === r.id ? null : prev))}
                        >
                          <td style={{ ...tdStyle, fontSize: 12 }}>
                            {r.name}
                          </td>
                          <td style={tdStyle}>{r.wins}</td>
                          <td style={tdStyle}>{r.losses}</td>
                          <td style={tdStyle}>{winPct(r.wins, r.games)}</td>
                          <td style={{ ...tdStyle, fontWeight: 700, color: deltaColor(r.games > 0 ? r.totalDelta / r.games : 0) }}>
                            {r.games > 0 ? fmtDelta(r.totalDelta / r.games) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                </>
              )}
            </section>
          </>
        )}

        {/* ── GLOBAL ── */}
        {view === 'global' && (
          <>
            {/* Top-level opponent filter: All, then every standalone tier or
                collapsed family that actually has data (empty buckets never
                appear here — see getAvailableOpponentTypes/
                buildOpponentGroups), then Online last if present. Stays put
                across a filter change (not gated on lbLoading) so re-fetches
                don't make it flicker. */}
            <div style={opponentToggleRowStyle}>
              <button
                onClick={() => selectOpponentFilter(ALL_OPPONENTS)}
                style={opponentFilter === ALL_OPPONENTS ? activeOpponentToggleBtnStyle : opponentToggleBtnStyle}
              >
                All
              </button>
              {opponentGroups.map((g) => (
                <button
                  key={g.key}
                  onClick={() => selectOpponentFilter(g.key)}
                  style={opponentFilter === g.key ? activeOpponentToggleBtnStyle : opponentToggleBtnStyle}
                >
                  {g.label}
                </button>
              ))}
              {availableOpponents.includes('online') && (
                <button
                  onClick={() => selectOpponentFilter('online')}
                  style={opponentFilter === 'online' ? activeOpponentToggleBtnStyle : opponentToggleBtnStyle}
                >
                  Online
                </button>
              )}
            </div>

            {/* Secondary drill-down row — only when the top-level selection
                is a collapsed FAMILY (see OpponentGroup.isFamily). "All
                <Family>" (the aggregate across every declared member, incl.
                ones with no data — see fetchArgFor) is the default; each
                remaining chip is one data-bearing member, labeled via
                getTierLabel (ai/tiers.ts's single source of truth, e.g.
                "Hard (Classic)"/"Hard (FairBot, Classic)" for retired
                members). Switching the TOP-level filter away hides this row
                entirely (selectedGroup no longer matches). */}
            {showDrillDown && selectedGroup && (
              <div style={opponentToggleRowStyle}>
                <button
                  onClick={() => setDrillMember(null)}
                  style={drillMember === null ? activeOpponentToggleBtnStyle : opponentToggleBtnStyle}
                >
                  All {selectedGroup.label}
                </button>
                {selectedGroup.members.map((id) => (
                  <button
                    key={id}
                    onClick={() => setDrillMember(id)}
                    style={drillMember === id ? activeOpponentToggleBtnStyle : opponentToggleBtnStyle}
                  >
                    {getTierLabel(id)}
                  </button>
                ))}
              </div>
            )}

            {lbLoading && (
              <div style={{ color: '#888', textAlign: 'center', padding: '40px 0', fontStyle: 'italic' }}>
                Loading leaderboard…
              </div>
            )}
            {lbError && (
              <div style={{ color: '#ff6060', textAlign: 'center', padding: '20px 0' }}>{lbError}</div>
            )}
            {!lbLoading && !lbError && (
              <>
                {/* Overall (every recorded source) vs Verified (server-authoritative
                    online matches only — see LeaderboardResponse.verified).
                    Only meaningful for the ALL_OPPONENTS board — a specific
                    opponent filter shows `overall` directly (see
                    opponentFilter's docstring). */}
                {opponentFilter === ALL_OPPONENTS && (
                  <div style={subTabRowStyle}>
                    <button
                      onClick={() => setLbTab('overall')}
                      style={lbTab === 'overall' ? activeSubTabStyle : subTabStyle}
                    >
                      Overall
                    </button>
                    <button
                      onClick={() => setLbTab('verified')}
                      style={lbTab === 'verified' ? activeSubTabStyle : subTabStyle}
                    >
                      Verified Online
                    </button>
                  </div>
                )}

                {activeRows.length === 0 ? (
                  <div style={{ color: '#666', fontStyle: 'italic', textAlign: 'center', padding: '24px 0' }}>
                    No data for this category yet.
                  </div>
                ) : (
                  <>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={tableStyle}>
                      <thead>
                        <tr style={tableHeaderRowStyle}>
                          <th style={{ ...thStyle, width: 28 }}>#</th>
                          <th style={thStyle}>Player</th>
                          <th style={thStyle}>W</th>
                          <th style={thStyle}>L</th>
                          <th style={thStyle}>Win %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeRows.map((r, i) => {
                          const totalGames = r.gamesWon + r.gamesLost
                          const gamesWinRate = totalGames > 0 ? r.gamesWon / totalGames : 0
                          return (
                            <tr key={r.accountId} style={trStyle}>
                              <td style={{ ...tdStyle, color: '#666', fontSize: 11 }}>{i + 1}</td>
                              <td style={{ ...tdStyle, fontWeight: 700, color: '#f0c030' }}>
                                {r.displayName}
                              </td>
                              <td style={tdStyle}>{r.gamesWon}</td>
                              <td style={tdStyle}>{r.gamesLost}</td>
                              <td style={tdStyle}>{fmtWinRate(gamesWinRate)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  </>
                )}
              </>
            )}
          </>
        )}

        {/* ── MY STYLE ── */}
        {view === 'style' && (
          <>
            {!styleTier && (
              <div style={{ color: '#666', fontStyle: 'italic', textAlign: 'center', padding: '40px 0' }}>
                Play a few games against any AI to unlock your style read.
              </div>
            )}

            {styleTier && (
              <>
                {styleData && styleData.availableTiers.length > 1 && (
                  <div style={opponentToggleRowStyle}>
                    {styleData.availableTiers.map((t) => (
                      <button
                        key={t.tier}
                        onClick={() => setStyleTier(t.tier)}
                        style={styleTier === t.tier ? activeOpponentToggleBtnStyle : opponentToggleBtnStyle}
                      >
                        {getTierLabel(t.tier)}
                      </button>
                    ))}
                  </div>
                )}

                {styleLoading && !styleData && (
                  <div style={{ color: '#888', textAlign: 'center', padding: '40px 0', fontStyle: 'italic' }}>
                    Loading your style read…
                  </div>
                )}
                {styleError && !styleData && (
                  <div style={{ color: '#ff6060', textAlign: 'center', padding: '20px 0' }}>{styleError}</div>
                )}

                {styleData && styleData.games < MIN_STYLE_GAMES && (
                  <div style={{ color: '#666', fontStyle: 'italic', textAlign: 'center', padding: '24px 0' }}>
                    Play {MIN_STYLE_GAMES - styleData.games} more games vs {getTierLabel(styleTier)} to unlock your style read.
                  </div>
                )}

                {styleData && styleData.games >= MIN_STYLE_GAMES && (
                  <>
                    {/* ── Hero: W-L ALWAYS shown; win% only bolded once the
                        record has enough games to mean anything (design
                        council item 5) — neutral cream, never red/danger
                        styling. Reassurance line only against a genuinely
                        hard tier. */}
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
                      <span style={{ fontSize: 26, fontWeight: 900, color: '#f0e8d8' }}>
                        {styleData.style.wins}W – {styleData.style.losses}L
                      </span>
                      {styleData.style.games >= MIN_HERO_WINPCT_GAMES && (
                        <span style={{ fontSize: 14, color: '#cbbf9a', fontWeight: 800 }}>
                          {Math.round(styleData.style.winPct)}%
                        </span>
                      )}
                    </div>
                    <div style={{ color: '#997', fontSize: 11.5, marginBottom: 4 }}>
                      vs {tierPlainLabel(styleTier)} · {styleData.style.games} analyzed games
                    </div>
                    {isHardTier(styleTier) && (
                      <div style={{ color: '#776', fontSize: 11, fontStyle: 'italic', marginBottom: 14 }}>
                        Hard bots are built to beat most players — losing here is the point.
                      </div>
                    )}

                    {/* ── Coaching card moves UP, directly under the hero
                        (design council item 9) — the tug-of-war rows below
                        are its receipts, not the headline. */}
                    <h3 style={sectionHeaderStyle}>ONE THING TO WATCH</h3>
                    <div style={coachCardStyle}>{styleData.style.coaching}</div>

                    <h3 style={{ ...sectionHeaderStyle, marginTop: 22 }}>YOU vs THE BOT <span style={{ color: '#665', fontWeight: 700 }}>— the receipts</span></h3>
                    <div>
                      {styleData.style.rows.map((row: TugRow) => (
                        <div key={row.id} style={{ marginBottom: 13, opacity: row.eligible ? 1 : 0.5 }}>
                          <div style={{ fontSize: 12, color: '#dcd0b8', marginBottom: 2 }}>
                            {row.label}
                            {row.tag === 'gap' && <span style={tugTagStyle}>BIGGEST GAP</span>}
                          </div>
                          {row.sublabel && (
                            <div style={{ fontSize: 10, color: '#776', marginBottom: 4, fontStyle: 'italic' }}>{row.sublabel}</div>
                          )}
                          <div style={tugTrackStyle}>
                            <div style={tugClineStyle} />
                            {row.side !== 'even' && (
                              <div
                                style={
                                  row.side === 'human'
                                    ? { ...tugPullBaseStyle, left: '50%', width: `${tugBarWidth(row)}%`, background: 'linear-gradient(90deg, #b8860b, #f0c030)' }
                                    : { ...tugPullBaseStyle, right: '50%', width: `${tugBarWidth(row)}%`, background: 'linear-gradient(270deg, #4a3a6a, #7a68a8)' }
                                }
                              />
                            )}
                          </div>
                          <div style={{ fontSize: 10.5, color: '#997', marginTop: 3 }}>
                            {row.dead ? (
                              'dead even — this is NOT your problem'
                            ) : (
                              <>
                                {fmtStyleValue(row.human, row.format)} vs <b style={{ color: '#f0e8d8' }}>{fmtStyleValue(row.ai, row.format)}</b>
                                {' · '}{row.side === 'human' ? 'you' : 'bot'} +{Math.round(row.gapPct)}
                                {row.gapKind === 'points' ? ' pts' : '%'}
                              </>
                            )}
                          </div>
                          {row.subCaption && (
                            <div style={{ fontSize: 10, color: '#776', marginTop: 2 }}>{row.subCaption}</div>
                          )}
                          {!row.eligible && (
                            <div style={{ fontSize: 10, color: '#776', marginTop: 2, fontStyle: 'italic' }}>{row.sampleNote}</div>
                          )}
                        </div>
                      ))}
                      {styleData.style.notes.map((note) => (
                        <div key={note} style={{ fontSize: 11, color: '#776', fontStyle: 'italic', marginBottom: 10 }}>{note}</div>
                      ))}
                    </div>

                    <h3 style={sectionHeaderStyle}>YOUR SIGNATURES</h3>
                    <div style={{ marginBottom: 8 }}>
                      {styleData.style.signatures.cherryPicker && (
                        <span style={badgeStyle}>
                          🎯 Cherry-picker — {Math.round(styleData.style.signatures.cherryPickerPct)}% of your sales are single cards
                        </span>
                      )}
                      {styleData.style.signatures.preciousTempo && (
                        <span style={badgeStyle}>
                          💎 Precious tempo — selling diamond/gold/silver at exactly 2 keeps more of the pile available later
                          (you {Math.round(styleData.style.signatures.preciousTempoHumanPct)}% / bot {Math.round(styleData.style.signatures.preciousTempoAiPct)}%)
                        </span>
                      )}
                      {styleData.style.signatures.boomPlayer && (
                        <span style={badgeStyle}>🌊 Boom player — wins surge late, losses drift late</span>
                      )}
                      {!styleData.style.signatures.cherryPicker &&
                        !styleData.style.signatures.preciousTempo &&
                        !styleData.style.signatures.boomPlayer && (
                          <span style={{ color: '#666', fontStyle: 'italic', fontSize: 12 }}>No strong signature yet — keep playing.</span>
                        )}
                    </div>

                    <h3 style={sectionHeaderStyle}>GAME SHAPE</h3>
                    {styleData.style.wins >= MIN_TRAJECTORY_GAMES_PER_OUTCOME && styleData.style.losses >= MIN_TRAJECTORY_GAMES_PER_OUTCOME ? (
                      (() => {
                        const scale = sparkScale(styleData.style.trajectoryWins, styleData.style.trajectoryLosses)
                        const renderSpark = (phases: typeof styleData.style.trajectoryWins) => (
                          <div style={sparkBarsStyle}>
                            {phases.map((p, i) => (
                              <div key={i} style={sparkBarColStyle}>
                                {/* Non-color cue (design council item 4): a
                                    +/- glyph so the sign reads even without
                                    color perception. */}
                                <span style={{ fontSize: 9, color: p.mean >= 0 ? '#40c057' : '#e05050' }}>{p.mean >= 0 ? '+' : '−'}</span>
                                <div
                                  style={{
                                    width: '100%', borderRadius: '3px 3px 0 0', minHeight: 3,
                                    height: `${Math.round((Math.abs(p.mean) / scale) * 100)}%`,
                                    background: p.mean >= 0 ? '#40c057' : '#e05050',
                                    border: p.mean >= 0 ? '1px solid #2f8a40' : '1px dashed #a83a3a',
                                  }}
                                />
                              </div>
                            ))}
                          </div>
                        )
                        return (
                          <>
                            <div style={{ display: 'flex', gap: 16, marginTop: 6 }}>
                              <div style={sparkColStyle}>
                                <div style={sparkLabelStyle}>IN YOUR WINS</div>
                                {renderSpark(styleData.style.trajectoryWins)}
                                <div style={sparkAxisStyle}><span>early</span><span>late</span></div>
                              </div>
                              <div style={sparkColStyle}>
                                <div style={sparkLabelStyle}>IN YOUR LOSSES</div>
                                {renderSpark(styleData.style.trajectoryLosses)}
                                <div style={sparkAxisStyle}><span>early</span><span>late</span></div>
                              </div>
                            </div>
                            <div style={{ fontSize: 10, color: '#776', marginTop: 6 }}>
                              n={styleData.style.wins} wins / {styleData.style.losses} losses
                            </div>
                          </>
                        )
                      })()
                    ) : (
                      <div style={{ color: '#666', fontStyle: 'italic', fontSize: 12, padding: '8px 0' }}>
                        Needs at least {MIN_TRAJECTORY_GAMES_PER_OUTCOME} wins and {MIN_TRAJECTORY_GAMES_PER_OUTCOME} losses to
                        show a reliable shape (n={styleData.style.wins} wins / {styleData.style.losses} losses so far).
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}

        <div style={{ marginTop: 28, textAlign: 'center' }}>
          <button onClick={onClose} style={closePrimaryBtnStyle}>CLOSE</button>
        </div>
      </div>
      {showProfile && <ProfileOverlay onClose={() => setShowProfile(false)} />}
      {rivalryOpponent && (
        <RivalryModal
          opponentName={rivalryOpponent.name}
          loading={rivalryLoading}
          error={rivalryError}
          data={rivalryCache[rivalryOpponent.id] ?? null}
          onClose={() => setRivalryOpponent(null)}
        />
      )}
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  background: 'rgba(0,0,0,0.85)',
  display: 'flex', justifyContent: 'center', alignItems: 'center',
  zIndex: 2000, backdropFilter: 'blur(8px)', padding: 20,
}
const modalStyle: CSSProperties = {
  background: '#1a1a1a', width: '100%', maxWidth: 560,
  maxHeight: '90vh', overflowY: 'auto',
  borderRadius: 16, border: '2px solid #f0c030',
  padding: '24px 24px 32px 24px', position: 'relative',
}
// closeBtnStyle lives in ./hallStyles — shared verbatim with RivalryModal.tsx.
const viewToggleStyle: CSSProperties = {
  display: 'flex', gap: 0, marginBottom: 20,
  border: '1.5px solid #444', borderRadius: 8, overflow: 'hidden',
}
const viewBtnStyle: CSSProperties = {
  flex: 1, padding: '8px 0', background: 'none',
  color: '#888', border: 'none', cursor: 'pointer',
  fontSize: 12, fontWeight: 700, letterSpacing: 1,
}
const activeViewBtnStyle: CSSProperties = {
  ...viewBtnStyle, background: '#f0c030', color: '#000',
}
// sectionHeaderStyle lives in ./hallStyles — shared verbatim with RivalryModal.tsx.
// Owner's 2026-07-28 GAMES-first ruling — one small italic caption per
// games-primary table, spelling out the unit ONCE per section rather than
// relabeling every "W"/"L" header cell (which stay unit-agnostic, same as
// the RivalryModal's shipped precedent).
const unitCaptionStyle: CSSProperties = {
  fontSize: 10, color: '#776', fontStyle: 'italic', marginBottom: 8,
}
// The muted "m NW-NL" (matches) secondary line under a Player/Rival name
// cell — same compact-secondary idiom in both MY RECORDS (Online Rivals) and
// GLOBAL (below), so the primary GAMES numbers never need their own column
// relabeled to fit a "matches" count too.
const subTabRowStyle: CSSProperties = {
  display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16,
}
const subTabStyle: CSSProperties = {
  padding: '4px 10px', background: 'none',
  color: '#888', border: '1px solid #333',
  borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 700,
}
const activeSubTabStyle: CSSProperties = {
  ...subTabStyle, background: '#3a2a00', color: '#f0c030', borderColor: '#f0c030',
}
// Opponent filter toggle (All / Online / per-bot) — same look as the
// Overall/Verified sub-tabs, but a single non-wrapping row that scrolls
// horizontally instead, so a full tier lineup (incl. retired tiers with
// historical data) stays compact instead of wrapping into extra rows.
const opponentToggleRowStyle: CSSProperties = {
  display: 'flex', gap: 6, marginBottom: 16,
  overflowX: 'auto', paddingBottom: 2,
}
const opponentToggleBtnStyle: CSSProperties = {
  ...subTabStyle, whiteSpace: 'nowrap', flexShrink: 0,
}
const activeOpponentToggleBtnStyle: CSSProperties = {
  ...opponentToggleBtnStyle, background: '#3a2a00', color: '#f0c030', borderColor: '#f0c030',
}
const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', minWidth: 380 }
const tableHeaderRowStyle: CSSProperties = { textAlign: 'left', borderBottom: '1px solid #333' }
const thStyle: CSSProperties = { padding: '6px 8px', color: '#666', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }
const trStyle: CSSProperties = { borderBottom: '1px solid #222' }
const tdStyle: CSSProperties = { padding: '11px 8px', color: '#ddd', fontSize: 13 }
// closePrimaryBtnStyle lives in ./hallStyles — shared verbatim with RivalryModal.tsx.

// ── MY STYLE (You vs the Bot) — Variant A tug-of-war, per
// docs/mockups/you-vs-bot-panel.html. Same gold/purple pull palette as the
// rest of the modal's #f0c030 gold; the bot's purple (#7a68a8) is new here
// (nothing else in this modal needed a second series color).
// tugTrackStyle/tugClineStyle/tugPullBaseStyle live in ./hallStyles — shared
// verbatim with RivalryModal.tsx.
// Neutral tag for "biggest gap" — deliberately ONE style for both sides (no
// red/green editorializing; see src/shared/styleAgg.ts's TugRowTag
// docstring for the "why" — the design council's item 10).
const tugTagStyle: CSSProperties = {
  fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', marginLeft: 6, color: '#cbbf9a',
}
const badgeStyle: CSSProperties = {
  display: 'inline-block', background: 'rgba(240,192,48,.12)', border: '1px solid rgba(240,192,48,.35)',
  color: '#f0c030', borderRadius: 14, padding: '3px 10px', fontSize: 11, margin: '2px 3px 2px 0',
}
const coachCardStyle: CSSProperties = {
  background: 'rgba(64,192,87,.08)', border: '1px solid rgba(64,192,87,.3)', borderRadius: 12,
  padding: '10px 12px', fontSize: 12.5, color: '#cde8cd', marginTop: 8, lineHeight: 1.45,
}
const sparkColStyle: CSSProperties = { flex: 1 }
const sparkLabelStyle: CSSProperties = { fontSize: 10.5, color: '#997', letterSpacing: 1, marginBottom: 5 }
const sparkBarsStyle: CSSProperties = { display: 'flex', alignItems: 'flex-end', gap: 4, height: 46 }
const sparkBarColStyle: CSSProperties = { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }
const sparkAxisStyle: CSSProperties = { fontSize: 9, color: '#665', display: 'flex', justifyContent: 'space-between', marginTop: 3 }

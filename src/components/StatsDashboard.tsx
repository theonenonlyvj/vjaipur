import { useState, useEffect, type CSSProperties } from 'react'
import { useStatsStore } from '../store/statsStore'
import { leaderboard as fetchLeaderboard } from '../net/online'
import type { LeaderboardResponse } from '../net/online'
import { TIERS, FAMILIES, getTierLabel, getTierFamily, getFamilyMembers, getFamilyPrimary, getFamilyLabel, type TierFamily } from '../ai/tiers'
import { ProfileOverlay } from './ProfileOverlay'

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

export function StatsDashboard({ onClose }: StatsDashboardProps) {
  const matches = useStatsStore((state) => state.matches)
  const pendingReports = useStatsStore((state) => state.pendingReports)
  const lastSyncError = useStatsStore((state) => state.lastSyncError)
  const sessionExpired = useStatsStore((state) => state.sessionExpired)
  const [syncing, setSyncing] = useState(false)
  const [showProfile, setShowProfile] = useState(false)

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
  const [view, setView] = useState<'mine' | 'global'>('mine')
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

  // ── MY RECORDS ─────────────────────────────────────────────────────────
  const aiStats = AI_TIERS.map((tier) => {
    const ms = matches.filter((m) => m.opponent_type === tier.id)
    const wins = ms.filter((m) => m.won).length
    const totalDelta = ms.reduce((acc, m) => acc + (m.player_score - m.opponent_score), 0)
    return { label: tier.label, games: ms.length, wins, losses: ms.length - wins, totalDelta }
  })

  const onlineMatches = matches.filter((m) => m.opponent_type === 'online')
  // Keyed by opponent_id (unchanged — the account UUID is still the only
  // stable join key), but now also carries the first non-null opponent_name
  // seen for that id (worker/src/do/stats.ts#getHistory's `players` LEFT
  // JOIN, threaded through statsStore's pullVGamesHistory) so the table can
  // render a real name instead of the raw UUID (2026-07-27 fix — "Online
  // Rivals" was showing e.g. "a1b2c3d4-..." for every rival).
  const rivalMap = new Map<string, { name: string | null; wins: number; losses: number; totalDelta: number }>()
  onlineMatches.forEach((m) => {
    const id = m.opponent_id || 'Unknown'
    const s = rivalMap.get(id) ?? { name: null, wins: 0, losses: 0, totalDelta: 0 }
    if (!s.name && m.opponent_name) s.name = m.opponent_name
    if (m.won) s.wins++; else s.losses++
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
                  No online matches yet.
                </div>
              ) : (
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
                        <tr key={r.id} style={trStyle}>
                          <td style={{ ...tdStyle, fontSize: 12 }}>{r.name}</td>
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
                  <div style={{ overflowX: 'auto' }}>
                    <table style={tableStyle}>
                      <thead>
                        <tr style={tableHeaderRowStyle}>
                          <th style={{ ...thStyle, width: 28 }}>#</th>
                          <th style={thStyle}>Player</th>
                          <th style={thStyle}>Games</th>
                          <th style={thStyle}>Wins</th>
                          <th style={thStyle}>Win %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeRows.map((r, i) => (
                          <tr key={r.accountId} style={trStyle}>
                            <td style={{ ...tdStyle, color: '#666', fontSize: 11 }}>{i + 1}</td>
                            <td style={{ ...tdStyle, fontWeight: 700, color: '#f0c030' }}>{r.displayName}</td>
                            <td style={tdStyle}>{r.games}</td>
                            <td style={tdStyle}>{r.wins}</td>
                            <td style={tdStyle}>{fmtWinRate(r.winRate)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
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
const closeBtnStyle: CSSProperties = {
  background: 'none', border: 'none', color: '#888',
  fontSize: 24, cursor: 'pointer', padding: 4,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
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
const sectionHeaderStyle: CSSProperties = {
  fontSize: 11, fontWeight: 900, color: '#f0c030', letterSpacing: 1.5,
  marginBottom: 12, borderBottom: '1px solid #333', paddingBottom: 6,
}
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
const closePrimaryBtnStyle: CSSProperties = {
  background: '#f0c030', color: '#000', border: 'none',
  padding: '12px 32px', borderRadius: 8, fontWeight: 900,
  cursor: 'pointer', fontSize: 14, letterSpacing: 1,
}

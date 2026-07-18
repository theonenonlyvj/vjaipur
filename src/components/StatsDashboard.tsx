import { useState, useEffect, type CSSProperties } from 'react'
import { useStatsStore } from '../store/statsStore'
import { leaderboard as fetchLeaderboard } from '../net/online'
import type { LeaderboardResponse } from '../net/online'
import { TIERS } from '../ai/tiers'

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
  const [view, setView] = useState<'mine' | 'global'>('mine')
  // 'verified' = online_authoritative only (server-enforced, but NOT proof of
  // two distinct humans — worker/src/do/stats.ts's ADDENDUM T comment).
  const [lbTab, setLbTab] = useState<'overall' | 'verified'>('overall')
  const [leaderboardData, setLeaderboardData] = useState<LeaderboardResponse>(EMPTY_LEADERBOARD)
  const [lbLoading, setLbLoading] = useState(false)
  const [lbError, setLbError] = useState('')

  // Fetch the (already server-ranked — worker/src/do/stats.ts#getLeaderboard
  // reuses the exact same rankBySkill comparator) leaderboard when switching
  // to global view.
  useEffect(() => {
    if (view !== 'global') return
    setLbLoading(true)
    setLbError('')
    fetchLeaderboard()
      .then((data) => setLeaderboardData(data))
      .catch(() => setLbError('Could not load leaderboard.'))
      .finally(() => setLbLoading(false))
  }, [view])

  // ── MY RECORDS ─────────────────────────────────────────────────────────
  const aiStats = AI_TIERS.map((tier) => {
    const ms = matches.filter((m) => m.opponent_type === tier.id)
    const wins = ms.filter((m) => m.won).length
    const totalDelta = ms.reduce((acc, m) => acc + (m.player_score - m.opponent_score), 0)
    return { label: tier.label, games: ms.length, wins, losses: ms.length - wins, totalDelta }
  })

  const onlineMatches = matches.filter((m) => m.opponent_type === 'online')
  const rivalMap = new Map<string, { wins: number; losses: number; totalDelta: number }>()
  onlineMatches.forEach((m) => {
    const id = m.opponent_id || 'Unknown'
    const s = rivalMap.get(id) ?? { wins: 0, losses: 0, totalDelta: 0 }
    if (m.won) s.wins++; else s.losses++
    s.totalDelta += (m.player_score - m.opponent_score)
    rivalMap.set(id, s)
  })
  const rivals = Array.from(rivalMap.entries())
    .map(([id, s]) => ({ id, ...s, games: s.wins + s.losses }))
    .sort((a, b) => b.games - a.games)

  // ── GLOBAL LEADERBOARD ─────────────────────────────────────────────────
  // The worker aggregates by account_id (never display_name) and ranks with
  // the SAME rankBySkill comparator this app used to apply client-side
  // (worker/src/do/stats.ts#getLeaderboard reuses src/components/
  // leaderboardRank.ts directly) — these rows arrive already ranked.
  const activeRows = leaderboardData[lbTab]

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
                          <td style={{ ...tdStyle, fontSize: 12 }}>{r.id}</td>
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
                    online matches only — see LeaderboardResponse.verified) */}
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

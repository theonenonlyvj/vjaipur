import { type CSSProperties } from 'react'
import { useStatsStore } from '../store/statsStore'

interface StatsDashboardProps {
  onClose: () => void
}

export function StatsDashboard({ onClose }: StatsDashboardProps) {
  const matches = useStatsStore((state) => state.matches)

  // Aggregate AI stats
  const aiDifficulties = [
    { id: 'easy', label: 'Easy' },
    { id: 'medium', label: 'Medium' },
    { id: 'hard', label: 'Hard' },
    { id: 'hard2', label: 'Hard II' },
    { id: 'hard3', label: 'Hard III 💀' },
  ]

  const aiStats = aiDifficulties.map((diff) => {
    const diffMatches = matches.filter((m) => m.opponent_type === diff.id)
    const wins = diffMatches.filter((m) => m.won).length
    const losses = diffMatches.length - wins
    const winRate = diffMatches.length > 0 ? (wins / diffMatches.length) * 100 : 0
    const totalDelta = diffMatches.reduce((acc, m) => acc + (m.player_score - m.opponent_score), 0)
    
    return {
      label: diff.label,
      wins,
      losses,
      winRate,
      totalDelta,
    }
  })

  // Aggregate Online stats
  const onlineMatches = matches.filter((m) => m.opponent_type === 'online')
  const rivalMap = new Map<string, { wins: number; losses: number; totalDelta: number }>()

  onlineMatches.forEach((m) => {
    const opponentId = m.opponent_id || 'Unknown'
    const current = rivalMap.get(opponentId) || { wins: 0, losses: 0, totalDelta: 0 }
    if (m.won) current.wins++
    else current.losses++
    current.totalDelta += (m.player_score - m.opponent_score)
    rivalMap.set(opponentId, current)
  })

  const rivals = Array.from(rivalMap.entries()).map(([id, stats]) => ({
    id,
    ...stats,
    winRate: (stats.wins + stats.losses) > 0 ? (stats.wins / (stats.wins + stats.losses)) * 100 : 0,
  })).sort((a, b) => (b.wins + b.losses) - (a.wins + a.losses))

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 style={{ margin: 0, color: '#f0c030', letterSpacing: 2, fontSize: 24, fontWeight: 900 }}>HALL OF RECORDS</h2>
          <button onClick={onClose} style={closeBtnStyle}>✕</button>
        </div>

        <section style={{ marginBottom: 32 }}>
          <h3 style={sectionHeaderStyle}>VS ARTIFICIAL INTELLIGENCE</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr style={tableHeaderRowStyle}>
                  <th style={thStyle}>Difficulty</th>
                  <th style={thStyle}>W</th>
                  <th style={thStyle}>L</th>
                  <th style={thStyle}>Win %</th>
                  <th style={thStyle}>Total Δ</th>
                </tr>
              </thead>
              <tbody>
                {aiStats.map((stat) => (
                  <tr key={stat.label} style={trStyle}>
                    <td style={{ ...tdStyle, fontWeight: 700 }}>{stat.label}</td>
                    <td style={tdStyle}>{stat.wins}</td>
                    <td style={tdStyle}>{stat.losses}</td>
                    <td style={tdStyle}>{stat.winRate.toFixed(0)}%</td>
                    <td style={{ ...tdStyle, fontWeight: 700, color: stat.totalDelta > 0 ? '#60ff60' : stat.totalDelta < 0 ? '#ff6060' : '#888' }}>
                      {stat.totalDelta > 0 ? `+${stat.totalDelta}` : stat.totalDelta}
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
              No online matches recorded yet.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr style={tableHeaderRowStyle}>
                    <th style={thStyle}>Rival Code</th>
                    <th style={thStyle}>W</th>
                    <th style={thStyle}>L</th>
                    <th style={thStyle}>Win %</th>
                    <th style={thStyle}>Total Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {rivals.map((rival) => (
                    <tr key={rival.id} style={trStyle}>
                      <td style={{ ...tdStyle, fontSize: 12 }}>{rival.id}</td>
                      <td style={tdStyle}>{rival.wins}</td>
                      <td style={tdStyle}>{rival.losses}</td>
                      <td style={tdStyle}>{rival.winRate.toFixed(0)}%</td>
                      <td style={{ ...tdStyle, fontWeight: 700, color: rival.totalDelta > 0 ? '#60ff60' : rival.totalDelta < 0 ? '#ff6060' : '#888' }}>
                        {rival.totalDelta > 0 ? `+${rival.totalDelta}` : rival.totalDelta}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div style={{ marginTop: 32, textAlign: 'center' }}>
          <button 
            onClick={onClose}
            style={{ 
              background: '#f0c030', 
              color: '#000', 
              border: 'none', 
              padding: '12px 32px', 
              borderRadius: 8, 
              fontWeight: 900, 
              cursor: 'pointer',
              fontSize: 14,
              letterSpacing: 1
            }}
          >
            CLOSE
          </button>
        </div>
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: 'rgba(0,0,0,0.85)',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  zIndex: 2000,
  backdropFilter: 'blur(8px)',
  padding: 20,
}

const modalStyle: CSSProperties = {
  background: '#1a1a1a',
  width: '100%',
  maxWidth: 550,
  maxHeight: '90vh',
  overflowY: 'auto',
  borderRadius: 16,
  border: '2px solid #f0c030',
  padding: '24px 24px 32px 24px',
  position: 'relative',
}

const closeBtnStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#888',
  fontSize: 24,
  cursor: 'pointer',
  padding: 4,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const sectionHeaderStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 900,
  color: '#f0c030',
  letterSpacing: 1.5,
  marginBottom: 12,
  borderBottom: '1px solid #333',
  paddingBottom: 6,
  textTransform: 'uppercase',
}

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  minWidth: 400,
}

const tableHeaderRowStyle: CSSProperties = {
  textAlign: 'left',
  borderBottom: '1px solid #333',
}

const thStyle: CSSProperties = {
  padding: '8px 8px',
  color: '#666',
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
}

const trStyle: CSSProperties = {
  borderBottom: '1px solid #222',
}

const tdStyle: CSSProperties = {
  padding: '12px 8px',
  color: '#ddd',
  fontSize: 13,
}

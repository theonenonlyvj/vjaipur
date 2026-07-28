import { type CSSProperties, useState } from 'react'
import { useStatsAggregates } from '../store/statsStore'

interface StatsStripProps {
  onClick: () => void
}

export function StatsStrip({ onClick }: StatsStripProps) {
  // Owner's 2026-07-28 GAMES-first ruling — RECORD is the most visible
  // record in the app, so it's GAMES-primary (gamesWon/gamesLost), same as
  // every other stats surface. TOTAL Δ is unchanged: it's a raw sum, already
  // game-derived by construction (see useStatsAggregates's docstring) — no
  // games-vs-matches distinction applies to a sum.
  const { gamesWon, gamesLost, totalDelta } = useStatsAggregates()
  const [isHovered, setIsHovered] = useState(false)

  return (
    <div
      style={{
        ...containerStyle,
        background: isHovered ? 'rgba(30,30,30,0.8)' : 'rgba(0,0,0,0.6)',
      }}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div style={contentStyle}>
        <div style={statGroupStyle}>
          <span style={labelStyle}>RECORD</span>
          <span style={valueStyle}>{gamesWon}W - {gamesLost}L</span>
        </div>
        
        <div style={dividerStyle} />
        
        <div style={statGroupStyle}>
          <span style={labelStyle}>TOTAL Δ</span>
          <span style={{ ...valueStyle, color: totalDelta > 0 ? '#60ff60' : totalDelta < 0 ? '#ff6060' : '#888' }}>
            {totalDelta > 0 ? `+${totalDelta}` : totalDelta}
          </span>
        </div>
      </div>
      <div style={chevronStyle}>›</div>
    </div>
  )
}

const containerStyle: CSSProperties = {
  position: 'fixed',
  bottom: 0,
  left: 0,
  right: 0,
  backdropFilter: 'blur(10px)',
  borderTop: '1px solid rgba(240, 192, 48, 0.2)',
  padding: '8px 16px',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  cursor: 'pointer',
  zIndex: 1000,
  transition: 'background 0.2s, border-top-color 0.2s',
}

const contentStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 24,
  maxWidth: 400,
  width: '100%',
  justifyContent: 'center',
}

const statGroupStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 2,
}

const labelStyle: CSSProperties = {
  fontSize: 9,
  fontWeight: 900,
  color: '#888',
  letterSpacing: 1,
}

const valueStyle: CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  color: '#fff',
}

const dividerStyle: CSSProperties = {
  width: 1,
  height: 24,
  background: 'rgba(255,255,255,0.1)',
}

const chevronStyle: CSSProperties = {
  color: '#f0c030',
  fontSize: 24,
  fontWeight: 300,
  marginLeft: 16,
  opacity: 0.5,
}

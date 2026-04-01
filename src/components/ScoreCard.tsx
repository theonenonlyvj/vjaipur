import React from 'react'
import type { PlayerState, Good } from '../engine'

interface ScoreCardProps {
  playerIndex: 0 | 1
  playerState: PlayerState
  camelWinner: 0 | 1 | null
  isWinner: boolean
  roundTotal: number
  name?: string
}

export function ScoreCard({ playerIndex, playerState, camelWinner, isWinner, roundTotal, name }: ScoreCardProps) {
  const goodsBreakdown = playerState.tokens.reduce((acc, t) => {
    if (!acc[t.good]) acc[t.good] = { count: 0, total: 0 }
    acc[t.good].count++
    acc[t.good].total += t.value
    return acc
  }, {} as Record<Good, { count: number, total: number }>)
  
  const totalGoodsPoints = playerState.tokens.reduce((s, t) => s + t.value, 0)
  
  const bonusBreakdown = playerState.bonusTokens.reduce((acc, t) => {
    acc.count++
    acc.total += t.value
    return acc
  }, { count: 0, total: 0 })
  
  const camelBonus = camelWinner === playerIndex ? 5 : 0

  const cardStyle: React.CSSProperties = {
    background: 'linear-gradient(135deg, #2a1800 0%, #1a0a00 100%)',
    border: '1px solid rgba(240, 192, 48, 0.3)',
    borderRadius: 16,
    padding: '24px 20px',
    position: 'relative',
    minWidth: 280,
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
    overflow: 'hidden',
    backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(240, 192, 48, 0.1) 0%, transparent 70%)',
  }

  const ribbonStyle: React.CSSProperties = {
    position: 'absolute',
    top: 14,
    right: -32,
    background: 'linear-gradient(to bottom, #f0c030, #d0a010)',
    color: '#000',
    padding: '4px 36px',
    transform: 'rotate(45deg)',
    fontSize: 11,
    fontWeight: 900,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    borderTop: '1px solid rgba(255,255,255,0.3)',
    borderBottom: '1px solid rgba(0,0,0,0.2)',
  }

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 13,
    color: '#d0c0b0',
  }

  return (
    <div style={cardStyle}>
      {isWinner && <div style={ribbonStyle}>Winner</div>}
      
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 4 }}>
          {name || `Player ${playerIndex + 1}`}
        </div>
        <div style={{ fontSize: 56, fontWeight: 900, color: '#f0c030', lineHeight: 1 }}>
          {roundTotal}
        </div>
        <div style={{ fontSize: 11, color: '#888', marginTop: 4, letterSpacing: 1 }}>RUPEES</div>
      </div>

      <div style={{ height: 1, background: 'linear-gradient(to right, transparent, rgba(240, 192, 48, 0.2), transparent)' }} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Goods */}
        <div>
          <div style={rowStyle}>
            <span style={{ fontWeight: 600 }}>Tokens ({playerState.tokens.length})</span>
            <span style={{ color: '#f0e8d8', fontWeight: 800 }}>{totalGoodsPoints} pts</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
             {(Object.keys(goodsBreakdown) as Good[]).map(good => (
               <div key={good} style={{ 
                 background: `var(--${good}-bg)`, 
                 padding: '3px 8px', 
                 borderRadius: 6, 
                 fontSize: 10, 
                 fontWeight: 800,
                 color: '#fff',
                 border: `1px solid rgba(255,255,255,0.2)`,
               }}>
                 {good.toUpperCase()}: {goodsBreakdown[good].count}
               </div>
             ))}
          </div>
        </div>

        {/* Bonuses */}
        <div style={rowStyle}>
          <span style={{ fontWeight: 600 }}>Bonuses ({bonusBreakdown.count})</span>
          <span style={{ color: '#f0e8d8', fontWeight: 800 }}>{bonusBreakdown.total} pts</span>
        </div>

        {/* Camels */}
        {camelBonus > 0 && (
          <div style={rowStyle}>
            <span style={{ fontWeight: 600 }}>Camel Bonus</span>
            <span style={{ color: '#60c040', fontWeight: 800 }}>+5 pts</span>
          </div>
        )}
      </div>
    </div>
  )
}

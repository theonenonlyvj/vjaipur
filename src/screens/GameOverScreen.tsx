import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import { useStatsStore } from '../store/statsStore'
import { GameScreen } from './GameScreen'

export function GameOverScreen() {
  const navigate = useNavigate()
  const { state, mode, difficulty, matchScores, opponentName, opponentFriendCode, disconnectOnline, lastMoveDescription, matchLength } = useGameStore()
  const matches = useStatsStore(s => s.matches)
  const [showBoard, setShowBoard] = useState(false)

  if (!state || state.phase !== 'game-over') return <Navigate to="/" replace />

  const sealsNeeded = Math.floor(matchLength / 2) + 1
  const winner: 0 | 1 = state.seals[0] >= sealsNeeded ? 0 : 1
  const playerIndex = mode === 'online' ? (useGameStore.getState().onlinePlayerIndex ?? 0) : 0
  
  const playerScore = matchScores[playerIndex]
  const opponentScore = matchScores[1 - playerIndex]
  const matchDelta = playerScore - opponentScore

  // Calculate all-time delta vs this specific opponent
  const opponentType = mode === 'online' ? 'online' : difficulty
  const opponentId = mode === 'online' ? opponentFriendCode : null
  
  const relevantMatches = matches.filter(m => 
    m.opponent_type === opponentType && 
    (opponentType !== 'online' || m.opponent_id === opponentId)
  )
  const allTimeDelta = relevantMatches.reduce((acc, m) => acc + (m.player_score - m.opponent_score), 0)

  function handlePlayAgain() {
    disconnectOnline()
    navigate('/')
  }

  const oppLabel = mode === 'vs-ai' ? `AI (${difficulty})` : (opponentName || 'Opponent')

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100%', gap: 20, padding: 24,
      background: 'radial-gradient(circle at 50% 50%, #1a0a00 0%, #000000 100%)',
    }}>
      <h1 style={{ fontSize: 48, fontWeight: 900, color: '#f0c030', margin: 0, textTransform: 'uppercase', letterSpacing: 4 }}>
        Game Over
      </h1>
      
      <div style={{ 
        fontSize: 32, 
        fontWeight: 900, 
        color: winner === playerIndex ? '#60c040' : '#ff4060',
        letterSpacing: 2,
        marginBottom: 8
      }}>
        {winner === playerIndex ? 'VICTORY' : 'DEFEAT'}
      </div>

      {lastMoveDescription && (
        <div style={{
          background: 'rgba(240, 192, 48, 0.05)',
          border: '1px solid rgba(240, 192, 48, 0.2)',
          borderRadius: 20,
          padding: '6px 16px',
          fontSize: 13,
          color: '#d0a860',
          fontStyle: 'italic',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <span style={{ fontSize: 10, fontStyle: 'normal', fontWeight: 900, textTransform: 'uppercase', opacity: 0.7 }}>Final Play:</span>
          {lastMoveDescription}
        </div>
      )}

      <button 
        onClick={() => setShowBoard(!showBoard)}
        style={{
          background: 'transparent',
          border: '1px solid #3a2a10',
          color: '#666',
          padding: '8px 16px',
          borderRadius: 8,
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          marginTop: 4
        }}
      >
        {showBoard ? '← Back to Stats' : 'Review Final Board'}
      </button>

      {showBoard ? (
        <div style={{ 
          width: '100%', 
          maxWidth: 600,
          height: '50vh', 
          border: '2px solid #333', 
          borderRadius: 16, 
          overflow: 'hidden',
          background: '#1a0a00'
        }}>
          <GameScreen frozen />
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 60, marginTop: 8, background: 'rgba(255,255,255,0.03)', padding: '20px 40px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.05)' }}>
            {([0, 1] as const).map(p => {
              const isPlayer = p === playerIndex
              const isWinner = p === winner
              return (
                <div key={p} style={{ textAlign: 'center', position: 'relative' }}>
                  {isWinner && (
                    <div style={{ position: 'absolute', top: -35, left: '50%', transform: 'translateX(-50%)', fontSize: 24 }}>
                      👑
                    </div>
                  )}
                  <div style={{ fontWeight: 800, color: isWinner ? '#f0c030' : '#666', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
                    {isPlayer ? 'You' : oppLabel}
                  </div>
                  <div style={{ fontSize: 32, letterSpacing: 6, margin: '8px 0', color: isWinner ? '#f0c030' : '#444' }}>
                    {'★'.repeat(state.seals[p])}{'☆'.repeat((Math.floor(matchLength / 2) + 1) - state.seals[p])}
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 900, color: isWinner ? '#f0e8d8' : '#888' }}>{matchScores[p]} <span style={{ fontSize: 12, fontWeight: 400, opacity: 0.6 }}>PTS</span></div>
                </div>
              )
            })}
          </div>

          <div style={{ 
            background: 'linear-gradient(135deg, #1a1a1a 0%, #0a0a0a 100%)', 
            padding: '20px 32px', 
            borderRadius: 16, 
            border: '1px solid rgba(240, 192, 48, 0.1)', 
            textAlign: 'center', 
            minWidth: 240
          }}>
            <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 4 }}>Match Delta</div>
            <div style={{ fontSize: 32, fontWeight: 900, color: matchDelta >= 0 ? '#60c040' : '#ff4060' }}>
              {matchDelta >= 0 ? '+' : ''}{matchDelta}
            </div>
            
            <div style={{ marginTop: 16, height: 1, background: 'rgba(255,255,255,0.05)' }} />
            
            <div style={{ marginTop: 16, fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 4 }}>All-Time vs {oppLabel}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: allTimeDelta >= 0 ? '#60c040' : '#ff4060' }}>
              {allTimeDelta >= 0 ? '+' : ''}{allTimeDelta}
            </div>
          </div>
        </>
      )}

      <button onClick={handlePlayAgain} style={{
        padding: '16px 48px', fontSize: 18, fontWeight: 900,
        background: 'linear-gradient(to bottom, #5a3a00, #3a2a00)',
        color: '#f0e8d8',
        border: '2px solid #f0c030', borderRadius: 12, cursor: 'pointer',
        marginTop: 10,
        textTransform: 'uppercase',
        letterSpacing: 1,
      }}>
        Back to Menu
      </button>
    </div>
  )
}

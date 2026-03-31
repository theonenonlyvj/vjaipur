import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import { scoreRound } from '../engine'
import { ScoreCard } from '../components/ScoreCard'
import { GameScreen } from './GameScreen'

export function RoundEndScreen() {
  const navigate = useNavigate()
  const { state, mode, nextRound, lastMoveDescription, opponentName, playerName } = useGameStore()
  const [showBoard, setShowBoard] = useState(false)

  useEffect(() => {
    if (!state) return
    if (state.phase === 'playing') navigate('/game', { replace: true })
    if (state.phase === 'game-over') navigate('/game-over', { replace: true })
  }, [state?.phase, navigate])

  if (!state || state.phase !== 'round-end') return <Navigate to="/" replace />

  const result = scoreRound(state)
  const { scores, camelWinner, sealAwardedTo } = result

  function handleContinue() {
    nextRound()
    if (mode !== 'online') {
      const next = useGameStore.getState().state
      if (next?.phase === 'game-over') {
        navigate('/game-over', { replace: true })
      } else {
        navigate('/game', { replace: true })
      }
    }
    // In online mode, navigation is triggered by the useEffect above
    // when startNextRound updates state.phase to 'playing' or 'game-over'
  }

  const myIndex = mode === 'online' ? (useGameStore.getState().onlinePlayerIndex ?? 0) : 0
  const p0Name = myIndex === 0 ? (playerName || 'Player 1') : (opponentName || 'Opponent')
  const p1Name = myIndex === 1 ? (playerName || 'Player 2') : (opponentName || 'Opponent')

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100%', gap: 20, padding: 24,
      background: 'radial-gradient(circle at 50% 50%, #2a1800 0%, #1a0a00 100%)',
    }}>
      <h2 style={{ fontSize: 32, fontWeight: 900, color: '#f0c030', margin: 0, textTransform: 'uppercase', letterSpacing: 2 }}>
        Round {state.round} Over
      </h2>

      {lastMoveDescription && (
        <div style={{
          background: 'rgba(240, 192, 48, 0.1)',
          border: '1px solid rgba(240, 192, 48, 0.3)',
          borderRadius: 20,
          padding: '6px 16px',
          fontSize: 13,
          color: '#f0c030',
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
          border: '1px solid #5a3a20',
          color: '#888',
          padding: '8px 16px',
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'all 0.2s',
        }}
      >
        {showBoard ? '← Back to Scores' : 'Review Board'}
      </button>

      {showBoard ? (
        <div style={{ 
          width: '100%', 
          maxWidth: 600,
          height: '60vh', 
          border: '2px solid #333', 
          borderRadius: 16, 
          overflow: 'hidden',
          boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
          background: '#1a0a00'
        }}>
          <GameScreen frozen />
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', justifyContent: 'center', animation: 'fadeIn 0.5s ease-out' }}>
          {([0, 1] as const).map(p => (
            <ScoreCard 
              key={p}
              playerIndex={p}
              playerState={state.players[p]}
              camelWinner={camelWinner}
              isWinner={sealAwardedTo === p}
              roundTotal={scores[p]}
              name={p === 0 ? p0Name : p1Name}
            />
          ))}
        </div>
      )}

      <button onClick={handleContinue} style={{
        marginTop: 10,
        padding: '16px 48px', fontSize: 18, fontWeight: 900,
        background: 'linear-gradient(to bottom, #305040, #203828)',
        color: '#f0e8d8',
        border: '2px solid #60c040', borderRadius: 12, cursor: 'pointer',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        textTransform: 'uppercase',
        letterSpacing: 1,
      }}>
        Continue
      </button>
      
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}

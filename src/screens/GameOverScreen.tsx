import { Navigate, useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import { useStatsStore } from '../store/statsStore'

export function GameOverScreen() {
  const navigate = useNavigate()
  const { state, mode, difficulty, matchScores, opponentName, opponentFriendCode, disconnectOnline } = useGameStore()
  const matches = useStatsStore(s => s.matches)

  if (!state || state.phase !== 'game-over') return <Navigate to="/" replace />

  const winner: 0 | 1 = state.seals[0] >= 2 ? 0 : 1
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
      justifyContent: 'center', height: '100%', gap: 24, padding: 24,
    }}>
      <h1 style={{ fontSize: 40, fontWeight: 900, color: '#f0c030', margin: 0 }}>Game Over</h1>
      
      <div style={{ fontSize: 24, fontWeight: 700, color: winner === playerIndex ? '#60c040' : '#ff4060' }}>
        {winner === playerIndex ? 'YOU WIN!' : `${oppLabel} wins`}
      </div>

      <div style={{ display: 'flex', gap: 40, marginTop: 8 }}>
        {([0, 1] as const).map(p => {
          const isPlayer = p === playerIndex
          return (
            <div key={p} style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 700, color: p === winner ? '#f0c030' : '#888', fontSize: 14 }}>
                {isPlayer ? 'YOU' : oppLabel}
              </div>
              <div style={{ fontSize: 28, letterSpacing: 4, margin: '4px 0' }}>
                {'★'.repeat(state.seals[p])}{'☆'.repeat(2 - state.seals[p])}
              </div>
              <div style={{ fontSize: 20, fontWeight: 800 }}>{matchScores[p]} pts</div>
            </div>
          )
        })}
      </div>

      <div style={{ 
        background: '#1a1a1a', padding: '16px 24px', borderRadius: 12, 
        border: '1px solid #333', textAlign: 'center', minWidth: 200 
      }}>
        <div style={{ fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>Match Delta</div>
        <div style={{ fontSize: 24, fontWeight: 900, color: matchDelta >= 0 ? '#60c040' : '#ff4060' }}>
          {matchDelta >= 0 ? '+' : ''}{matchDelta}
        </div>
        
        <div style={{ marginTop: 12, fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>All-Time vs {oppLabel}</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: allTimeDelta >= 0 ? '#60c040' : '#ff4060' }}>
          {allTimeDelta >= 0 ? '+' : ''}{allTimeDelta}
        </div>
      </div>

      <button onClick={handlePlayAgain} style={{
        padding: '14px 40px', fontSize: 18, fontWeight: 700,
        background: '#5a3a00', color: '#f0e8d8',
        border: '2px solid #f0c030', borderRadius: 8, cursor: 'pointer',
        marginTop: 8
      }}>
        Back to Menu
      </button>
    </div>
  )
}

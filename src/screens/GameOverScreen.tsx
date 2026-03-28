import { Navigate, useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'

export function GameOverScreen() {
  const navigate = useNavigate()
  const { state } = useGameStore()

  if (!state || state.phase !== 'game-over') return <Navigate to="/" replace />

  const winner: 0 | 1 = state.seals[0] >= 2 ? 0 : 1

  function handlePlayAgain() {
    navigate('/')
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100%', gap: 24, padding: 24,
    }}>
      <h1 style={{ fontSize: 40, fontWeight: 900, color: '#f0c030' }}>Game Over</h1>
      <div style={{ fontSize: 24, fontWeight: 700 }}>Player {winner + 1} wins!</div>
      <div style={{ display: 'flex', gap: 40, marginTop: 8 }}>
        {([0, 1] as const).map(p => (
          <div key={p} style={{ textAlign: 'center' }}>
            <div style={{ fontWeight: 700, color: p === winner ? '#f0c030' : '#888' }}>
              P{p + 1}
            </div>
            <div style={{ fontSize: 28, letterSpacing: 4 }}>
              {'★'.repeat(state.seals[p])}{'☆'.repeat(2 - state.seals[p])}
            </div>
          </div>
        ))}
      </div>
      <button onClick={handlePlayAgain} style={{
        padding: '14px 40px', fontSize: 18, fontWeight: 700,
        background: '#5a3a00', color: '#f0e8d8',
        border: '2px solid #f0c030', borderRadius: 8, cursor: 'pointer',
      }}>
        Play Again
      </button>
    </div>
  )
}

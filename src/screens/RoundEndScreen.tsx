import { Navigate, useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import { scoreRound } from '../engine'

export function RoundEndScreen() {
  const navigate = useNavigate()
  const { state, nextRound } = useGameStore()

  if (!state || state.phase !== 'round-end') return <Navigate to="/" replace />

  const result = scoreRound(state)
  const { scores, camelWinner, sealAwardedTo, bonusTokenCounts } = result

  function handleContinue() {
    nextRound()
    const next = useGameStore.getState().state
    if (next?.phase === 'game-over') {
      navigate('/game-over', { replace: true })
    } else {
      navigate('/game', { replace: true })
    }
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100%', gap: 24, padding: 24,
    }}>
      <h2 style={{ fontSize: 28, fontWeight: 900, color: '#f0c030' }}>Round {state.round} Over</h2>

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
        {([0, 1] as const).map(p => (
          <div key={p} style={{
            background: sealAwardedTo === p ? '#2a3020' : '#1a1000',
            border: sealAwardedTo === p ? '2px solid #60c040' : '1px solid #3a2a10',
            borderRadius: 12, padding: '20px 28px', textAlign: 'center', minWidth: 160,
          }}>
            <div style={{ fontWeight: 700, color: '#f0c030', marginBottom: 8 }}>Player {p + 1}</div>
            <div style={{ fontSize: 36, fontWeight: 900, lineHeight: 1 }}>{scores[p]}</div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>rupees</div>
            {camelWinner === p && (
              <div style={{ color: '#d0a860', fontSize: 13, marginTop: 8 }}>+5 Camel Bonus</div>
            )}
            <div style={{ color: '#c060e0', fontSize: 12, marginTop: 6 }}>
              Bonus tokens: {bonusTokenCounts[p]}
            </div>
            <div style={{ fontSize: 20, marginTop: 8 }}>
              {'★'.repeat(state.seals[p])}{'☆'.repeat(2 - state.seals[p])}
            </div>
            {sealAwardedTo === p && (
              <div style={{ color: '#60c040', fontWeight: 700, marginTop: 8 }}>Seal awarded!</div>
            )}
          </div>
        ))}
      </div>

      <button onClick={handleContinue} style={{
        padding: '14px 40px', fontSize: 18, fontWeight: 700,
        background: '#305040', color: '#f0e8d8',
        border: '2px solid #60c040', borderRadius: 8, cursor: 'pointer',
      }}>
        Continue
      </button>
    </div>
  )
}

import { useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import type { Difficulty } from '../store/gameStore'

export function HomeScreen() {
  const navigate = useNavigate()
  const { startGame, setDifficulty, startTutorial } = useGameStore()
  const [showDifficulty, setShowDifficulty] = useState(false)

  function handleDifficulty(d: Difficulty) {
    setDifficulty(d)
    startGame('vs-ai')
    navigate('/game')
  }

  function handleTutorial() {
    setDifficulty('easy')
    startTutorial()
    startGame('vs-ai')
    navigate('/game')
  }

  function handleLocal() {
    startGame('local')
    navigate('/game')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 24 }}>
      <h1 style={{ fontSize: 40, fontWeight: 900, letterSpacing: 2, color: '#f0c030' }}>VJAIPUR</h1>
      <p style={{ color: '#888', fontSize: 14 }}>First to 2 Seals of Excellence wins</p>

      {showDifficulty ? (
        <>
          <button onClick={() => handleDifficulty('easy')} style={btnStyle}>Easy</button>
          <button onClick={() => handleDifficulty('medium')} style={btnStyle}>Medium</button>
          <button onClick={() => handleDifficulty('hard')} style={btnStyle}>Hard</button>
          <button onClick={() => handleDifficulty('hard2')} style={{ ...btnStyle, borderColor: '#e06060', background: '#3a0000' }}>Hard II</button>
          <button
            onClick={() => setShowDifficulty(false)}
            style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 14 }}
          >
            Cancel
          </button>
        </>
      ) : (
        <>
          <button onClick={() => setShowDifficulty(true)} style={btnStyle}>vs AI</button>
          <button onClick={handleLocal} style={btnStyle}>Local (Pass &amp; Play)</button>
          <button onClick={() => navigate('/lobby')} style={{ ...btnStyle, borderColor: '#c060e0', background: '#2a0040' }}>
            Online
          </button>
          <button onClick={handleTutorial} style={{ ...btnStyle, background: 'none', border: '1.5px solid #888', color: '#aaa', fontSize: 15 }}>
            How to Play
          </button>
        </>
      )}
    </div>
  )
}

const btnStyle: CSSProperties = {
  padding: '14px 40px',
  fontSize: 18,
  fontWeight: 700,
  background: '#5a3a00',
  color: '#f0e8d8',
  border: '2px solid #f0c030',
  borderRadius: 8,
  cursor: 'pointer',
  letterSpacing: 1,
  minWidth: 220,
}

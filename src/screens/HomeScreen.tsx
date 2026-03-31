import { useState, useEffect, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import { useStatsStore } from '../store/statsStore'
import { socketService } from '../socket/socketService'
import { ProfileIcon } from '../components/ProfileIcon'
import { ProfileOverlay } from '../components/ProfileOverlay'
import { StatsDashboard } from '../components/StatsDashboard'
import { StatsStrip } from '../components/StatsStrip'
import type { Difficulty } from '../store/gameStore'

export function HomeScreen() {
  const navigate = useNavigate()
  const { playerName, setPlayerName, startGame, setDifficulty, startTutorial } = useGameStore()
  const [showDifficulty, setShowDifficulty] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [inputName, setInputName] = useState(playerName)
  const [isChecking, setIsChecking] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setInputName(playerName)
  }, [playerName])

  async function handleClaimName() {
    const name = inputName.trim()
    if (!name) return
    
    setIsChecking(true)
    setError('')

    const url = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001'
    socketService.connect(url)

    try {
      const { available } = await socketService.checkUsername(name)
      if (available) {
        setPlayerName(name)
      } else {
        setError('Username already taken')
      }
    } catch (e) {
      setError('Connection error')
    } finally {
      setIsChecking(false)
    }
  }

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

  const hasName = !!playerName

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 24, padding: 20 }}>
      <ProfileIcon onClick={() => setShowProfile(true)} />

      <h1 style={{ fontSize: 40, fontWeight: 900, letterSpacing: 2, color: '#f0c030', marginTop: 20 }}>VJAIPUR</h1>
      
      {!hasName ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 260 }}>
          <div style={{ color: '#eee', fontSize: 14, textAlign: 'center' }}>Choose a unique username to play:</div>
          <input
            value={inputName}
            onChange={e => setInputName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleClaimName()}
            placeholder="Username"
            maxLength={24}
            style={inputStyle}
          />
          {error && <div style={{ color: '#ff4060', fontSize: 12, textAlign: 'center' }}>{error}</div>}
          <button 
            onClick={handleClaimName} 
            disabled={isChecking || !inputName.trim()}
            style={{ ...btnStyle, fontSize: 16, padding: '10px' }}
          >
            {isChecking ? 'Checking...' : 'Claim Username'}
          </button>
        </div>
      ) : (
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#888', fontSize: 14 }}>Welcome back,</div>
          <div style={{ fontSize: 24, fontWeight: 900, color: '#fff' }}>{playerName}</div>
          <button 
            onClick={() => setPlayerName('')} 
            style={{ background: 'none', border: 'none', color: '#666', textDecoration: 'underline', fontSize: 11, cursor: 'pointer', marginTop: 4 }}
          >
            Change Name
          </button>
        </div>
      )}

      {showDifficulty ? (
        <>
          <button onClick={() => handleDifficulty('easy')} style={btnStyle}>Easy</button>
          <button onClick={() => handleDifficulty('medium')} style={btnStyle}>Medium</button>
          <button onClick={() => handleDifficulty('hard')} style={btnStyle}>Hard</button>
          <button onClick={() => handleDifficulty('hard2')} style={{ ...btnStyle, borderColor: '#e06060', background: '#3a0000' }}>Hard II</button>
          <button onClick={() => handleDifficulty('hard3')} style={{ ...btnStyle, borderColor: '#ff3030', background: '#1a0000', color: '#ff9090' }}>Hard III 💀</button>
          <button
            onClick={() => setShowDifficulty(false)}
            style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 14 }}
          >
            Cancel
          </button>
        </>
      ) : (
        <>
          <button onClick={() => setShowDifficulty(true)} disabled={!hasName} style={{ ...btnStyle, opacity: hasName ? 1 : 0.5, cursor: hasName ? 'pointer' : 'not-allowed' }}>vs AI</button>
          <button onClick={handleLocal} style={btnStyle}>Local (Pass &amp; Play)</button>
          <button onClick={() => navigate('/lobby')} disabled={!hasName} style={{ ...btnStyle, borderColor: '#c060e0', background: '#2a0040', opacity: hasName ? 1 : 0.5, cursor: hasName ? 'pointer' : 'not-allowed' }}>
            Online
          </button>
          
          <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
            <button onClick={handleTutorial} style={secondaryBtnStyle}>
              How to Play
            </button>
          </div>
        </>
      )}

      {showStats && <StatsDashboard onClose={() => setShowStats(false)} />}
      {showProfile && <ProfileOverlay onClose={() => setShowProfile(false)} />}
      <StatsStrip onClick={() => setShowStats(true)} />
    </div>
  )
}

const inputStyle: CSSProperties = {
  width: '100%',
  fontSize: 18,
  background: '#111',
  color: '#fff',
  border: '2px solid #444',
  borderRadius: 8,
  padding: '12px',
  textAlign: 'center',
  outline: 'none',
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

const secondaryBtnStyle: CSSProperties = {
  background: 'none',
  border: '1.5px solid #888',
  color: '#aaa',
  fontSize: 14,
  padding: '8px 20px',
  borderRadius: 6,
  cursor: 'pointer',
  fontWeight: 600,
}

import { useState, useEffect, type CSSProperties } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import { ProfileIcon } from '../components/ProfileIcon'
import { ProfileOverlay } from '../components/ProfileOverlay'

export function LobbyScreen() {
  const navigate = useNavigate()
  const { onlineStatus, roomCode, joinOnline, setOnlineStatus, disconnectOnline, playerName, setPlayerName } = useGameStore()
  const [joinCode, setJoinCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showProfile, setShowProfile] = useState(false)

  useEffect(() => {
    if (onlineStatus === 'playing') {
      navigate('/game', { replace: true })
    }
  }, [onlineStatus, navigate])

  if (onlineStatus === 'playing') return <Navigate to="/game" replace />

  async function handleCreate() {
    setError(null)
    try {
      await joinOnline('create')
    } catch {
      setError('Failed to create room')
      disconnectOnline()
    }
  }

  async function handleJoin() {
    const trimmed = joinCode.trim().toUpperCase()
    if (trimmed.length < 6) { setError('Enter a 6-character room code'); return }
    setError(null)
    try {
      await joinOnline('join', trimmed)
    } catch {
      setError('Room not found or full')
      disconnectOnline()
    }
  }

  function handleQuickMatch() {
    setError(null)
    joinOnline('quick').catch(() => {
      setError('Connection failed')
      disconnectOnline()
    })
  }

  function handleCancel() {
    disconnectOnline()
  }

  if (onlineStatus === 'connecting' || onlineStatus === 'waiting') {
    return (
      <div style={centerStyle}>
        <ProfileIcon onClick={() => setShowProfile(true)} />
        <h2 style={{ color: '#f0c030', fontWeight: 900, fontSize: 28 }}>Online</h2>
        {roomCode && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: '#888', fontSize: 12, marginBottom: 6 }}>Share this code:</div>
            <div style={{ fontSize: 36, fontWeight: 900, letterSpacing: 8, color: '#f0e8d8' }}>{roomCode}</div>
          </div>
        )}
        <div style={{ color: '#888' }}>
          {onlineStatus === 'connecting' ? 'Connecting...' : 'Waiting for opponent...'}
        </div>
        <button onClick={handleCancel} style={{ ...btnStyle, background: '#3a1a00', border: '2px solid #888' }}>
          Cancel
        </button>
        {showProfile && <ProfileOverlay onClose={() => setShowProfile(false)} />}
      </div>
    )
  }

  return (
    <div style={centerStyle}>
      <ProfileIcon onClick={() => setShowProfile(true)} />
      <h2 style={{ fontSize: 32, fontWeight: 900, color: '#f0c030' }}>Online</h2>

      <input
        value={playerName}
        onChange={e => setPlayerName(e.target.value)}
        placeholder="Your name (optional)"
        maxLength={24}
        style={{
          padding: '12px 16px', fontSize: 16,
          background: '#1a0a00', color: '#f0e8d8',
          border: '2px solid #5a3a20', borderRadius: 8,
          width: '100%', maxWidth: 260, textAlign: 'center',
        }}
      />

      {error && <div style={{ color: '#ff4060', fontSize: 14 }}>{error}</div>}

      <button onClick={handleCreate} style={btnStyle}>Create Room</button>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          value={joinCode}
          onChange={e => setJoinCode(e.target.value.toUpperCase().slice(0, 6))}
          placeholder="ROOM CODE"
          maxLength={6}
          style={{
            padding: '12px 16px', fontSize: 18, fontWeight: 700,
            background: '#1a0a00', color: '#f0e8d8',
            border: '2px solid #5a3a20', borderRadius: 8,
            width: 160, textAlign: 'center', letterSpacing: 4,
          }}
        />
        <button onClick={handleJoin} style={{ ...btnStyle, minWidth: 80, padding: '14px 20px' }}>Join</button>
      </div>

      <button onClick={handleQuickMatch} style={{ ...btnStyle, borderColor: '#c060e0', background: '#2a0040' }}>
        Quick Match
      </button>

      <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#888', fontSize: 14, cursor: 'pointer', marginTop: 8 }}>
        ← Back
      </button>

      {showProfile && <ProfileOverlay onClose={() => setShowProfile(false)} />}
    </div>
  )
}

const centerStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  justifyContent: 'center', height: '100%', gap: 20, padding: 24,
}

const btnStyle: CSSProperties = {
  padding: '14px 40px', fontSize: 18, fontWeight: 700,
  background: '#5a3a00', color: '#f0e8d8',
  border: '2px solid #f0c030', borderRadius: 8,
  cursor: 'pointer', letterSpacing: 1, minWidth: 220,
}

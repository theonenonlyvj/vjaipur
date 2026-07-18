import { useState, useEffect, type CSSProperties } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import { ProfileIcon } from '../components/ProfileIcon'
import { ProfileOverlay } from '../components/ProfileOverlay'

/** Coarse "Xm/Xh/Xd ago" for the "Your games" resume list. Deliberately
 *  coarse (no seconds) — this is a lobby list, not a live countdown. */
function formatLastActivity(ts: number): string {
  const deltaMs = Date.now() - ts
  const minutes = Math.floor(deltaMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function LobbyScreen() {
  const navigate = useNavigate()
  const {
    onlineStatus, roomCode, joinOnline, disconnectOnline, playerName, setPlayerName,
    myGamesList, fetchMyGames, resumeGame,
  } = useGameStore()
  const [joinCode, setJoinCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showProfile, setShowProfile] = useState(false)

  useEffect(() => {
    if (onlineStatus === 'playing') {
      navigate('/game', { replace: true })
    }
  }, [onlineStatus, navigate])

  // "Your games" — the other active/waiting games this account owns (worker's
  // GET /my-games), fetched once on entering the lobby's idle (pre-create/
  // join) state. Resuming one routes through resumeGame, which drives
  // onlineStatus itself — the effect above (and the render guard below) then
  // navigate/redirect exactly like joinOnline already does, so no separate
  // navigation call is needed here.
  useEffect(() => {
    if (onlineStatus === 'idle') void fetchMyGames()
  }, [onlineStatus, fetchMyGames])

  async function handleResume(gameId: string, seatIndex: number) {
    setError(null)
    await resumeGame(gameId, seatIndex === 1 ? 1 : 0)
    // resumeGame surfaces failures via the store's general `error` field
    // (there's no board mounted yet to show the usual Toast) — mirror it
    // into this screen's local error line instead.
    const storeError = useGameStore.getState().error
    if (storeError) setError(storeError.message)
  }

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

      {myGamesList.length > 0 && (
        <div style={{ width: '100%', maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, color: '#888', fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1 }}>
            Your games
          </div>
          {myGamesList.map(g => (
            <div
              key={g.gameId}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                padding: '10px 12px', background: 'rgba(255,255,255,0.05)',
                border: '1px solid #444', borderRadius: 6,
              }}
            >
              <span style={{ color: '#f0e8d8', fontSize: 13 }}>
                {g.code} · {g.matchLength === 1 ? '1 game' : `${g.matchLength} games`}
                {' · '}
                {g.status === 'waiting' ? 'waiting for opponent' : 'in progress'}
                {g.lastActivityAt != null && ` · ${formatLastActivity(g.lastActivityAt)}`}
              </span>
              <button
                onClick={() => { void handleResume(g.gameId, g.seatIndex) }}
                style={{
                  padding: '6px 14px', fontSize: 13, fontWeight: 700,
                  background: '#5a3a00', color: '#f0e8d8',
                  border: '2px solid #f0c030', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >
                Resume
              </button>
            </div>
          ))}
        </div>
      )}

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

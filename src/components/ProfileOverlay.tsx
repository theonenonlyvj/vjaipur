import { useState, type CSSProperties } from 'react'
import { useStatsStore, useStatsAggregates } from '../store/statsStore'
import { socketService } from '../socket/socketService'

interface ProfileOverlayProps {
  onClose: () => void
}

export function ProfileOverlay({ onClose }: ProfileOverlayProps) {
  const { displayName, friendCode, secureAccount, restoreAccount, clearStats } = useStatsStore()
  const { totalMatches, wins, losses, winRate } = useStatsAggregates()
  
  const [isRestoring, setIsRestoring] = useState(false)
  const [isSecuring, setIsSecuring] = useState(false)
  
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const isGuest = displayName?.startsWith('Guest_')

  async function handleSecure() {
    if (!username || !password) {
      setError('Both username and password are required')
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await secureAccount(username, password)
      if (result.ok) {
        setIsSecuring(false)
        setUsername('')
        setPassword('')
      } else {
        setError(result.error || 'Failed to secure account')
      }
    } catch (e) {
      setError('Connection error')
    } finally {
      setLoading(false)
    }
  }

  async function handleRestore() {
    if (!username || !password) {
      setError('Both username and password are required')
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await restoreAccount(username, password)
      if (result.ok) {
        setIsRestoring(false)
        setUsername('')
        setPassword('')
      } else {
        setError(result.error || 'Account not found')
      }
    } catch (e) {
      setError('Connection error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <div style={headerStyle}>
          <h2 style={{ margin: 0, color: '#f0c030' }}>PROFILE</h2>
          <button onClick={onClose} style={closeButtonStyle}>&times;</button>
        </div>

        <div style={sectionStyle}>
          <div style={{ fontSize: 14, color: '#aaa', marginBottom: 4 }}>CURRENT IDENTITY</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#fff' }}>{displayName}</div>
          <div style={{ fontSize: 12, color: '#666', fontFamily: 'monospace' }}>Friend Code: {friendCode}</div>
          <div style={{ marginTop: 8, padding: '4px 8px', background: isGuest ? '#3a1a00' : '#003a1a', border: `1px solid ${isGuest ? '#a06000' : '#00a060'}`, borderRadius: 4, display: 'inline-block', fontSize: 11, color: isGuest ? '#f0c030' : '#80ff80' }}>
            {isGuest ? 'GUEST ACCOUNT' : 'SECURED ACCOUNT'}
          </div>
        </div>

        <div style={sectionStyle}>
          <div style={{ fontSize: 14, color: '#aaa', marginBottom: 8 }}>CAREER STATS</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={statBoxStyle}>
              <div style={statLabelStyle}>MATCHES</div>
              <div style={statValueStyle}>{totalMatches}</div>
            </div>
            <div style={statBoxStyle}>
              <div style={statLabelStyle}>WIN RATE</div>
              <div style={statValueStyle}>{winRate.toFixed(0)}%</div>
            </div>
            <div style={statBoxStyle}>
              <div style={statLabelStyle}>WINS</div>
              <div style={{ ...statValueStyle, color: '#80ff80' }}>{wins}</div>
            </div>
            <div style={statBoxStyle}>
              <div style={statLabelStyle}>LOSSES</div>
              <div style={{ ...statValueStyle, color: '#ff8080' }}>{losses}</div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
          {isGuest && !isSecuring && !isRestoring && (
            <button 
              onClick={() => { setIsSecuring(true); setError(''); }}
              style={primaryBtnStyle}
            >
              Secure Account
            </button>
          )}

          {!isSecuring && !isRestoring && (
            <button 
              onClick={() => { setIsRestoring(true); setError(''); }}
              style={secondaryBtnStyle}
            >
              Restore Account
            </button>
          )}

          {(isSecuring || isRestoring) && (
            <div style={formStyle}>
              <h3 style={{ margin: '0 0 12px 0', fontSize: 16, color: '#f0c030' }}>
                {isSecuring ? 'Secure Account' : 'Restore Account'}
              </h3>
              <input 
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Username"
                style={inputStyle}
                disabled={loading}
              />
              <input 
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Password"
                style={{ ...inputStyle, marginTop: 8 }}
                disabled={loading}
              />
              {error && <div style={{ color: '#ff4060', fontSize: 12, marginTop: 8 }}>{error}</div>}
              <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                <button 
                  onClick={() => { setIsSecuring(false); setIsRestoring(false); setError(''); }}
                  style={{ ...secondaryBtnStyle, flex: 1, margin: 0 }}
                  disabled={loading}
                >
                  Cancel
                </button>
                <button 
                  onClick={isSecuring ? handleSecure : handleRestore}
                  style={{ ...primaryBtnStyle, flex: 1, margin: 0 }}
                  disabled={loading || !username || !password}
                >
                  {loading ? 'Processing...' : (isSecuring ? 'Secure' : 'Restore')}
                </button>
              </div>
            </div>
          )}

          {!isSecuring && !isRestoring && (
             <button 
             onClick={() => { if(confirm('Erase all stats and start as a fresh guest?')) clearStats(); }}
             style={{ ...secondaryBtnStyle, color: '#ff4060', borderColor: '#400000', marginTop: 20 }}
           >
             Reset Identity
           </button>
          )}
        </div>
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: 'rgba(0,0,0,0.85)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  backdropFilter: 'blur(8px)',
}

const modalStyle: CSSProperties = {
  background: '#1a1a1a',
  width: '100%',
  maxWidth: 360,
  padding: 24,
  borderRadius: 16,
  border: '2px solid #f0c030',
  boxShadow: '0 0 30px rgba(0,0,0,1)',
  color: '#eee',
}

const headerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 24,
}

const closeButtonStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#888',
  fontSize: 28,
  cursor: 'pointer',
  padding: 0,
  lineHeight: 1,
}

const sectionStyle: CSSProperties = {
  marginBottom: 24,
  paddingBottom: 20,
  borderBottom: '1px solid #333',
}

const statBoxStyle: CSSProperties = {
  background: '#000',
  padding: '10px',
  borderRadius: 8,
  border: '1px solid #333',
  textAlign: 'center',
}

const statLabelStyle: CSSProperties = {
  fontSize: 10,
  color: '#666',
  letterSpacing: 1,
  fontWeight: 900,
}

const statValueStyle: CSSProperties = {
  fontSize: 18,
  fontWeight: 900,
  color: '#fff',
}

const primaryBtnStyle: CSSProperties = {
  padding: '12px',
  fontSize: 16,
  fontWeight: 700,
  background: '#5a3a00',
  color: '#f0e8d8',
  border: '2px solid #f0c030',
  borderRadius: 8,
  cursor: 'pointer',
  width: '100%',
}

const secondaryBtnStyle: CSSProperties = {
  padding: '10px',
  fontSize: 14,
  background: 'none',
  color: '#aaa',
  border: '1.5px solid #444',
  borderRadius: 8,
  cursor: 'pointer',
  width: '100%',
}

const formStyle: CSSProperties = {
  background: '#000',
  padding: 16,
  borderRadius: 12,
  border: '1px solid #333',
}

const inputStyle: CSSProperties = {
  width: '100%',
  fontSize: 16,
  background: '#111',
  color: '#fff',
  border: '1.5px solid #444',
  borderRadius: 6,
  padding: '10px',
  outline: 'none',
  boxSizing: 'border-box',
}

import { useState, useEffect, type CSSProperties } from 'react'
import { useStatsStore, useStatsAggregates } from '../store/statsStore'
import { socketService } from '../socket/socketService'

export function ProfileHeader() {
  const { friendCode, secretKey, ensureAccount, restoreAccount } = useStatsStore()
  const { totalMatches, winRate } = useStatsAggregates()
  const [showSecret, setShowSecret] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)
  const [restoreValue, setRestoreValue] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    ensureAccount()
  }, [ensureAccount])

  async function handleRestore() {
    const trimmed = restoreValue.trim()
    if (!trimmed.includes(':')) {
      setError('Format: CODE:SECRET')
      return
    }
    const [fc, sk] = trimmed.split(':').map(s => s.trim())
    if (!fc || !sk) {
      setError('Invalid CODE or SECRET')
      return
    }

    setLoading(true)
    setError('')

    const url = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001'
    socketService.connect(url)
    
    try {
      const ack = await socketService.restoreAccount({ friendCode: fc, secretKey: sk })
      if (ack.ok && ack.matches) {
        restoreAccount(ack.matches, fc, sk)
        setIsRestoring(false)
        setRestoreValue('')
        setShowSecret(false)
      } else {
        setError(ack.error || 'Account not found')
      }
    } catch (e) {
      setError('Connection error')
    } finally {
      setLoading(false)
    }
  }

  if (!friendCode) return null

  return (
    <div style={containerStyle}>
      <div style={{ fontWeight: 900, color: '#f0c030', marginBottom: 4, letterSpacing: 1, fontSize: 11 }}>STATS &amp; ACCOUNT</div>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#eee', marginBottom: 2 }}>
        <span>Friend Code:</span>
        <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{friendCode}</span>
      </div>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#aaa' }}>
        <span>Record:</span>
        <span>{totalMatches} matches ({winRate.toFixed(0)}% win)</span>
      </div>

      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button 
          onClick={() => setShowSecret(!showSecret)}
          style={smallBtnStyle}
        >
          {showSecret ? 'Hide Secret Key' : 'Show Secret (for linking)'}
        </button>
        
        {showSecret && (
          <div style={secretBoxStyle}>
            <div style={{ color: '#888', marginBottom: 4 }}>Copy this to link on another device:</div>
            <div style={{ color: '#fff', fontSize: 11, wordBreak: 'break-all', userSelect: 'all', background: '#000', padding: 4, borderRadius: 4, border: '1px solid #333' }}>
              {friendCode}:{secretKey}
            </div>
          </div>
        )}
        
        {!isRestoring ? (
          <button 
            onClick={() => setIsRestoring(true)}
            style={{ ...smallBtnStyle, color: '#c060e0' }}
          >
            Link Existing Account
          </button>
        ) : (
          <div style={{ marginTop: 4, borderTop: '1px solid #333', paddingTop: 8 }}>
            <input 
              value={restoreValue}
              onChange={e => setRestoreValue(e.target.value)}
              placeholder="PASTE CODE:SECRET"
              disabled={loading}
              style={inputStyle}
            />
            {error && <div style={{ color: '#ff4060', fontSize: 11, marginTop: 4 }}>{error}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button 
                onClick={() => { setIsRestoring(false); setError(''); }} 
                disabled={loading}
                style={{ ...smallBtnStyle, color: '#888' }}
              >
                Cancel
              </button>
              <button 
                onClick={handleRestore} 
                disabled={loading || !restoreValue.trim()}
                style={{ ...smallBtnStyle, color: '#f0c030', fontWeight: 900 }}
              >
                {loading ? 'Restoring...' : 'Restore'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const containerStyle: CSSProperties = {
  background: 'rgba(0,0,0,0.4)',
  padding: '16px',
  borderRadius: 12,
  border: '1.5px solid #444',
  width: '100%',
  maxWidth: 260,
  textAlign: 'left',
  backdropFilter: 'blur(4px)',
}

const smallBtnStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#aaa',
  cursor: 'pointer',
  fontSize: 11,
  padding: 0,
  textAlign: 'left',
  textDecoration: 'underline',
}

const secretBoxStyle: CSSProperties = {
  background: '#1a1a1a',
  padding: 8,
  borderRadius: 8,
  border: '1px solid #333',
  fontSize: 10,
}

const inputStyle: CSSProperties = {
  width: '100%',
  fontSize: 12,
  background: '#111',
  color: '#eee',
  border: '1px solid #555',
  borderRadius: 4,
  padding: '6px 8px',
  outline: 'none',
}

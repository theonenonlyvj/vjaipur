import { useEffect, useState } from 'react'
import { useGameStore } from '../store/gameStore'

const FORFEIT_SECONDS = 180

export function DisconnectBanner() {
  const onlineStatus = useGameStore(s => s.onlineStatus)
  const [seconds, setSeconds] = useState(FORFEIT_SECONDS)

  useEffect(() => {
    if (onlineStatus !== 'opponent-disconnected') {
      setSeconds(FORFEIT_SECONDS)
      return
    }
    const interval = setInterval(() => {
      setSeconds(s => Math.max(0, s - 1))
    }, 1000)
    return () => clearInterval(interval)
  }, [onlineStatus])

  if (onlineStatus === 'forfeited') {
    return (
      <div style={{
        padding: '12px 20px', background: '#2a3020',
        border: '2px solid #60c040', borderRadius: 8,
        textAlign: 'center', color: '#60c040', fontWeight: 700,
      }}>
        Opponent forfeit — you win!
      </div>
    )
  }

  if (onlineStatus !== 'opponent-disconnected') return null

  return (
    <div style={{
      padding: '12px 20px', background: '#3a1a00',
      border: '2px solid #f0c030', borderRadius: 8, textAlign: 'center',
    }}>
      <div style={{ color: '#f0c030', fontWeight: 700 }}>Opponent disconnected</div>
      <div style={{ color: '#888', fontSize: 13, marginTop: 4 }}>
        Waiting for reconnect... {seconds}s
      </div>
    </div>
  )
}

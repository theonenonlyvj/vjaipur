import { useStatsStore } from '../store/statsStore'
import { type CSSProperties } from 'react'

interface ProfileIconProps {
  onClick: () => void
}

export function ProfileIcon({ onClick }: ProfileIconProps) {
  const { displayName } = useStatsStore()
  
  const initial = displayName ? displayName[0].toUpperCase() : '?'
  const isGuest = displayName?.startsWith('Guest_')

  return (
    <button 
      onClick={onClick}
      style={iconButtonStyle}
      title={displayName || 'Profile'}
    >
      <div style={circleStyle(isGuest)}>
        {initial}
      </div>
    </button>
  )
}

const iconButtonStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 8,
  cursor: 'pointer',
  position: 'absolute',
  top: 10,
  right: 10,
  zIndex: 100,
}

const circleStyle = (isGuest?: boolean): CSSProperties => ({
  width: 40,
  height: 40,
  borderRadius: '50%',
  background: isGuest ? '#333' : '#5a3a00',
  border: `2px solid ${isGuest ? '#666' : '#f0c030'}`,
  color: isGuest ? '#aaa' : '#f0c030',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 20,
  fontWeight: 900,
  transition: 'transform 0.2s',
})

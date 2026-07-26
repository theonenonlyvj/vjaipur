import { useStatsStore } from '../store/statsStore'
import { type CSSProperties } from 'react'

interface ProfileIconProps {
  onClick: () => void
}

export function ProfileIcon({ onClick }: ProfileIconProps) {
  const { displayName, claimed, sessionExpired } = useStatsStore()

  const initial = displayName ? displayName[0].toUpperCase() : '?'
  // Mirror ProfileOverlay: explicit claim state wins; legacy installs
  // (claimed === undefined) fall back to the old name-prefix heuristic.
  const isGuest = claimed === undefined ? displayName?.startsWith('Guest_') : !claimed

  return (
    <button
      onClick={onClick}
      style={iconButtonStyle}
      title={displayName || 'Profile'}
    >
      <div style={circleStyle(isGuest)}>
        {initial}
        {sessionExpired && <span data-testid="session-expired-badge" style={expiredBadgeStyle} />}
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
  position: 'relative', // anchors the sessionExpired badge below
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

// Small red dot on the avatar circle whenever sessionExpired is true — the
// signal survives a SessionBanner dismissal, since this is mounted
// independently on Home/Lobby.
const expiredBadgeStyle: CSSProperties = {
  position: 'absolute',
  top: -2,
  right: -2,
  width: 10,
  height: 10,
  borderRadius: '50%',
  background: '#ff4060',
  border: '2px solid #1a1a1a',
}

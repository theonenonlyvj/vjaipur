import { useEffect, useState, type CSSProperties } from 'react'
import { useStatsStore } from '../store/statsStore'
import { ProfileOverlay } from './ProfileOverlay'

/**
 * The global "you were signed out" nag — a sibling to UpdateBanner.tsx, same
 * fixed-top-bar pattern, but reading `sessionExpired` (see statsStore's
 * ensureVGamesAccount) instead of a stale-bundle check. Mounted once in
 * App.tsx above <Routes>, so it shows on EVERY screen (Home/Lobby/Game/
 * RoundEnd/GameOver) with zero per-screen wiring — including mid-game, where
 * there'd otherwise be no login affordance at all. Self-contained: holds its
 * own `showProfile` state and renders ProfileOverlay directly, the same
 * pattern LobbyScreen already uses, so it never depends on a ProfileIcon
 * being mounted on the current screen.
 */
export function SessionBanner() {
  const sessionExpired = useStatsStore((s) => s.sessionExpired)
  const [dismissed, setDismissed] = useState(false)
  const [showProfile, setShowProfile] = useState(false)

  // Don't let an OLD dismissal hide a NEW expiry episode (sign back in, then
  // get signed out again later in the same session).
  useEffect(() => {
    if (sessionExpired) setDismissed(false)
  }, [sessionExpired])

  if (!sessionExpired || dismissed) return null

  return (
    <>
      <div style={bannerStyle}>
        <span>You're signed out — log in to keep syncing your games and stats.</span>
        <button onClick={() => setShowProfile(true)} style={loginButtonStyle}>
          Log In
        </button>
        <button onClick={() => setDismissed(true)} aria-label="Dismiss" title="Dismiss" style={dismissButtonStyle}>
          ×
        </button>
      </div>
      {showProfile && <ProfileOverlay onClose={() => setShowProfile(false)} />}
    </>
  )
}

// top: 42 is a hardcoded offset below UpdateBanner's own ~42px-tall bar (the
// two co-occurring — stale bundle AND dead session at once — is rare enough
// that a shared stack wrapper isn't worth it tonight; see council synthesis).
const bannerStyle: CSSProperties = {
  position: 'fixed', top: 42, left: 0, right: 0, zIndex: 2990,
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
  padding: '10px 16px', background: '#3a0000', borderBottom: '2px solid #ff4060',
  color: '#ffb0b0', fontSize: 13, fontWeight: 700, textAlign: 'center',
}

const loginButtonStyle: CSSProperties = {
  padding: '4px 14px', fontSize: 13, fontWeight: 700,
  background: '#ff4060', color: '#1a0000',
  border: 'none', borderRadius: 6, cursor: 'pointer',
}

const dismissButtonStyle: CSSProperties = {
  background: 'none', border: 'none', color: '#ffb0b0',
  fontSize: 16, lineHeight: 1, cursor: 'pointer', padding: '0 4px',
}

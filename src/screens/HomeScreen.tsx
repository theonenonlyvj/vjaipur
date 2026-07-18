import { useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import { ProfileIcon } from '../components/ProfileIcon'
import { ProfileOverlay } from '../components/ProfileOverlay'
import { StatsDashboard } from '../components/StatsDashboard'
import { StatsStrip } from '../components/StatsStrip'
import type { Difficulty } from '../store/gameStore'
import { ACTIVE_TIERS } from '../ai/tiers'

export function HomeScreen() {
  const navigate = useNavigate()
  const { startGame, setDifficulty, matchLength, setMatchLength, mode, state } = useGameStore()
  const [showDifficulty, setShowDifficulty] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [showProfile, setShowProfile] = useState(false)

  // main.tsx's boot-time resumeSession() silently restores a persisted
  // online session (src/net/session.ts) into the store when the game is
  // still active/round_end — this is the "least invasive" resume affordance
  // the build brief calls for: a banner here rather than an automatic
  // navigate (which could yank the user into a game they didn't ask to see
  // yet, e.g. right after a fresh page load).
  const canResumeOnline = mode === 'online' && state !== null

  function handleDifficulty(d: Difficulty) {
    setDifficulty(d)
    startGame('vs-ai')
    navigate('/game')
  }

  function handleLocal() {
    startGame('local')
    navigate('/game')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 24, padding: 20 }}>
      <ProfileIcon onClick={() => setShowProfile(true)} />

      <h1 style={{ fontSize: 40, fontWeight: 900, letterSpacing: 2, color: '#f0c030', marginTop: 20 }}>VJAIPUR</h1>

      {canResumeOnline && (
        <button
          onClick={() => navigate('/game')}
          style={{ ...btnStyle, borderColor: '#c060e0', background: '#2a0040', minWidth: 260 }}
        >
          Resume online match
        </button>
      )}

      {/* Match Length Selector */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: '#888', fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1 }}>Match Length</div>
        <div style={{ display: 'flex', gap: 12 }}>
          {([1, 3, 5] as const).map(len => (
            <button
              key={len}
              onClick={() => setMatchLength(len)}
              style={{
                background: matchLength === len ? '#f0c030' : 'rgba(255,255,255,0.05)',
                color: matchLength === len ? '#000' : '#888',
                border: matchLength === len ? '1px solid #fff' : '1px solid #444',
                borderRadius: 6,
                padding: '6px 16px',
                fontSize: 14,
                fontWeight: 900,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              {len} {len === 1 ? 'GAME' : 'GAMES'}
            </button>
          ))}
        </div>
      </div>
      
      {showDifficulty ? (
        <>
          {ACTIVE_TIERS.map((tier) => (
            <button
              key={tier.id}
              onClick={() => handleDifficulty(tier.id)}
              style={{ ...btnStyle, ...(tierAccentStyle[tier.id] ?? {}) }}
            >
              <span style={{ display: 'block' }}>{tier.label}</span>
              <span style={taglineStyle}>{tier.tagline}</span>
            </button>
          ))}
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
          
          <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
            <button onClick={() => navigate('/rules')} style={secondaryBtnStyle}>
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

const btnStyle: CSSProperties = {
  padding: '12px 40px',
  fontSize: 18,
  fontWeight: 700,
  background: '#5a3a00',
  color: '#f0e8d8',
  border: '2px solid #f0c030',
  borderRadius: 8,
  cursor: 'pointer',
  letterSpacing: 1,
  minWidth: 220,
  textAlign: 'center',
}

const taglineStyle: CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: 0.3,
  opacity: 0.75,
  marginTop: 2,
  textTransform: 'none',
}

// Presentational accents for the two "lean into it" tiers — purely cosmetic,
// keyed off the stable engine id. Labels/taglines themselves come from
// src/ai/tiers.ts; this just picks a color.
const tierAccentStyle: Partial<Record<string, CSSProperties>> = {
  fair: { borderColor: '#40a0ff', background: '#001a3a', color: '#80c0ff' },
  hard3: { borderColor: '#ff3030', background: '#1a0000', color: '#ff9090' },
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

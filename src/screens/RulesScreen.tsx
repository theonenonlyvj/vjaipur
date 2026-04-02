import { useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import { GameplayTab, ScoringTab, StrategyTab, tabBtnStyle, type RulesTab } from '../components/RulesContent'

export function RulesScreen() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<RulesTab>('gameplay')
  const { setDifficulty, startTutorial, startGame } = useGameStore()

  function handleStartTutorial() {
    setDifficulty('easy')
    startTutorial()
    startGame('vs-ai')
    navigate('/game')
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      maxWidth: 760, margin: '0 auto', width: '100%',
      background: 'radial-gradient(circle at 50% 50%, #1a0a00 0%, #000000 100%)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px 20px' }}>
        <h1 style={{ fontSize: 20, fontWeight: 900, color: '#f0c030', margin: 0, letterSpacing: 2 }}>HOW TO PLAY</h1>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.1)', padding: '0 20px' }}>
        {(['gameplay', 'scoring', 'strategy'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              ...tabBtnStyle,
              color: tab === t ? '#f0c030' : '#666',
              borderBottom: tab === t ? '2px solid #f0c030' : '2px solid transparent',
            }}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Content */}
      <style>{`.rules-content::-webkit-scrollbar { display: none; }`}</style>
      <div className="rules-content" style={{ flex: 1, overflow: 'auto', padding: '20px 24px 120px', scrollbarWidth: 'none' }}>
        {tab === 'gameplay' && <GameplayTab />}
        {tab === 'scoring' && <ScoringTab />}
        {tab === 'strategy' && <StrategyTab />}
      </div>

      {/* Fixed bottom button */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        padding: '16px 24px 32px',
        background: 'linear-gradient(transparent, #000 40%)',
        display: 'flex', justifyContent: 'center', gap: 12, alignItems: 'center',
      }}>
        <button onClick={() => navigate('/')} style={backBtnStyle}>
          ← Back
        </button>
        <button onClick={handleStartTutorial} style={tutorialBtnStyle}>
          Start Tutorial
        </button>
      </div>
    </div>
  )
}

const backBtnStyle: CSSProperties = {
  background: 'none', border: 'none', color: '#888',
  cursor: 'pointer', fontSize: 14, fontWeight: 600, padding: 0,
}

const tutorialBtnStyle: CSSProperties = {
  padding: '14px 40px', fontSize: 16, fontWeight: 900,
  background: 'linear-gradient(to bottom, #306010, #1a4000)',
  color: '#e0f0d0',
  border: '2px solid #60c040', borderRadius: 12,
  cursor: 'pointer', letterSpacing: 1,
  textTransform: 'uppercase',
  minWidth: 220,
}

import { useState } from 'react'
import { GameplayTab, ScoringTab, StrategyTab, tabBtnStyle, type RulesTab } from './RulesContent'

interface Props {
  onClose: () => void
}

export function RulesModal({ onClose }: Props) {
  const [tab, setTab] = useState<RulesTab>('gameplay')

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 900,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#1a120a',
          border: '1.5px solid #f0c030',
          borderRadius: 16,
          width: '100%',
          maxWidth: 560,
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px 0' }}>
          <span style={{ fontSize: 16, fontWeight: 900, color: '#f0c030', letterSpacing: 2 }}>HOW TO PLAY</span>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', color: '#888',
              fontSize: 18, cursor: 'pointer', padding: '0 4px', lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.1)', padding: '0 16px' }}>
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

        {/* Scrollable content */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px 20px', scrollbarWidth: 'none' }}>
          {tab === 'gameplay' && <GameplayTab />}
          {tab === 'scoring' && <ScoringTab />}
          {tab === 'strategy' && <StrategyTab />}
        </div>
      </div>
    </div>
  )
}

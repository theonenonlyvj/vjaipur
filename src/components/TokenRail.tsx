import type { TokenPiles, BonusPiles, Good } from '../engine'

const GOODS: Good[] = ['diamond', 'gold', 'silver', 'cloth', 'spice', 'leather']

const ACCENT: Record<Good, string> = {
  diamond: '#ff4060', gold: '#f0c030', silver: '#c0d0e0',
  cloth: '#c060e0', spice: '#60c040', leather: '#c08040',
}

interface Props {
  tokens: TokenPiles
  bonusTokens: BonusPiles
}

export function TokenRail({ tokens, bonusTokens }: Props) {
  return (
    <div style={{
      display: 'flex', gap: 8, padding: '8px 12px',
      background: '#1f1000', borderRadius: 8,
      flexWrap: 'wrap', alignItems: 'center',
    }}>
      {GOODS.map(good => {
        const pile = tokens[good]
        const top = pile[0]
        return (
          <div key={good} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, minWidth: 44 }}>
            <span style={{ fontSize: 10, color: ACCENT[good], textTransform: 'uppercase', letterSpacing: 1 }}>
              {good}
            </span>
            {top !== undefined
              ? <span style={{ fontSize: 18, fontWeight: 700, color: '#fff', lineHeight: 1 }}>{top}</span>
              : <span style={{ fontSize: 12, color: '#555' }}>—</span>
            }
            <span style={{ fontSize: 10, color: '#888' }}>×{pile.length}</span>
          </div>
        )
      })}
      <div style={{ width: 1, background: '#3a2a10', alignSelf: 'stretch', margin: '0 4px' }} />
      {(['three', 'four', 'five'] as const).map(tier => (
        <div key={tier} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, minWidth: 36 }}>
          <span style={{ fontSize: 10, color: '#d0a860', textTransform: 'uppercase' }}>{tier}</span>
          <span style={{ fontSize: 14, color: '#f0e8d8', fontWeight: 700 }}>×{bonusTokens[tier].length}</span>
        </div>
      ))}
    </div>
  )
}

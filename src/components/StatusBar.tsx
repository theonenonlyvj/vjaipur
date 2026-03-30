import type { PlayerState } from '../engine'

interface Props {
  player: PlayerState
  playerIndex: 0 | 1
  isActive: boolean
  name?: string | null
}

export function StatusBar({ player, playerIndex, isActive, name }: Props) {
  const goodsTotal = player.tokens.reduce((s, t) => s + t.value, 0)
  const bonusCount = player.bonusTokens.length
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16,
      padding: '8px 16px',
      background: isActive ? '#2a1a08' : '#1a1000',
      borderRadius: 8,
      border: isActive ? '2px solid #f0c030' : '1px solid #3a2a10',
    }}>
      <span style={{ fontWeight: 700, color: '#f0c030' }}>{name ? `${name} (You)` : `P${playerIndex + 1} (You)`}</span>
      <span style={{ color: '#d0a860' }}>Camels: {player.herd}</span>
      <span style={{ color: '#f0e8d8', fontWeight: 700 }}>{goodsTotal} pts</span>
      <span style={{ color: '#c060e0' }}>+{bonusCount} bonus</span>
      {isActive && (
        <span style={{ marginLeft: 'auto', color: '#60c040', fontWeight: 700 }}>YOUR TURN</span>
      )}
    </div>
  )
}

import type { PlayerState } from '../engine'

interface Props {
  player: PlayerState
  playerIndex: 0 | 1
  isActive: boolean
  name?: string | null
}

export function OpponentStrip({ player, playerIndex, isActive, name }: Props) {
  const tokenCount = player.tokens.length + player.bonusTokens.length
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16,
      padding: '8px 16px',
      background: isActive ? 'rgba(42, 26, 8, 0.4)' : 'rgba(0, 0, 0, 0.4)',
      backdropFilter: 'blur(10px)',
      WebkitBackdropFilter: 'blur(10px)',
      borderRadius: 8,
      border: isActive ? '1px solid #f0c030' : '1px solid rgba(255, 255, 255, 0.1)',
    }}>
      <span style={{ fontWeight: 700, color: '#888' }}>{name || `P${playerIndex + 1}`}</span>
      <span style={{ color: '#f0e8d8' }}>Cards: {player.hand.length}</span>
      <span style={{ color: '#d0a860' }}>Camels: ?</span>
      <span style={{ color: '#888' }}>Tokens: {tokenCount}</span>
      {isActive && (
        <span style={{ marginLeft: 'auto', color: '#f0c030', fontSize: 12, fontWeight: 700 }}>
          THEIR TURN
        </span>
      )}
    </div>
  )
}

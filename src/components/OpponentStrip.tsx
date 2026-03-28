import type { PlayerState } from '../engine'

interface Props {
  player: PlayerState
  playerIndex: 0 | 1
  isActive: boolean
}

export function OpponentStrip({ player, playerIndex, isActive }: Props) {
  const tokenCount = player.tokens.length + player.bonusTokens.length
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16,
      padding: '8px 16px',
      background: isActive ? '#2a1a08' : '#1a1000',
      borderRadius: 8,
      border: isActive ? '1px solid #f0c030' : '1px solid #3a2a10',
    }}>
      <span style={{ fontWeight: 700, color: '#888' }}>P{playerIndex + 1}</span>
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

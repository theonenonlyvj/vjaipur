import { useGameStore } from '../store/gameStore'

/**
 * The cover/reclaim banner — REPLACES the old forfeit-countdown banner.
 * There is no more forfeit online: an absent seat is AI-covered (never
 * forfeited — see worker/src/do/presence.ts's "NO auto-forfeit anywhere").
 * Kept the component name (still mounted from GameScreen) since its role —
 * "tell the player something's off with presence" — is the same, just the
 * mechanism underneath changed.
 */
export function DisconnectBanner() {
  const coveredSeat = useGameStore(s => s.coveredSeat)
  const opponentCovered = useGameStore(s => s.opponentCovered)
  const reclaimSeat = useGameStore(s => s.reclaimSeat)

  if (coveredSeat) {
    return (
      <div style={{
        padding: '12px 20px', background: '#3a1a00',
        border: '2px solid #f0c030', borderRadius: 8,
        textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        <div style={{ color: '#f0c030', fontWeight: 700 }}>
          You were away — AI covered your seat
        </div>
        <button
          onClick={() => { void reclaimSeat() }}
          style={{
            alignSelf: 'center', padding: '8px 20px', fontSize: 13, fontWeight: 700,
            background: '#5a3a00', color: '#f0e8d8',
            border: '2px solid #f0c030', borderRadius: 6, cursor: 'pointer',
          }}
        >
          Take back my seat
        </button>
      </div>
    )
  }

  if (opponentCovered) {
    return (
      <div style={{
        padding: '12px 20px', background: '#1a1a1a',
        border: '2px solid #666', borderRadius: 8, textAlign: 'center',
      }}>
        <div style={{ color: '#aaa', fontWeight: 700 }}>
          Opponent away — AI is playing for them
        </div>
      </div>
    )
  }

  return null
}

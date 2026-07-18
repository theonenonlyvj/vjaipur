import { useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'

/**
 * The "opponent away" banner — REPLACES the old cover/reclaim banner. Owner's
 * 2026-07-18 no-AI-takeover ruling: there is no more AI covering an absent
 * seat. When the opponent goes absent, the game just PAUSES on their turn —
 * this banner tells the present player that, and offers their two
 * resolutions once the worker says each is legal:
 *   - Claim win (only once claimWinAvailable — the opponent has been
 *     genuinely, continuously absent past the worker's grace window).
 *   - Leave & resume later (always available once the opponent is away) —
 *     steps away; the match is saved server-side, nothing is lost.
 * Kept the component name (still mounted from GameScreen) since its role —
 * "tell the player something's off with presence" — is the same, just the
 * mechanism/UI underneath changed. There is no forfeit countdown: absence
 * alone never ends a match.
 */
export function DisconnectBanner() {
  const navigate = useNavigate()
  const onlineView = useGameStore(s => s.onlineView)
  const opponentName = useGameStore(s => s.opponentName)
  const opponentPresent = useGameStore(s => s.opponentPresent)
  const claimWinAvailable = useGameStore(s => s.claimWinAvailable)
  const claimWin = useGameStore(s => s.claimWin)
  const leaveOnline = useGameStore(s => s.leaveOnline)

  // Present, or the match already ended (claimWin/resign themselves resolve
  // into match_over — no reason to keep showing "away" once it's over).
  if (opponentPresent || onlineView?.phase === 'match_over') return null

  function handleLeave() {
    leaveOnline()
    navigate('/')
  }

  return (
    <div style={{
      padding: '12px 20px', background: '#1a1a1a',
      border: '2px solid #666', borderRadius: 8,
      textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ color: '#aaa', fontWeight: 700 }}>
        ⏸ Waiting for {opponentName || 'your opponent'} to return…
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
        {claimWinAvailable && (
          <button
            onClick={() => { void claimWin() }}
            style={{
              padding: '8px 20px', fontSize: 13, fontWeight: 700,
              background: '#3a1a00', color: '#f0c030',
              border: '2px solid #f0c030', borderRadius: 6, cursor: 'pointer',
            }}
          >
            Claim win
          </button>
        )}
        <button
          onClick={handleLeave}
          style={{
            padding: '8px 20px', fontSize: 13, fontWeight: 700,
            background: 'none', color: '#ccc',
            border: '2px solid #666', borderRadius: 6, cursor: 'pointer',
          }}
        >
          Leave &amp; resume later
        </button>
      </div>

      {claimWinAvailable && (
        <div style={{ color: '#777', fontSize: 11, fontStyle: 'italic' }}>
          Claim win ends the match in your favor. Leave keeps it saved — nothing is lost either way.
        </div>
      )}
    </div>
  )
}

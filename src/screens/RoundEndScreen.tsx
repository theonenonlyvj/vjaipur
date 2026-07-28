import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import { scoreRound } from '../engine'
import { ScoreCard } from '../components/ScoreCard'
import { GameScreen } from './GameScreen'

export function RoundEndScreen() {
  const navigate = useNavigate()
  const { state, mode, nextRound, lastMoveDescription, opponentName, playerName, matchLength, onlineView } = useGameStore()
  const [showBoard, setShowBoard] = useState(false)

  useEffect(() => {
    if (!state) return
    if (state.phase === 'playing') navigate('/game', { replace: true })
    if (state.phase === 'game-over') navigate('/game-over', { replace: true })
  }, [state?.phase, navigate])

  if (!state || state.phase !== 'round-end') return <Navigate to="/" replace />

  // Online: the server is the sole scoring authority — viewToRenderState's
  // GameState has placeholder (zero-value) opponent tokens, so a LOCAL
  // scoreRound() here would silently credit the opponent 0 points. Use the
  // worker's own RoundResult (view.lastRoundResult) instead; it's populated
  // whenever phase is round_end/match_over (do/view.ts#buildClientView).
  const result = mode === 'online' && onlineView?.lastRoundResult ? onlineView.lastRoundResult : scoreRound(state)
  const { scores, camelWinner, sealAwardedTo } = result

  // Online's MatchState.seals is ALREADY post-award by the time phase is
  // round_end (worker/src/do/apply.ts applies the seal in the same
  // transaction that ends the round) — unlike local mode's engine
  // `state.seals`, which stays frozen at this round's OPENING tally until
  // the next setupRound. Adding sealAwardedTo's +1 again online would
  // double-count the star.
  const currentSealsFor = (p: 0 | 1) =>
    mode === 'online' ? state.seals[p] : state.seals[p] + (sealAwardedTo === p ? 1 : 0)

  function handleContinue() {
    nextRound()
    if (mode !== 'online') {
      const next = useGameStore.getState().state
      if (next?.phase === 'game-over') {
        navigate('/game-over', { replace: true })
      } else {
        navigate('/game', { replace: true })
      }
    }
    // In online mode, navigation is triggered by the useEffect above once
    // nextRound()'s applyServerView() lands the fresh view and state.phase
    // becomes 'playing' (next round dealt) or 'game-over' (match_over).
  }

  const myIndex = mode === 'online' ? (useGameStore.getState().onlinePlayerIndex ?? 0) : 0
  const p0Name = myIndex === 0 ? (playerName || 'Player 1') : (opponentName || 'Opponent')
  const p1Name = myIndex === 1 ? (playerName || 'Player 2') : (opponentName || 'Opponent')
  // Online only, opponent seat only — the OPPONENT's ScoreCard is the one
  // built from redacted placeholders (viewToRenderState's oppBonusTokens are
  // always value-0), so it's the only one that needs the server-revealed sum
  // (see BUG 1's fix — worker/src/do/view.ts's lastRoundReveal). The self
  // card's playerState.bonusTokens are already real; leaving its override
  // undefined keeps ScoreCard's own summing path unchanged for it.
  const oppIndex: 0 | 1 | null = mode === 'online' ? ((1 - myIndex) as 0 | 1) : null

  const totalSeals = Math.floor(matchLength / 2) + 1

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100%', gap: 20, padding: 24,
      background: 'radial-gradient(circle at 50% 50%, #2a1800 0%, #1a0a00 100%)',
    }}>
      <h2 style={{ fontSize: 32, fontWeight: 900, color: '#f0c030', margin: 0, textTransform: 'uppercase', letterSpacing: 2 }}>
        Round {state.round} Over
      </h2>

      {lastMoveDescription && (
        <div style={{
          background: 'rgba(240, 192, 48, 0.1)',
          border: '1px solid rgba(240, 192, 48, 0.3)',
          borderRadius: 20,
          padding: '6px 16px',
          fontSize: 13,
          color: '#f0c030',
          fontStyle: 'italic',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <span style={{ fontSize: 10, fontStyle: 'normal', fontWeight: 900, textTransform: 'uppercase', opacity: 0.7 }}>Final Play:</span>
          {lastMoveDescription}
        </div>
      )}

      <button 
        onClick={() => setShowBoard(!showBoard)}
        style={{
          background: 'transparent',
          border: '1px solid #5a3a20',
          color: '#888',
          padding: '8px 16px',
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'all 0.2s',
        }}
      >
        {showBoard ? '← Back to Scores' : 'Review Board'}
      </button>

      {showBoard ? (
        <div style={{ 
          width: '100%', 
          maxWidth: 600,
          height: '60vh', 
          border: '2px solid #333', 
          borderRadius: 16, 
          overflow: 'hidden',
          background: '#1a0a00'
        }}>
          <GameScreen frozen />
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', justifyContent: 'center', animation: 'fadeIn 0.5s ease-out' }}>
          {([0, 1] as const).map(p => (
            <ScoreCard 
              key={p}
              playerIndex={p}
              playerState={state.players[p]}
              camelWinner={camelWinner}
              isWinner={sealAwardedTo === p}
              roundTotal={scores[p]}
              name={p === 0 ? p0Name : p1Name}
              totalSeals={totalSeals}
              currentSeals={currentSealsFor(p)}
              // Graceful when the reveal is absent (older server mid-deploy,
              // or a non-online mode where oppIndex is null): undefined here
              // makes ScoreCard fall back to its current placeholder-sum
              // behavior (which is already 0 for a redacted opponent).
              bonusPointsOverride={p === oppIndex ? (onlineView?.lastRoundReveal?.bonusPoints[p] ?? undefined) : undefined}
            />
          ))}
        </div>
      )}

      <button onClick={handleContinue} style={{
        marginTop: 10,
        padding: '16px 48px', fontSize: 18, fontWeight: 900,
        background: 'linear-gradient(to bottom, #305040, #203828)',
        color: '#f0e8d8',
        border: '2px solid #60c040', borderRadius: 12, cursor: 'pointer',
        textTransform: 'uppercase',
        letterSpacing: 1,
      }}>
        Continue
      </button>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}

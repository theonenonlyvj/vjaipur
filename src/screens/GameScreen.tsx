import { useState, useRef, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import { MarketRow } from '../components/MarketRow'
import { HandRow } from '../components/HandRow'
import { OpponentStrip } from '../components/OpponentStrip'
import { TokenRail } from '../components/TokenRail'
import { StatusBar } from '../components/StatusBar'
import { ActionBar } from '../components/ActionBar'
import { Toast } from '../components/Toast'
import { DisconnectBanner } from '../components/DisconnectBanner'
import { MuteButton } from '../components/MuteButton'
import { BonusReveal } from '../components/BonusReveal'
import { TutorialOverlay } from '../components/TutorialOverlay'
import { useSoundEffects } from '../hooks/useSoundEffects'
import type { Good } from '../engine'

export interface GameScreenProps {
  frozen?: boolean
}

export function GameScreen({ frozen = false }: GameScreenProps) {
  const { state, mode, error, dispatch, clearError, onlinePlayerIndex, aiThinking, lastMoveDescription, tutorial, endTutorial, playerName, opponentName } = useGameStore()

  const [selMarket, setSelMarket] = useState<number[]>([])
  const [selHand, setSelHand] = useState<number[]>([])
  const [showBonusReveal, setShowBonusReveal] = useState(false)
  const prevBonusCountRef = useRef(0)

  // myIndex must be stable before guards (needed by hooks below)
  const myIndex: 0 | 1 = mode === 'vs-ai' ? 0 : mode === 'online' ? (onlinePlayerIndex ?? 0) : (state?.activePlayer ?? 0)

  useSoundEffects(myIndex)

  useEffect(() => {
    if (!state || frozen) return
    const count = state.players[myIndex].bonusTokens.length
    if (count > prevBonusCountRef.current) setShowBonusReveal(true)
    prevBonusCountRef.current = count
  }, [state?.players[myIndex]?.bonusTokens.length, myIndex, frozen])

  if (!state) return <Navigate to="/" replace />
  if (!frozen) {
    if (state.phase === 'round-end') return <Navigate to="/round-end" replace />
    if (state.phase === 'game-over') return <Navigate to="/game-over" replace />
  }

  const opponentIndex: 0 | 1 = myIndex === 0 ? 1 : 0
  const myPlayer = state.players[myIndex]
  const opponentPlayer = state.players[opponentIndex]
  const isMyTurn = !frozen && state.activePlayer === myIndex
  const camelsUsed = selHand.filter(i => i === -1).length
  const inExchange = selMarket.filter(i => state.market[i]?.type !== 'camel').length >= 2

  function clearSelection() {
    if (frozen) return
    setSelMarket([])
    setSelHand([])
  }

  function handleTakeCamels() {
    if (frozen || !isMyTurn) return
    dispatch({ type: 'TAKE_CAMELS' })
    clearSelection()
  }

  function handleTake() {
    if (frozen || !isMyTurn || selMarket.length !== 1) return
    dispatch({ type: 'TAKE_SINGLE', marketIndex: selMarket[0] })
    clearSelection()
  }

  function handleToggleMarket(i: number) {
    if (frozen || !state) return
    const card = state.market[i]
    if (!card) return

    setSelMarket(prev => {
      if (card.type === 'camel') {
        const isAlreadySelected = prev.includes(i)
        if (isAlreadySelected) {
          return prev.filter(idx => state.market[idx].type !== 'camel')
        } else {
          setSelHand([])
          return state.market
            .map((c, idx) => (c.type === 'camel' ? idx : -1))
            .filter(idx => idx !== -1)
        }
      } else {
        const isAlreadySelected = prev.includes(i)
        let next: number[]
        if (isAlreadySelected) {
          next = prev.filter(x => x !== i)
        } else {
          const filtered = prev.filter(idx => state.market[idx].type !== 'camel')
          next = [...filtered, i]
        }
        // If not enough cards for exchange, or selecting first card, clear hand
        if (next.length < 2) setSelHand([])
        return next
      }
    })
  }

  function handleToggleHand(i: number) {
    if (frozen || !state) return
    const myPlayer = state.players[myIndex]
    const card = myPlayer.hand[i]
    if (!card) return

    setSelHand(prev => {
      const isAlreadySelected = prev.includes(i)

      if (isAlreadySelected) {
        return prev.filter(x => x !== i)
      } else {
        // If we're not currently in an exchange (market selection < 2),
        // then clicking hand cards should clear any market selection and select all of this type
        if (selMarket.length < 2) {
          setSelMarket([])
          const sameTypeIndices = myPlayer.hand
            .map((c, idx) => (c.type === card.type ? idx : -1))
            .filter(idx => idx !== -1)
          return sameTypeIndices
        } else {
          // Exchange mode: just toggle this one
          return [...prev, i]
        }
      }
    })
  }

  function handleUseHerdCamel() {
    if (frozen) return
    setSelHand(prev => [...prev, -1])
  }

  function handleRemoveCamel() {
    if (frozen) return
    setSelHand(prev => {
      const idx = prev.lastIndexOf(-1)
      if (idx === -1) return prev
      return [...prev.slice(0, idx), ...prev.slice(idx + 1)]
    })
  }

  function handleConfirmExchange() {
    if (frozen) return
    dispatch({ type: 'TAKE_EXCHANGE', marketIndices: selMarket, handIndices: selHand })
    clearSelection()
  }

  function handleSell(good: Good, quantity: number) {
    if (frozen) return
    dispatch({ type: 'SELL', good, quantity })
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 12,
      padding: frozen ? 0 : 16, maxWidth: 620, margin: '0 auto',
      height: '100%', overflowY: 'auto',
      pointerEvents: frozen ? 'none' : 'auto',
      opacity: frozen ? 0.8 : 1,
      background: 'radial-gradient(circle at center, #1a120a 0%, #050505 100%)',
      color: '#fff',
    }}>
      {!frozen && <DisconnectBanner />}
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#666', fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '1px' }}>
        <span>Round {state.round}</span>
        <span style={{ color: '#d0a860' }}>
          P1 {'★'.repeat(state.seals[0])}{'☆'.repeat(2 - state.seals[0])}
          {' · '}
          P2 {'★'.repeat(state.seals[1])}{'☆'.repeat(2 - state.seals[1])}
        </span>
        <span>Deck: {state.deck.length}</span>
        {!frozen && <MuteButton />}
      </div>

      <OpponentStrip
        player={opponentPlayer}
        playerIndex={opponentIndex}
        isActive={!frozen && state.activePlayer === opponentIndex}
        name={mode === 'online' ? opponentName : null}
      />

      <TokenRail tokens={state.tokens} bonusTokens={state.bonusTokens} />

      <div>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
          Market
        </div>
        <MarketRow
          market={state.market}
          selectedIndices={selMarket}
          onToggleSelect={handleToggleMarket}
        />
      </div>

      {!frozen && (
        <ActionBar
          state={state}
          playerIndex={myIndex}
          selMarketIndices={selMarket}
          selHandIndices={selHand}
          onTakeCamels={handleTakeCamels}
          onTake={handleTake}
          onConfirmExchange={handleConfirmExchange}
          onClearSelection={clearSelection}
          onSell={handleSell}
          onUpdateHandSelection={setSelHand}
        />
      )}

      {(aiThinking || lastMoveDescription) && (
        <div style={{ textAlign: 'center', color: '#f0c030', fontSize: 14, fontStyle: 'italic' }}>
          {aiThinking
            ? 'AI is thinking…'
            : `${mode === 'vs-ai' ? 'AI' : mode === 'online' ? (opponentName || 'Opponent') : `Player ${opponentIndex + 1}`}: ${lastMoveDescription}`
          }
        </div>
      )}

      <div>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
          Your Hand
        </div>
        <HandRow
          hand={myPlayer.hand}
          inExchange={inExchange}
          selectedIndices={selHand}
          camelsUsed={camelsUsed}
          herd={myPlayer.herd}
          onToggleSelect={handleToggleHand}
          onUseHerdCamel={handleUseHerdCamel}
          onRemoveCamel={handleRemoveCamel}
        />
      </div>

      <StatusBar
        player={myPlayer}
        playerIndex={myIndex}
        isActive={isMyTurn}
        name={mode === 'online' ? playerName || null : null}
      />

      {!frozen && <Toast message={error?.message ?? null} onDismiss={clearError} />}

      {!frozen && tutorial && <TutorialOverlay onDone={endTutorial} />}
    </div>
  )
}

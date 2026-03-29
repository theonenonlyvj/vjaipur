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
import { useSoundEffects } from '../hooks/useSoundEffects'
import type { Good } from '../engine'

export function GameScreen() {
  const { state, mode, error, dispatch, clearError, onlinePlayerIndex, aiThinking, lastMoveDescription } = useGameStore()

  const [exchangeMode, setExchangeMode] = useState(false)
  const [selMarket, setSelMarket] = useState<number[]>([])
  const [selHand, setSelHand] = useState<number[]>([])
  const [showBonusReveal, setShowBonusReveal] = useState(false)
  const prevBonusCountRef = useRef(0)

  // myIndex must be stable before guards (needed by hooks below)
  const myIndex: 0 | 1 = mode === 'vs-ai' ? 0 : mode === 'online' ? (onlinePlayerIndex ?? 0) : (state?.activePlayer ?? 0)

  useSoundEffects(myIndex)

  useEffect(() => {
    if (!state) return
    const count = state.players[myIndex].bonusTokens.length
    if (count > prevBonusCountRef.current) setShowBonusReveal(true)
    prevBonusCountRef.current = count
  }, [state?.players[myIndex]?.bonusTokens.length, myIndex])

  if (!state) return <Navigate to="/" replace />
  if (state.phase === 'round-end') return <Navigate to="/round-end" replace />
  if (state.phase === 'game-over') return <Navigate to="/game-over" replace />

  const opponentIndex: 0 | 1 = myIndex === 0 ? 1 : 0
  const myPlayer = state.players[myIndex]
  const opponentPlayer = state.players[opponentIndex]
  const isMyTurn = state.activePlayer === myIndex
  const camelsUsed = selHand.filter(i => i === -1).length

  function handleTakeSingle(marketIndex: number) {
    if (!isMyTurn) return
    dispatch({ type: 'TAKE_SINGLE', marketIndex })
  }

  function handleTakeCamels() {
    if (!isMyTurn) return
    dispatch({ type: 'TAKE_CAMELS' })
  }

  function handleToggleMarket(i: number) {
    setSelMarket(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i])
  }

  function handleToggleHand(i: number) {
    setSelHand(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i])
  }

  function handleUseHerdCamel() {
    setSelHand(prev => [...prev, -1])
  }

  function handleRemoveCamel() {
    setSelHand(prev => {
      const idx = prev.lastIndexOf(-1)
      if (idx === -1) return prev
      return [...prev.slice(0, idx), ...prev.slice(idx + 1)]
    })
  }

  function handleStartExchange() {
    setExchangeMode(true)
    setSelMarket([])
    setSelHand([])
  }

  function handleCancelExchange() {
    setExchangeMode(false)
    setSelMarket([])
    setSelHand([])
  }

  function handleConfirmExchange() {
    dispatch({ type: 'TAKE_EXCHANGE', marketIndices: selMarket, handIndices: selHand })
    setExchangeMode(false)
    setSelMarket([])
    setSelHand([])
  }

  function handleSell(good: Good, quantity: number) {
    dispatch({ type: 'SELL', good, quantity })
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 10,
      padding: 16, maxWidth: 620, margin: '0 auto',
      height: '100%', overflowY: 'auto',
    }}>
      <DisconnectBanner />
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#888', fontSize: 12 }}>
        <span>Round {state.round}</span>
        <span>
          P1 {'★'.repeat(state.seals[0])}{'☆'.repeat(2 - state.seals[0])}
          {' · '}
          P2 {'★'.repeat(state.seals[1])}{'☆'.repeat(2 - state.seals[1])}
        </span>
        <span>Deck: {state.deck.length}</span>
        <MuteButton />
      </div>

      <OpponentStrip
        player={opponentPlayer}
        playerIndex={opponentIndex}
        isActive={state.activePlayer === opponentIndex}
      />

      <TokenRail tokens={state.tokens} bonusTokens={state.bonusTokens} />

      <div>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
          Market
        </div>
        <MarketRow
          market={state.market}
          exchangeMode={exchangeMode}
          selectedIndices={selMarket}
          onTakeSingle={handleTakeSingle}
          onToggleSelect={handleToggleMarket}
        />
      </div>

      <ActionBar
        state={state}
        playerIndex={myIndex}
        exchangeMode={exchangeMode}
        selMarketCount={selMarket.length}
        selHandCount={selHand.length}
        onTakeCamels={handleTakeCamels}
        onStartExchange={handleStartExchange}
        onConfirmExchange={handleConfirmExchange}
        onCancelExchange={handleCancelExchange}
        onSell={handleSell}
      />

      {aiThinking && (
        <div style={{ textAlign: 'center', color: '#f0c030', fontSize: 14, fontStyle: 'italic' }}>
          AI is thinking…
        </div>
      )}

      <div>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
          Your Hand
        </div>
        <HandRow
          hand={myPlayer.hand}
          exchangeMode={exchangeMode}
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
      />

      <Toast message={error?.message ?? null} onDismiss={clearError} />
    </div>
  )
}

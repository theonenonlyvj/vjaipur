import { useState, useRef, useEffect, type CSSProperties } from 'react'
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
import { RulesModal } from '../components/RulesModal'
import { useSoundEffects } from '../hooks/useSoundEffects'
import type { Good } from '../engine'

export interface GameScreenProps {
  frozen?: boolean
}

/** Deck-count warning color (a round ends the instant the deck empties, so a
 *  shrinking deck is a real "wrap it up" signal): amber at <=6 remaining,
 *  red+bold at <=3, unchanged otherwise. Same weight (800) for both warning
 *  tiers — only the color escalates. */
function deckCountStyle(remaining: number): CSSProperties {
  if (remaining <= 3) return { color: '#e05050', fontWeight: 800 }
  if (remaining <= 6) return { color: '#f09030', fontWeight: 800 }
  return {}
}

export function GameScreen({ frozen = false }: GameScreenProps) {
  const { state, mode, error, dispatch, clearError, onlinePlayerIndex, aiThinking, lastMoveDescription, tutorial, endTutorial, playerName, opponentName, matchLength } = useGameStore()

  // Selection is keyed by stable Card.id, NOT array index — indices shift or
  // re-point whenever the market/hand array changes shape underneath them
  // (see engine.ts's takeCamels compaction, takeSingle's in-place patch).
  // Card.id is stable across state copies in both vs-ai/local (setup.ts's
  // per-round counter; applyAction moves object references, never rewrites
  // .id) and online (worker/src/do/view.ts sends state.market/me.hand
  // verbatim — the same shared engine, not resynthesized).
  const [selMarketIds, setSelMarketIds] = useState<number[]>([])
  const [selHandCardIds, setSelHandCardIds] = useState<number[]>([])
  const [camelsFromHerd, setCamelsFromHerd] = useState(0) // herd camels have no Card/id — a plain offered-count
  const [showRules, setShowRules] = useState(false)
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

  // Resolve stored ids against the CURRENT market/hand. A vanished id simply
  // drops out — except: if this was a genuine multi-card Exchange in progress
  // (selMarketIds.length >= 2) and ANY of those ids no longer resolves, drop
  // the WHOLE selection (market + hand + herd offer) rather than silently
  // narrowing into a smaller/different action the user never chose (e.g. a
  // 2-good Exchange collapsing into a 1-good Take). This is the invariant
  // that guarantees the app never dispatches a different move than intended.
  const resolvedMarketIdx = selMarketIds.map(id => state.market.findIndex(c => c.id === id))
  // A CAMEL selection is exempt from the broken-exchange collapse below and
  // instead self-heals to the whole herd: TAKE_CAMELS is all-or-nothing, so
  // selecting camels means "the herd on offer", not those specific cards.
  // 2026-08-03 bug: preselect 3 camels during the bot's turn, the bot's
  // exchange GIVES 2 camels to the market — only the original 3 stayed
  // highlighted (the move itself was still correct). Re-deriving the group
  // from the live market every render keeps the highlight honest whether
  // camels were added (opponent gave) or all taken (selection empties out).
  const selectedACamel = selMarketIds.length > 0 && resolvedMarketIdx.some(idx => state.market[idx]?.type === 'camel')
  const marketSelectionBroken = !selectedACamel && selMarketIds.length >= 2 && resolvedMarketIdx.includes(-1)
  const selMarket = selectedACamel
    ? state.market.map((c, i) => (c.type === 'camel' ? i : -1)).filter(i => i !== -1)
    : marketSelectionBroken ? [] : resolvedMarketIdx.filter(idx => idx !== -1)

  const selHandReal = marketSelectionBroken
    ? []
    : selHandCardIds.map(id => myPlayer.hand.findIndex(c => c.id === id)).filter(idx => idx !== -1)
  const camelsOffered = marketSelectionBroken ? 0 : Math.min(camelsFromHerd, myPlayer.herd)
  const selHand = [...selHandReal, ...Array(camelsOffered).fill(-1)]

  const camelsUsed = selHand.filter(i => i === -1).length
  const inExchange = selMarket.filter(i => state.market[i]?.type !== 'camel').length >= 2

  function clearSelection() {
    if (frozen) return
    setSelMarketIds([])
    setSelHandCardIds([])
    setCamelsFromHerd(0)
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

    if (card.type === 'camel') {
      const isAlreadySelected = selMarket.includes(i)
      if (isAlreadySelected) {
        // selMarket only ever holds all-camel indices while in this branch,
        // so deselecting one clears the whole camel group (unchanged from today).
        setSelMarketIds([])
      } else {
        const allCamelIds = state.market.filter(c => c.type === 'camel').map(c => c.id)
        setSelHandCardIds([])
        setCamelsFromHerd(0)
        setSelMarketIds(allCamelIds)
      }
    } else {
      const isAlreadySelected = selMarket.includes(i)
      let nextIndices: number[]
      if (isAlreadySelected) {
        nextIndices = selMarket.filter(idx => idx !== i)
      } else {
        const filtered = selMarket.filter(idx => state.market[idx].type !== 'camel')
        nextIndices = [...filtered, i]
      }
      setSelMarketIds(nextIndices.map(idx => state.market[idx].id))
      // If not enough cards for exchange, or selecting first card, clear hand
      if (nextIndices.length < 2) {
        setSelHandCardIds([])
        setCamelsFromHerd(0)
      }
    }
  }

  function handleToggleHand(i: number) {
    if (frozen || !state) return
    const card = myPlayer.hand[i]
    if (!card) return

    const isAlreadySelected = selHandReal.includes(i)

    if (isAlreadySelected) {
      const next = selHandReal.filter(x => x !== i)
      setSelHandCardIds(next.map(idx => myPlayer.hand[idx].id))
    } else {
      // Fix for bug #2: gate on `inExchange` (already correctly excludes an
      // all-camels market selection), not raw selMarket.length — a camel
      // group-select is always length>=2 but is NEVER a real exchange.
      if (!inExchange) {
        setSelMarketIds([])
        setCamelsFromHerd(0)
        const sameTypeIndices = myPlayer.hand
          .map((c, idx) => (c.type === card.type ? idx : -1))
          .filter(idx => idx !== -1)
        setSelHandCardIds(sameTypeIndices.map(idx => myPlayer.hand[idx].id))
      } else {
        // Exchange mode: just add this one
        setSelHandCardIds([...selHandReal, i].map(idx => myPlayer.hand[idx].id))
      }
    }
  }

  function handleUseHerdCamel() {
    if (frozen) return
    setCamelsFromHerd(p => Math.min(p + 1, myPlayer.herd))
  }

  function handleRemoveCamel() {
    if (frozen) return
    setCamelsFromHerd(p => Math.max(p - 1, 0))
  }

  function handleConfirmExchange() {
    if (frozen) return
    dispatch({ type: 'TAKE_EXCHANGE', marketIndices: selMarket, handIndices: selHand })
    clearSelection()
  }

  function handleUpdateHandSelection(indices: number[]) {
    // ActionBar's sell +/- stepper computes fresh indices off player.hand in
    // the SAME render (ActionBar.tsx:56-73) — convert straight back to ids.
    setSelHandCardIds(indices.map(idx => myPlayer.hand[idx].id))
  }

  function handleSell(good: Good, quantity: number) {
    if (frozen) return
    dispatch({ type: 'SELL', good, quantity })
  }

  function handleResign() {
    // Resign is the deliberate "give up" affordance — distinct from the
    // DisconnectBanner's "Leave & resume later" (which only appears once the
    // OPPONENT has gone away: steps away, nothing lost, game stays saved) and
    // "Claim win" (only offered to the OTHER player once I've genuinely gone
    // dark). Resigning here ends the match immediately, on purpose, right now.
    if (window.confirm("Resign this match? Your opponent wins immediately and the match ends — this can't be undone.")) {
      void useGameStore.getState().resignMatch()
    }
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
          P1 {'★'.repeat(state.seals[0])}{'☆'.repeat((Math.floor(matchLength / 2) + 1) - state.seals[0])}
          {' · '}
          P2 {'★'.repeat(state.seals[1])}{'☆'.repeat((Math.floor(matchLength / 2) + 1) - state.seals[1])}
        </span>
        {!frozen && (
          <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {mode === 'online' && (
              <button
                onClick={handleResign}
                aria-label="Resign match"
                title="Resign match"
                style={{ background: 'none', border: 'none', color: '#888', fontSize: 16, cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}
              >
                🏳️
              </button>
            )}
            <button
              onClick={() => setShowRules(true)}
              aria-label="Rules"
              title="How to Play"
              style={{ background: 'none', border: 'none', color: '#f0c030', fontSize: 16, cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}
            >
              📖
            </button>
            <MuteButton />
          </span>
        )}
      </div>

      <OpponentStrip
        player={opponentPlayer}
        playerIndex={opponentIndex}
        isActive={!frozen && state.activePlayer === opponentIndex}
        name={mode === 'online' ? opponentName : null}
      />

      <TokenRail tokens={state.tokens} bonusTokens={state.bonusTokens} />

      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>
            Market
          </span>
          <span style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1, ...deckCountStyle(state.deck.length) }}>
            Deck: {state.deck.length}
          </span>
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
          onUpdateHandSelection={handleUpdateHandSelection}
        />
      )}

      {(aiThinking || lastMoveDescription) && (
        <div style={{ textAlign: 'center', color: '#f0c030', fontSize: 14, fontStyle: 'italic', minHeight: '20px', opacity: 0.8 }}>
          {aiThinking
            ? 'Bot is thinking…'
            : lastMoveDescription}
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

      {!frozen && <BonusReveal show={showBonusReveal} onDone={() => setShowBonusReveal(false)} />}

      {!frozen && tutorial && <TutorialOverlay onDone={endTutorial} />}
      {!frozen && showRules && <RulesModal onClose={() => setShowRules(false)} />}
    </div>
  )
}

import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { GameState, Good, CardType } from '../engine'

const PRECIOUS = new Set<Good>(['diamond', 'gold', 'silver'])
const GOODS: Good[] = ['diamond', 'gold', 'silver', 'cloth', 'spice', 'leather']

interface Props {
  state: GameState
  playerIndex: 0 | 1
  selMarketIndices: number[]
  selHandCount: number
  onTakeCamels: () => void
  onTake: () => void              // take the single selected market card
  onConfirmExchange: () => void
  onClearSelection: () => void
  onSell: (good: Good, qty: number) => void
}

export function ActionBar({
  state, playerIndex,
  selMarketIndices, selHandCount,
  onTakeCamels, onTake, onConfirmExchange, onClearSelection, onSell,
}: Props) {
  const [sellGood, setSellGood] = useState<Good | null>(null)
  const [sellQty, setSellQty] = useState(1)

  const player = state.players[playerIndex]
  const isMyTurn = state.activePlayer === playerIndex

  const goodCounts = new Map<Good, number>()
  for (const card of player.hand) {
    if (card.type === 'camel') continue
    const g = card.type as Good
    goodCounts.set(g, (goodCounts.get(g) ?? 0) + 1)
  }

  const hasCamels = state.market.some(c => c.type === 'camel')
  const selMarketCount = selMarketIndices.length
  const canConfirmExchange = selMarketCount >= 2 && selMarketCount === selHandCount
  const selMarketTypes: CardType[] = selMarketIndices.map(i => state.market[i]?.type ?? 'leather')

  function openSell(good: Good) {
    const count = goodCounts.get(good) ?? 0
    const min = PRECIOUS.has(good) ? 2 : 1
    setSellGood(good)
    setSellQty(count >= min ? count : min)
  }

  function confirmSell() {
    if (!sellGood) return
    onSell(sellGood, sellQty)
    setSellGood(null)
  }

  if (!isMyTurn) {
    return (
      <div style={barStyle}>
        <span style={{ color: '#888' }}>Waiting for opponent…</span>
      </div>
    )
  }

  // Sell quantity picker
  if (sellGood) {
    const count = goodCounts.get(sellGood) ?? 0
    const min = PRECIOUS.has(sellGood) ? 2 : 1
    return (
      <div style={barStyle}>
        <span style={{ color: '#f0e8d8' }}>Sell {sellGood}:</span>
        <button onClick={() => setSellQty(q => Math.max(min, q - 1))} style={smallBtn}>−</button>
        <span style={{ minWidth: 24, textAlign: 'center', fontWeight: 700, fontSize: 16 }}>{sellQty}</span>
        <button onClick={() => setSellQty(q => Math.min(count, q + 1))} style={smallBtn}>+</button>
        <button onClick={confirmSell} style={{ ...actionBtn, background: '#306010', borderColor: '#60c040' }}>
          Confirm Sell
        </button>
        <button onClick={() => setSellGood(null)} style={cancelBtn}>Cancel</button>
      </div>
    )
  }

  // --- Context button (slot 2 of row 1) ---
  let contextBtn: React.ReactNode = null
  const allCamels = selMarketCount > 0 && selMarketTypes.every(t => t === 'camel')

  if (allCamels) {
    contextBtn = (
      <button
        onClick={onTakeCamels}
        style={{
          ...actionBtn,
          flex: 1,
          background: '#3a3010',
          borderColor: '#d0a860',
        }}
      >
        Take Camels
      </button>
    )
  } else if (selMarketCount === 1) {
    const goodName = selMarketTypes[0] !== 'camel' ? selMarketTypes[0] : null
    if (goodName) {
      const wouldExceedLimit = player.hand.length >= 7
      contextBtn = (
        <button
          onClick={onTake}
          disabled={wouldExceedLimit}
          style={{
            ...actionBtn,
            flex: 1,
            background: wouldExceedLimit ? '#2a2a2a' : '#1a3050',
            borderColor: wouldExceedLimit ? '#444' : '#60a0f0',
            cursor: wouldExceedLimit ? 'not-allowed' : 'pointer',
            opacity: wouldExceedLimit ? 0.5 : 1,
          }}
        >
          Take {goodName}
        </button>
      )
    }
  } else if (selMarketCount >= 2) {
    const need = selMarketCount - selHandCount
    const label = canConfirmExchange
      ? `Exchange ${selMarketCount}↔${selHandCount}`
      : `Exchange (need ${need} more)`
    contextBtn = (
      <button
        onClick={onConfirmExchange}
        disabled={!canConfirmExchange}
        style={{
          ...actionBtn,
          flex: 1,
          background: canConfirmExchange ? '#305040' : '#2a2a2a',
          borderColor: canConfirmExchange ? '#60c040' : '#444',
          cursor: canConfirmExchange ? 'pointer' : 'not-allowed',
          opacity: canConfirmExchange ? 1 : 0.6,
        }}
      >
        {label}
      </button>
    )
  }

  return (
    <div style={barStyle}>
      {/* Row 1: fixed-position primary actions */}
      <div style={{ display: 'flex', gap: 8, width: '100%', alignItems: 'center' }}>
        {contextBtn || (
          <div style={{ flex: 1, color: '#666', fontSize: 13, textAlign: 'center', fontStyle: 'italic' }}>
            Select from Market
          </div>
        )}

        {selMarketCount > 0 && (
          <button onClick={onClearSelection} style={{ ...cancelBtn, whiteSpace: 'nowrap' }}>
            ✕ Clear
          </button>
        )}
      </div>

      {/* Row 2: sell buttons — always rendered in fixed order */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6, width: '100%' }}>
        {GOODS.map(good => {
          const count = goodCounts.get(good) ?? 0
          const min = PRECIOUS.has(good) ? 2 : 1
          const canSell = count >= min
          return (
            <button
              key={good}
              onClick={canSell ? () => openSell(good) : undefined}
              disabled={!canSell}
              style={{
                ...sellBtn,
                opacity: canSell ? 1 : 0.25,
                cursor: canSell ? 'pointer' : 'default',
              }}
            >
              <span style={{ fontSize: 10, display: 'block', color: '#aaa', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {good.slice(0, 4)}
              </span>
              <span style={{ fontWeight: 700, fontSize: 13 }}>
                {canSell ? `×${count}` : '–'}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

const barStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 8,
  padding: '10px 12px', background: '#1f1000', borderRadius: 8,
}

const actionBtn: CSSProperties = {
  padding: '8px 14px', background: '#3a2010', color: '#f0e8d8',
  border: '1px solid #f0c030', borderRadius: 6, cursor: 'pointer',
  fontSize: 13, fontWeight: 600,
}

const smallBtn: CSSProperties = {
  padding: '4px 12px', background: '#2a1800', color: '#f0e8d8',
  border: '1px solid #5a3a20', borderRadius: 4, cursor: 'pointer', fontSize: 18,
}

const cancelBtn: CSSProperties = {
  padding: '8px 14px', background: '#3a1010', color: '#f0e8d8',
  border: '1px solid #ff4060', borderRadius: 6, cursor: 'pointer', fontSize: 13,
}

const sellBtn: CSSProperties = {
  padding: '6px 4px', background: '#304020', color: '#f0e8d8',
  border: '1px solid #60c040', borderRadius: 6,
  fontSize: 13, textAlign: 'center',
}

import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { GameState, Good } from '../engine'

const PRECIOUS = new Set<Good>(['diamond', 'gold', 'silver'])
const GOODS: Good[] = ['diamond', 'gold', 'silver', 'cloth', 'spice', 'leather']

interface Props {
  state: GameState
  playerIndex: 0 | 1
  exchangeMode: boolean
  selMarketCount: number
  selHandCount: number
  onTakeCamels: () => void
  onStartExchange: () => void
  onConfirmExchange: () => void
  onCancelExchange: () => void
  onSell: (good: Good, qty: number) => void
}

export function ActionBar({
  state, playerIndex, exchangeMode,
  selMarketCount, selHandCount,
  onTakeCamels, onStartExchange, onConfirmExchange, onCancelExchange, onSell,
}: Props) {
  const [sellGood, setSellGood] = useState<Good | null>(null)
  const [sellQty, setSellQty] = useState(1)

  const player = state.players[playerIndex]
  const isMyTurn = state.activePlayer === playerIndex

  // Count goods in hand (excluding camels)
  const goodCounts = new Map<Good, number>()
  for (const card of player.hand) {
    if (card.type === 'camel') continue
    const g = card.type as Good
    goodCounts.set(g, (goodCounts.get(g) ?? 0) + 1)
  }

  const hasCamels = state.market.some(c => c.type === 'camel')
  const canExchange = state.market.some(c => c.type !== 'camel')
  const canConfirm = selMarketCount >= 2 && selMarketCount === selHandCount

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

  if (exchangeMode) {
    return (
      <div style={barStyle}>
        <span style={{ color: '#888', fontSize: 13 }}>Select ≥2 market goods, then match with hand cards / camels</span>
        <span style={{ color: selMarketCount === selHandCount ? '#60c040' : '#ff6040', fontSize: 12, fontWeight: 700 }}>
          Market: {selMarketCount} / Return: {selHandCount}
        </span>
        <button
          onClick={onConfirmExchange}
          disabled={!canConfirm}
          style={{ ...actionBtn, background: canConfirm ? '#305040' : '#2a2a2a', borderColor: canConfirm ? '#60c040' : '#444', cursor: canConfirm ? 'pointer' : 'not-allowed' }}
        >
          Confirm Exchange
        </button>
        <button onClick={onCancelExchange} style={cancelBtn}>Cancel</button>
      </div>
    )
  }

  return (
    <div style={barStyle}>
      {hasCamels && (
        <button onClick={onTakeCamels} style={{ ...actionBtn, background: '#3a3010', borderColor: '#d0a860' }}>
          Take Camels
        </button>
      )}
      {canExchange && (
        <button onClick={onStartExchange} style={actionBtn}>Exchange…</button>
      )}
      {GOODS.map(good => {
        const count = goodCounts.get(good) ?? 0
        const min = PRECIOUS.has(good) ? 2 : 1
        if (count < min) return null
        return (
          <button key={good} onClick={() => openSell(good)} style={{ ...actionBtn, background: '#304020', borderColor: '#60c040' }}>
            Sell {good} ×{count}
          </button>
        )
      })}
      {!hasCamels && !canExchange && goodCounts.size === 0 && (
        <span style={{ color: '#555', fontSize: 13 }}>No actions available</span>
      )}
    </div>
  )
}

const barStyle: CSSProperties = {
  display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
  padding: '10px 16px', background: '#1f1000', borderRadius: 8, minHeight: 56,
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

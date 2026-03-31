import type { CSSProperties } from 'react'
import type { GameState, Good, CardType } from '../engine'

const PRECIOUS = new Set<Good>(['diamond', 'gold', 'silver'])

interface Props {
  state: GameState
  playerIndex: 0 | 1
  selMarketIndices: number[]
  selHandIndices: number[]
  onTakeCamels: () => void
  onTake: () => void              // take the single selected market card
  onConfirmExchange: () => void
  onClearSelection: () => void
  onSell: (good: Good, qty: number) => void
  onUpdateHandSelection: (indices: number[]) => void
}

export function ActionBar({
  state, playerIndex,
  selMarketIndices, selHandIndices,
  onTakeCamels, onTake, onConfirmExchange, onClearSelection, onSell, onUpdateHandSelection,
}: Props) {
  const player = state.players[playerIndex]
  const isMyTurn = state.activePlayer === playerIndex

  const selMarketCount = selMarketIndices.length
  const selHandCount = selHandIndices.length
  const canConfirmExchange = selMarketCount >= 2 && selMarketCount === selHandCount
  const selMarketTypes: CardType[] = selMarketIndices.map(i => state.market[i]?.type ?? 'leather')

  if (!isMyTurn) {
    return (
      <div style={barStyle}>
        <span style={{ color: '#888' }}>Waiting for opponent…</span>
      </div>
    )
  }

  // --- Context button (slot 2 of row 1) ---
  let contextBtn: React.ReactNode = null
  const allCamels = selMarketCount > 0 && selMarketTypes.every(t => t === 'camel')

  // Card-click Sell logic
  const selHandGoods = selHandIndices.filter(i => i !== -1).map(i => player.hand[i])
  const selHandCamels = selHandIndices.filter(i => i === -1).length
  const uniqueHandGoods = Array.from(new Set(selHandGoods.map(c => c.type)))
  const onlyOneGoodSelected = uniqueHandGoods.length === 1 && selHandCamels === 0
  const selGoodToSell = uniqueHandGoods[0] as Good | undefined

  if (selHandCount > 0 && selMarketCount === 0) {
    if (onlyOneGoodSelected && selGoodToSell) {
      const min = PRECIOUS.has(selGoodToSell) ? 2 : 1
      const isValidQty = selHandCount >= min
      
      const allMatchingIndices = player.hand
        .map((c, idx) => c.type === selGoodToSell ? idx : -1)
        .filter(idx => idx !== -1)
      
      const handleMinus = () => {
        if (selHandCount > 1) {
          onUpdateHandSelection(selHandIndices.slice(0, -1))
        }
      }
      const handlePlus = () => {
        if (selHandCount < allMatchingIndices.length) {
          // Find an index of this type that isn't selected yet
          const nextIdx = allMatchingIndices.find(idx => !selHandIndices.includes(idx))
          if (nextIdx !== undefined) {
            onUpdateHandSelection([...selHandIndices, nextIdx])
          }
        }
      }

      contextBtn = (
        <div style={{ display: 'flex', gap: 8, flex: 1, alignItems: 'center' }}>
          <button onClick={handleMinus} disabled={selHandCount <= 1} style={smallBtn}>−</button>
          <button
            onClick={() => { onSell(selGoodToSell, selHandCount); onClearSelection() }}
            disabled={!isValidQty}
            style={{
              ...actionBtn,
              flex: 1,
              background: isValidQty ? '#306010' : '#2a2a2a',
              borderColor: isValidQty ? '#60c040' : '#444',
              opacity: isValidQty ? 1 : 0.6,
            }}
          >
            {isValidQty ? `Sell ${selHandCount} ${selGoodToSell}` : `Need ${min} ${selGoodToSell}`}
          </button>
          <button onClick={handlePlus} disabled={selHandCount >= allMatchingIndices.length} style={smallBtn}>+</button>
        </div>
      )
    } else {
      contextBtn = (
        <div style={{ flex: 1, color: '#888', fontSize: 13, textAlign: 'center', fontStyle: 'italic' }}>
          Select matching cards to sell
        </div>
      )
    }
  } else if (allCamels) {
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
      <div style={{ display: 'flex', gap: 8, width: '100%', alignItems: 'center' }}>
        {contextBtn || (
          <div style={{ flex: 1, color: '#666', fontSize: 13, textAlign: 'center', fontStyle: 'italic' }}>
            Select from Market or Hand
          </div>
        )}

        {(selMarketCount > 0 || selHandCount > 0) && (
          <button onClick={onClearSelection} style={{ ...cancelBtn, whiteSpace: 'nowrap' }}>
            ✕ Clear
          </button>
        )}
      </div>
    </div>
  )
}

const barStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 8,
  padding: '10px 12px',
  background: 'rgba(0, 0, 0, 0.4)',
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  borderRadius: 8,
  border: '1px solid rgba(255, 255, 255, 0.1)',
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

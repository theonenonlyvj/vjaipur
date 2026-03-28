import type { CSSProperties } from 'react'
import type { Card } from '../engine'
import { CardView } from './Card'

interface Props {
  hand: Card[]
  exchangeMode: boolean
  selectedIndices: number[]   // hand card indices; -1 entries = camels used from herd
  camelsUsed: number          // count of -1 entries in selectedIndices
  herd: number
  onToggleSelect: (i: number) => void
  onUseHerdCamel: () => void
  onRemoveCamel: () => void
}

export function HandRow({ hand, exchangeMode, selectedIndices, camelsUsed, herd, onToggleSelect, onUseHerdCamel, onRemoveCamel }: Props) {
  const availableCamels = herd - camelsUsed

  if (hand.length === 0 && !exchangeMode) {
    return (
      <div style={{ padding: '12px 0', color: '#888', textAlign: 'center', minHeight: 116 }}>
        No cards in hand
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center', padding: '8px 0', minHeight: 116, alignItems: 'center' }}>
      {hand.map((card, i) => {
        const selected = selectedIndices.includes(i)
        const handleClick = exchangeMode ? () => onToggleSelect(i) : undefined
        return (
          <CardView
            key={card.id}
            card={card}
            selected={selected}
            onClick={handleClick}
            size="md"
          />
        )
      })}
      {exchangeMode && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignSelf: 'center', marginLeft: 8 }}>
          <button
            onClick={onUseHerdCamel}
            disabled={availableCamels <= 0}
            style={{ ...camelBtnStyle, opacity: availableCamels <= 0 ? 0.4 : 1, cursor: availableCamels <= 0 ? 'not-allowed' : 'pointer' }}
          >
            Use Camel ({availableCamels} left)
          </button>
          {camelsUsed > 0 && (
            <button onClick={onRemoveCamel} style={{ ...camelBtnStyle, background: '#4a2010', borderColor: '#c08040' }}>
              Remove Camel ({camelsUsed})
            </button>
          )}
        </div>
      )}
    </div>
  )
}

const camelBtnStyle: CSSProperties = {
  padding: '8px 14px',
  background: '#5a4010',
  color: '#f0e8d8',
  border: '1px solid #d0a860',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
}

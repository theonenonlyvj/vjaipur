import { AnimatePresence } from 'framer-motion'
import type { Card } from '../engine'
import { CardView } from './Card'

interface Props {
  market: Card[]
  exchangeMode: boolean
  selectedIndices: number[]
  onTakeSingle: (i: number) => void
  onToggleSelect: (i: number) => void
}

export function MarketRow({ market, exchangeMode, selectedIndices, onTakeSingle, onToggleSelect }: Props) {
  return (
    <div style={{ display: 'flex', gap: 12, justifyContent: 'center', padding: '8px 0', flexWrap: 'wrap' }}>
      <AnimatePresence mode="popLayout">
        {market.map((card, i) => {
          const selected = selectedIndices.includes(i)
          const isCamel = card.type === 'camel'
          // Camels cannot be taken via TAKE_SINGLE or selected in exchange
          const handleClick = isCamel
            ? undefined
            : exchangeMode
              ? () => onToggleSelect(i)
              : () => onTakeSingle(i)
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
      </AnimatePresence>
    </div>
  )
}

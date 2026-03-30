import { AnimatePresence } from 'framer-motion'
import type { Card } from '../engine'
import { CardView } from './Card'

interface Props {
  market: Card[]
  selectedIndices: number[]
  onToggleSelect: (i: number) => void
}

export function MarketRow({ market, selectedIndices, onToggleSelect }: Props) {
  return (
    <div style={{ display: 'flex', gap: 12, justifyContent: 'center', padding: '8px 0', flexWrap: 'wrap' }}>
      <AnimatePresence mode="popLayout">
        {market.map((card, i) => (
          <CardView
            key={card.id}
            card={card}
            selected={selectedIndices.includes(i)}
            onClick={card.type === 'camel' ? undefined : () => onToggleSelect(i)}
            size="md"
          />
        ))}
      </AnimatePresence>
    </div>
  )
}

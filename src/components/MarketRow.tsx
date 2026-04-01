import { useState, useEffect } from 'react'
import { AnimatePresence } from 'framer-motion'
import type { Card } from '../engine'
import { CardView } from './Card'

interface Props {
  market: Card[]
  selectedIndices: number[]
  onToggleSelect: (i: number) => void
}

export function MarketRow({ market, selectedIndices, onToggleSelect }: Props) {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 480)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  return (
    <div style={{ display: 'flex', gap: isMobile ? 8 : 12, justifyContent: 'center', padding: '8px 0', flexWrap: 'wrap' }}>
      <AnimatePresence mode="popLayout">
        {market.map((card, i) => (
          <CardView
            key={card.id}
            card={card}
            selected={selectedIndices.includes(i)}
            onClick={() => onToggleSelect(i)}
            size="md"
          />
        ))}
      </AnimatePresence>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { AnimatePresence } from 'framer-motion'
import type { Card } from '../engine'
import { CardView } from './Card'
import { CamelStack } from './CamelStack'

interface Props {
  hand: Card[]
  inExchange: boolean
  selectedIndices: number[]
  camelsUsed: number
  herd: number
  onToggleSelect: (i: number) => void
  onUseHerdCamel: () => void
  onRemoveCamel: () => void
}

export function HandRow({ hand, inExchange, selectedIndices, camelsUsed, herd, onToggleSelect, onUseHerdCamel, onRemoveCamel }: Props) {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 480)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  if (hand.length === 0 && herd === 0) {
    return (
      <div style={{ padding: '12px 0', color: '#888', textAlign: 'center', minHeight: 116 }}>
        No cards in hand
      </div>
    )
  }

  return (
    // maxWidth caps the row at exactly FIVE md cards (5x75 + 4x12 = 423px) so
    // the hand wraps after slot 5 on EVERY viewport — matching the market's
    // 5 slots above and the layout a phone's width already forces (Vijay
    // 2026-08-05: "5 on row 1 to match the market, 6+7+camels on row 2").
    // Cards 6-7 and the herd stack flow onto row 2 via the existing wrap.
    <div data-testid="hand-row" style={{ display: 'flex', gap: isMobile ? 8 : 12, flexWrap: 'wrap', justifyContent: 'center', padding: '8px 0', minHeight: 116, alignItems: 'center', maxWidth: 423, marginInline: 'auto' }}>
      <AnimatePresence mode="popLayout">
        {hand.map((card, i) => {
          const selected = selectedIndices.includes(i)
          const handleClick = () => onToggleSelect(i)
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

      {herd > 0 && (
        <>
          {/* Subtle divider between hand cards and camel stack */}
          {hand.length > 0 && (
            <div style={{
              width: 1,
              height: 80,
              background: 'rgba(255,255,255,0.1)',
              alignSelf: 'center',
              marginLeft: 4,
              marginRight: 4,
              flexShrink: 0,
            }} />
          )}
          <CamelStack
            herd={herd}
            camelsUsed={camelsUsed}
            inExchange={inExchange}
            onUseHerdCamel={onUseHerdCamel}
            onRemoveCamel={onRemoveCamel}
          />
        </>
      )}
    </div>
  )
}

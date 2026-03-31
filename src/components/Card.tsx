import { motion } from 'framer-motion'
import type { Card, CardType } from '../engine'

const BG: Record<CardType, string> = {
  diamond: 'linear-gradient(135deg, #5a0010, #c0102a)',
  gold:    'linear-gradient(135deg, #5a3a00, #c08010)',
  silver:  'linear-gradient(135deg, #2a3040, #6a7a90)',
  cloth:   'linear-gradient(135deg, #2a0040, #7a20a0)',
  spice:   'linear-gradient(135deg, #0a2a00, #307820)',
  leather: 'linear-gradient(135deg, #2a1400, #7a4018)',
  camel:   'linear-gradient(135deg, #3a2a10, #907040)',
}

const ACCENT: Record<CardType, string> = {
  diamond: '#ff4060', gold: '#f0c030', silver: '#c0d0e0',
  cloth: '#c060e0', spice: '#60c040', leather: '#c08040', camel: '#d0a860',
}

interface Props {
  card: Card
  selected?: boolean
  onClick?: () => void
  size?: 'sm' | 'md'
}

export function CardView({ card, selected = false, onClick, size = 'md' }: Props) {
  const label = card.type.toUpperCase()
  const w = size === 'sm' ? 56 : 72
  const h = size === 'sm' ? 80 : 100
  return (
    <motion.div
      layoutId={`card-${card.id}`}
      layout
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{
        opacity: 1,
        scale: 1,
        y: selected ? -10 : 0,
      }}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      onClick={onClick}
      style={{
        width: w, height: h,
        background: `
          linear-gradient(45deg, rgba(255,255,255,0.03) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.03) 50%, rgba(255,255,255,0.03) 75%, transparent 75%, transparent),
          linear-gradient(-45deg, rgba(255,255,255,0.03) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.03) 50%, rgba(255,255,255,0.03) 75%, transparent 75%, transparent),
          ${BG[card.type]}
        `,
        backgroundSize: '4px 4px, 4px 4px, 100% 100%',
        border: selected ? '3px solid #fff' : `2px solid ${ACCENT[card.type]}`,
        borderRadius: 8,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: onClick ? 'pointer' : 'default',
        boxShadow: selected ? '0 10px 30px rgba(255, 255, 255, 0.4)' : '0 4px 12px rgba(0,0,0,0.2)',
        userSelect: 'none',
        flexShrink: 0,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Shine Highlight */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: '50%',
        background: 'linear-gradient(to bottom, rgba(255,255,255,0.1), transparent)',
        pointerEvents: 'none',
      }} />

      <span style={{
        color: '#fff',
        fontSize: size === 'sm' ? 10 : 12,
        fontWeight: 800,
        textAlign: 'center',
        letterSpacing: 1.5,
        pointerEvents: 'none',
        textShadow: '0 2px 4px rgba(0,0,0,0.3)',
      }}>
        {label}
      </span>
    </motion.div>
  )
}

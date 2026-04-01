import { motion } from 'framer-motion'
import type { Card, CardType } from '../engine'

const BG: Record<CardType, string> = {
  diamond: 'linear-gradient(135deg, #e6194b, #600000)',
  gold:    'linear-gradient(135deg, #f0c030, #806000)',
  silver:  'linear-gradient(135deg, #a9a9a9, #333)',
  cloth:   'linear-gradient(135deg, #911eb4, #300050)',
  spice:   'linear-gradient(135deg, #3cb44b, #004000)',
  leather: 'linear-gradient(135deg, #964b00, #301500)',
  camel:   'linear-gradient(135deg, #d0a860, #604010)',
}

// Map types to OpenMoji HEX codes or reliable SVG sources
const ICON_URLS: Record<CardType, string> = {
  diamond: 'https://raw.githubusercontent.com/hfg-gmuend/openmoji/master/color/svg/1F48E.svg',
  gold:    'https://raw.githubusercontent.com/hfg-gmuend/openmoji/master/color/svg/1F4B0.svg',
  silver:  'https://raw.githubusercontent.com/hfg-gmuend/openmoji/master/color/svg/2694.svg',
  cloth:   'https://raw.githubusercontent.com/hfg-gmuend/openmoji/master/color/svg/1F457.svg',
  spice:   'https://raw.githubusercontent.com/hfg-gmuend/openmoji/master/color/svg/1F33F.svg',
  leather: 'https://raw.githubusercontent.com/hfg-gmuend/openmoji/master/color/svg/1F45E.svg',
  camel:   'https://raw.githubusercontent.com/hfg-gmuend/openmoji/master/color/svg/1F42A.svg',
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
  const w = size === 'sm' ? 58 : 75
  const h = size === 'sm' ? 82 : 105
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
        background: BG[card.type],
        border: selected ? '3px solid #fff' : '1.5px solid rgba(255,255,255,0.15)',
        borderRadius: 10,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        cursor: onClick ? 'pointer' : 'default',
        boxShadow: selected ? '0 0 30px rgba(240, 192, 48, 0.6)' : '0 6px 15px rgba(0,0,0,0.8)',
        userSelect: 'none',
        flexShrink: 0,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Linen Texture Overlay */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        backgroundImage: "url('https://www.transparenttextures.com/patterns/linen.png')",
        opacity: 0.25,
        pointerEvents: 'none',
        zIndex: 1,
      }} />

      <div style={{
        zIndex: 2,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: size === 'sm' ? 4 : 8,
      }}>
        <img 
          src={ICON_URLS[card.type]} 
          alt={card.type}
          style={{
            width: size === 'sm' ? 24 : 36,
            height: size === 'sm' ? 24 : 36,
            filter: 'drop-shadow(0 0 8px rgba(255,255,255,0.2))',
            marginBottom: size === 'sm' ? 2 : 6,
            pointerEvents: 'none',
          }}
        />
        <span style={{
          color: card.type === 'gold' && selected ? '#000' : 'rgba(255,255,255,0.9)',
          fontSize: size === 'sm' ? 6 : 8,
          fontWeight: 900,
          textAlign: 'center',
          letterSpacing: 1.5,
          pointerEvents: 'none',
          textShadow: card.type === 'gold' && selected ? 'none' : '0 2px 4px rgba(0,0,0,0.5)',
        }}>
          {label}
        </span>
      </div>
    </motion.div>
  )
}

import { motion } from 'framer-motion'
import { useState, useEffect } from 'react'
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

// Map types to OpenMoji HEX codes. Bundled locally in public/assets/cards/
// (previously hotlinked from raw.githubusercontent.com — see docs/assets.md).
const ICON_URLS: Record<CardType, string> = {
  diamond: '/assets/cards/1F48E.svg',
  gold:    '/assets/cards/1F4B0.svg',
  silver:  '/assets/cards/2694.svg',
  cloth:   '/assets/cards/1F97B.svg',
  spice:   '/assets/cards/1F966.svg',
  leather: '/assets/cards/1F462.svg',
  camel:   '/assets/cards/1F42A.svg',
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
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 480)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  const label = card.type.toUpperCase()
  
  // Base dimensions
  const baseW = size === 'sm' ? 58 : 75
  const baseH = size === 'sm' ? 82 : 105

  // Apply 10% reduction on mobile
  const w = isMobile ? baseW * 0.9 : baseW
  const h = isMobile ? baseH * 0.9 : baseH

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
        userSelect: 'none',
        flexShrink: 0,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Linen Texture Overlay
          NOTE: still hotlinked. transparenttextures.com/patterns/linen.png
          returns 404 on the live host as of 2026-07-18 (confirmed dead, not
          a transient hiccup — see docs/assets.md). Left hotlinked per the
          documented fallback since no working copy could be sourced. */}
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
        padding: size === 'sm' ? 4 : (isMobile ? 6 : 8),
      }}>
        <img 
          src={ICON_URLS[card.type]} 
          alt={card.type}
          style={{
            width: size === 'sm' ? 24 : (isMobile ? 32 : 36),
            height: size === 'sm' ? 24 : (isMobile ? 32 : 36),
            marginBottom: size === 'sm' ? 2 : (isMobile ? 4 : 6),
            pointerEvents: 'none',
          }}
        />
        <span style={{
          color: card.type === 'gold' && selected ? '#000' : 'rgba(255,255,255,0.9)',
          fontSize: size === 'sm' ? 10 : (isMobile ? 12 : 14),
          fontWeight: 900,
          textAlign: 'center',
          letterSpacing: 1.5,
          pointerEvents: 'none',
        }}>
          {label}
        </span>
      </div>
    </motion.div>
  )
}

import { useState, useEffect, type CSSProperties } from 'react'
import { motion } from 'framer-motion'

interface CamelStackProps {
  herd: number
  camelsUsed: number
  inExchange: boolean
  onUseHerdCamel: () => void
  onRemoveCamel: () => void
}

// Bundled locally in public/assets/cards/ (previously hotlinked from an
// external raw-content host — see docs/assets.md). Same file Card.tsx uses.
const CAMEL_ICON = '/assets/cards/1F42A.svg'

export function CamelStack({ herd, camelsUsed, inExchange, onUseHerdCamel, onRemoveCamel }: CamelStackProps) {
  const [isMobile, setIsMobile] = useState(false)
  const [showControls, setShowControls] = useState(false)

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 480)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Auto-show controls when camelsUsed > 0 during exchange (user already interacting)
  useEffect(() => {
    if (camelsUsed > 0 && inExchange) setShowControls(true)
  }, [camelsUsed, inExchange])

  // Hide controls when exchange ends
  useEffect(() => {
    if (!inExchange) setShowControls(false)
  }, [inExchange])

  if (herd === 0) return null

  const available = herd - camelsUsed
  const selected = camelsUsed > 0

  const baseW = 75
  const baseH = 105
  const w = isMobile ? baseW * 0.9 : baseW
  const h = isMobile ? baseH * 0.9 : baseH

  const layerCount = herd === 1 ? 0 : herd === 2 ? 1 : 2

  const handleStackClick = () => {
    if (inExchange && available > 0) {
      if (!showControls) setShowControls(true)
      onUseHerdCamel()
    }
  }

  const layerStyle = (offset: number): CSSProperties => ({
    position: 'absolute',
    width: w,
    height: h,
    background: 'linear-gradient(135deg, #a08040, #403010)',
    border: '1.5px solid rgba(255,255,255,0.08)',
    borderRadius: 10,
    top: offset,
    left: offset,
    zIndex: 0,
  })

  const controlsVisible = inExchange && showControls

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div
        data-testid="camel-stack"
        onClick={handleStackClick}
        style={{
          position: 'relative',
          width: w + (layerCount * 3),
          height: h + (layerCount * 3),
          cursor: inExchange && !showControls ? 'pointer' : 'default',
          flexShrink: 0,
        }}
      >
        {Array.from({ length: layerCount }).map((_, i) => (
          <div
            key={i}
            data-testid="stack-layer"
            style={layerStyle((layerCount - i) * 3)}
          />
        ))}

        <motion.div
          data-testid="camel-front-card"
          animate={{ y: selected ? -6 : 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          style={{
            position: 'relative',
            width: w,
            height: h,
            background: 'linear-gradient(135deg, #d0a860, #604010)',
            border: selected ? '3px solid #fff' : '1.5px solid rgba(255,255,255,0.15)',
            borderRadius: 10,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            userSelect: 'none',
            overflow: 'hidden',
            zIndex: 1,
          }}
        >
          {/* Linen Texture Overlay — local, self-contained SVG noise tile
              (public/assets/textures/linen.svg), replacing a dead external
              texture-site hotlink (see docs/assets.md). */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            backgroundImage: "url('/assets/textures/linen.svg')",
            opacity: 0.25,
            pointerEvents: 'none',
            zIndex: 1,
          }} />

          <div style={{ zIndex: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: isMobile ? 6 : 8 }}>
            <img
              src={CAMEL_ICON}
              alt="camel"
              style={{
                width: isMobile ? 32 : 36,
                height: isMobile ? 32 : 36,
                marginBottom: isMobile ? 4 : 6,
                pointerEvents: 'none',
              }}
            />
            <span style={{
              color: 'rgba(255,255,255,0.9)',
              fontSize: isMobile ? 12 : 14,
              fontWeight: 900,
              letterSpacing: 1.5,
              pointerEvents: 'none',
            }}>
              CAMEL
            </span>
          </div>

          <div style={{
            position: 'absolute',
            top: 4,
            right: 4,
            background: '#2a1800',
            border: '1px solid #d0a860',
            borderRadius: 10,
            padding: '1px 6px',
            fontSize: 11,
            fontWeight: 700,
            color: '#d0a860',
            zIndex: 3,
          }}>
            x{available}
          </div>
        </motion.div>
      </div>

      {controlsVisible && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button
            onClick={onUseHerdCamel}
            disabled={available <= 0}
            style={{
              ...ctrlBtn,
              opacity: available <= 0 ? 0.4 : 1,
              cursor: available <= 0 ? 'not-allowed' : 'pointer',
            }}
          >
            <span style={{ fontSize: 16, fontWeight: 700 }}>+</span>
            <span style={{ fontSize: 14, color: '#fff', fontWeight: 700 }}>{camelsUsed} used</span>
          </button>
          {camelsUsed > 0 && (
            <button onClick={onRemoveCamel} style={{ ...ctrlBtn, background: '#4a2010', borderColor: '#c08040' }}>
              <span style={{ fontSize: 16, fontWeight: 700 }}>-</span>
              <span style={{ fontSize: 14, color: '#fff', fontWeight: 700 }}>{available} remaining</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

const ctrlBtn: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  padding: '6px 10px',
  background: '#5a4010',
  color: '#f0e8d8',
  border: '1px solid #d0a860',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  lineHeight: 1.2,
}

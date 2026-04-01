import { AnimatePresence, motion } from 'framer-motion'
import type { TokenPiles, BonusPiles, Good } from '../engine'

function AnimatedTokenValue({ value }: { value: number | undefined }) {
  return (
    <span style={{ display: 'inline-block', overflow: 'hidden', minWidth: 16 }}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value ?? 'empty'}
          initial={{ y: -10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 10, opacity: 0 }}
          transition={{ duration: 0.18 }}
          style={{ display: 'inline-block' }}
        >
          {value ?? '—'}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

const GOODS: Good[] = ['diamond', 'gold', 'silver', 'cloth', 'spice', 'leather']

const ACCENT: Record<Good, string> = {
  diamond: '#ff4060', gold: '#f0c030', silver: '#c0d0e0',
  cloth: '#c060e0', spice: '#60c040', leather: '#c08040',
}

function StarGrid({ tier }: { tier: 'three' | 'four' | 'five' }) {
  const color = tier === 'three' ? '#60a0f0' : tier === 'four' ? '#c060e0' : '#f0c030'
  
  if (tier === 'three') {
    return (
      <div style={{ position: 'relative', width: 20, height: 18, color }}>
        <span style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', fontSize: 8 }}>★</span>
        <span style={{ position: 'absolute', bottom: 0, left: 0, fontSize: 8 }}>★</span>
        <span style={{ position: 'absolute', bottom: 0, right: 0, fontSize: 8 }}>★</span>
      </div>
    )
  }
  if (tier === 'four') {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 2, color }}>
        <span style={{ fontSize: 8 }}>★</span><span style={{ fontSize: 8 }}>★</span>
        <span style={{ fontSize: 8 }}>★</span><span style={{ fontSize: 8 }}>★</span>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, color }}>
      <div style={{ display: 'flex', gap: 2 }}><span style={{ fontSize: 8 }}>★</span><span style={{ fontSize: 8 }}>★</span></div>
      <div style={{ display: 'flex', gap: 2 }}><span style={{ fontSize: 8 }}>★</span><span style={{ fontSize: 8 }}>★</span><span style={{ fontSize: 8 }}>★</span></div>
    </div>
  )
}

function Token({ good, tier, value, count }: { good?: Good, tier?: 'three' | 'four' | 'five', value?: number, count: number }) {
  const isBonus = !!tier
  const isEmpty = count === 0
  const bgColor = good ? ACCENT[good] : '#000'
  
  return (
    <div style={{ 
      position: 'relative', 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      gap: 2,
      opacity: isEmpty ? 0.3 : 1,
      filter: isEmpty ? 'grayscale(1)' : 'none',
      transition: 'all 0.3s ease',
    }}>
      {isBonus && (
        <span style={{ 
          fontSize: 8, 
          color: '#d0a860', 
          fontWeight: 900, 
          textTransform: 'uppercase', 
          letterSpacing: 1,
          marginBottom: 2
        }}>
          {tier}
        </span>
      )}
      <div style={{
        width: 32, height: 32, borderRadius: '50%',
        background: isBonus 
          ? 'radial-gradient(circle at 30% 30%, #333, #000)' 
          : `radial-gradient(circle at 30% 30%, ${bgColor}, #000)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: `2px solid ${isBonus ? '#d0a860' : bgColor}`,
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Shine */}
        <div style={{
          position: 'absolute', top: '5%', left: '15%', width: '40%', height: '30%',
          background: 'linear-gradient(to bottom, rgba(255,255,255,0.4), transparent)',
          borderRadius: '50%',
          pointerEvents: 'none',
        }} />
        
        {isBonus ? (
          <StarGrid tier={tier} />
        ) : (
          <span style={{ 
            fontSize: 14, fontWeight: 900, color: '#fff', 
            zIndex: 1
          }}>
            {value !== undefined ? <AnimatedTokenValue value={value} /> : '—'}
          </span>
        )}
      </div>
      <span style={{ fontSize: 10, color: '#888', fontWeight: 'bold' }}>×{count}</span>
    </div>
  )
}

interface Props {
  tokens: TokenPiles
  bonusTokens: BonusPiles
}

export function TokenRail({ tokens, bonusTokens }: Props) {
  return (
    <div style={{
      display: 'flex', gap: 10, padding: '12px',
      background: 'rgba(0,0,0,0.4)', 
      borderRadius: 12,
      border: '1px solid rgba(255,255,255,0.05)',
      flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center',
      backdropFilter: 'blur(10px)',
    }}>
      <div style={{ display: 'flex', gap: 8 }}>
        {GOODS.map(good => {
          const pile = tokens[good]
          return <Token key={good} good={good} value={pile[0]} count={pile.length} />
        })}
      </div>
      
      <div style={{ width: 1, background: '#333', height: 35, margin: '0 5px' }} />
      
      <div style={{ display: 'flex', gap: 8 }}>
        {(['three', 'four', 'five'] as const).map(tier => (
          <Token key={tier} tier={tier} count={bonusTokens[tier].length} />
        ))}
      </div>
    </div>
  )
}

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

function Token({ good, value, count }: { good?: Good, value?: number, count: number }) {
  const isBonus = !good
  const bgColor = good ? ACCENT[good] : '#1a1a1a'
  const textColor = good ? '#fff' : '#f0c030'
  
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 48 }}>
      <div style={{
        width: 40, height: 40, borderRadius: '50%',
        background: isBonus 
          ? 'radial-gradient(circle at 30% 30%, #333, #000)' 
          : `radial-gradient(circle at 30% 30%, ${bgColor}, #000)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: 'inset 0 2px 4px rgba(255,255,255,0.2), 0 4px 8px rgba(0,0,0,0.4)',
        border: `2px solid ${isBonus ? '#d0a860' : bgColor}`,
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Shine */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '50%',
          background: 'linear-gradient(to bottom, rgba(255,255,255,0.1), transparent)',
          borderRadius: '50% 50% 0 0',
        }} />
        
        {isBonus && (
           <div style={{
            position: 'absolute', width: '70%', height: '70%',
            background: 'radial-gradient(circle, #f0c030 10%, transparent 70%)',
            opacity: 0.1,
          }} />
        )}

        <span style={{ 
          fontSize: 16, fontWeight: 900, color: textColor, 
          textShadow: '0 2px 4px rgba(0,0,0,0.5)', zIndex: 1
        }}>
          {value !== undefined ? <AnimatedTokenValue value={value} /> : '?'}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <span style={{ fontSize: 8, color: isBonus ? '#d0a860' : ACCENT[good!], textTransform: 'uppercase', fontWeight: 700, letterSpacing: 0.5 }}>
          {good || 'Bonus'}
        </span>
        <span style={{ fontSize: 10, color: '#888', fontWeight: 600 }}>×{count}</span>
      </div>
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
      display: 'flex', gap: 12, padding: '12px 16px',
      background: 'linear-gradient(to bottom, #2a1a0a, #1a0a00)', 
      borderRadius: 12,
      border: '1px solid #3a2a10',
      flexWrap: 'wrap', alignItems: 'flex-start',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    }}>
      <div style={{ display: 'flex', gap: 8 }}>
        {GOODS.map(good => {
          const pile = tokens[good]
          return <Token key={good} good={good} value={pile[0]} count={pile.length} />
        })}
      </div>
      
      <div style={{ width: 2, background: '#3a2a10', alignSelf: 'stretch', margin: '4px 8px', borderRadius: 1 }} />
      
      <div style={{ display: 'flex', gap: 8 }}>
        {(['three', 'four', 'five'] as const).map(tier => (
          <Token key={tier} count={bonusTokens[tier].length} />
        ))}
      </div>
    </div>
  )
}

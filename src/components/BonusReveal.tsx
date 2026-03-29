import { AnimatePresence, motion } from 'framer-motion'

interface BonusRevealProps {
  show: boolean
  onDone: () => void
}

export function BonusReveal({ show, onDone }: BonusRevealProps) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ scale: 0.3, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 1.4, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 250, damping: 18 }}
          onAnimationComplete={(def) => {
            if (def === 'exit' || !show) onDone()
          }}
          style={{
            position: 'fixed', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none', zIndex: 100,
          }}
        >
          <div style={{
            background: 'linear-gradient(135deg, #f0c030, #e08000)',
            color: '#3a1a00',
            borderRadius: 20,
            padding: '20px 52px',
            fontSize: 36,
            fontWeight: 900,
            letterSpacing: 2,
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          }}>
            BONUS!
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

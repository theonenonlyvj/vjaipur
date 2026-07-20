import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

interface BonusRevealProps {
  show: boolean
  onDone: () => void
}

/** How long the "BONUS!" celebration stays on screen before auto-dismissing. */
const HOLD_MS = 900

export function BonusReveal({ show, onDone }: BonusRevealProps) {
  // Keep the latest onDone in a ref so the auto-dismiss timer below depends
  // ONLY on `show`. The parent passes an inline `() => setShow(false)` (a new
  // function every render); if the effect depended on it, every GameScreen
  // re-render would reset the timer so it never fired — the overlay would stay
  // up for the rest of the game. (That was the bug.) The old exit-only
  // onAnimationComplete never fired either: `def` is the inline animate object,
  // never the string 'exit', and exit only plays once show is already false.
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    if (!show) return
    const t = setTimeout(() => onDoneRef.current(), HOLD_MS)
    return () => clearTimeout(t)
  }, [show])

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ scale: 0.3, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 1.4, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 250, damping: 18 }}
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
          }}>
            BONUS!
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

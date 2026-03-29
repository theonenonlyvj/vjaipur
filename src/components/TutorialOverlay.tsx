import { useState, useEffect, useRef } from 'react'
import { useGameStore } from '../store/gameStore'

interface Step {
  title: string
  body: string
  trigger: 'button' | 'took-card' | 'sold'
}

const STEPS: Step[] = [
  {
    title: 'Welcome to Jaipur!',
    body: "You're competing to become the Maharaja's personal trader. Earn more rupees than your opponent to win a Seal of Excellence — first to 2 seals wins the match.",
    trigger: 'button',
  },
  {
    title: 'The Market',
    body: 'The 5 cards in the centre are the market. On your turn you can: take 1 good card, take ALL the camels, or exchange multiple cards with your hand.',
    trigger: 'button',
  },
  {
    title: 'Token Piles',
    body: 'Each good has a shrinking stack of tokens. First seller gets the highest value — so sell premium goods (diamonds, gold, silver) early!',
    trigger: 'button',
  },
  {
    title: 'Your Hand',
    body: 'Goods go into your hand (max 7 cards). Camel cards go to your herd — they can be used in exchanges but never sold directly.',
    trigger: 'button',
  },
  {
    title: 'Take a Card',
    body: "It's your turn! Tap any non-camel card in the market to take it.",
    trigger: 'took-card',
  },
  {
    title: 'Sell Goods',
    body: 'Now try selling! Use the Sell buttons in the action bar. Selling 3 or more matching goods at once earns you a bonus token.',
    trigger: 'sold',
  },
  {
    title: 'Exchange',
    body: 'You can also swap multiple market cards for cards in your hand (plus camels from your herd). Tap the Exchange button when you want to try it.',
    trigger: 'button',
  },
  {
    title: "You're Ready!",
    body: 'That covers the basics of Jaipur. Outsell your opponent and claim those seals. Good luck!',
    trigger: 'button',
  },
]

interface Props {
  onDone: () => void
}

export function TutorialOverlay({ onDone }: Props) {
  const [step, setStep] = useState(0)
  const { state } = useGameStore()
  const prevStateRef = useRef(state)

  const current = STEPS[step]
  const isLast = step === STEPS.length - 1

  useEffect(() => {
    const prev = prevStateRef.current
    prevStateRef.current = state
    if (!state || !prev) return

    if (current.trigger === 'took-card') {
      if (state.players[0].hand.length > prev.players[0].hand.length) {
        setStep(s => s + 1)
      }
    } else if (current.trigger === 'sold') {
      if (state.players[0].tokens.length > prev.players[0].tokens.length) {
        setStep(s => s + 1)
      }
    }
  }, [state, current.trigger])

  function advance() {
    if (isLast) { onDone(); return }
    setStep(s => s + 1)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
      pointerEvents: 'none',
    }}>
      <div style={{
        background: 'rgba(10, 6, 2, 0.55)',
        position: 'absolute', inset: 0,
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'relative', zIndex: 1,
        background: '#1a120a',
        border: '1.5px solid #f0c030',
        borderRadius: '16px 16px 0 0',
        padding: '20px 20px 32px',
        maxWidth: 620, width: '100%', margin: '0 auto',
        pointerEvents: 'all',
        boxShadow: '0 -4px 32px rgba(0,0,0,0.6)',
      }}>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 8, letterSpacing: 1, textTransform: 'uppercase' }}>
          Tutorial · {step + 1} / {STEPS.length}
        </div>
        <div style={{ fontSize: 17, fontWeight: 700, color: '#f0c030', marginBottom: 10 }}>
          {current.title}
        </div>
        <div style={{ fontSize: 14, color: '#e8dcc8', lineHeight: 1.65, marginBottom: 22 }}>
          {current.body}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <button
            onClick={onDone}
            style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 13, padding: '6px 0' }}
          >
            Skip Tutorial
          </button>
          {current.trigger === 'button' ? (
            <button
              onClick={advance}
              style={{
                background: '#5a3a00', border: '1.5px solid #f0c030',
                color: '#f0e8d8', fontSize: 15, fontWeight: 700,
                borderRadius: 8, padding: '10px 28px', cursor: 'pointer',
              }}
            >
              {isLast ? 'Play!' : 'Next →'}
            </button>
          ) : (
            <span style={{ color: '#888', fontSize: 13, fontStyle: 'italic' }}>
              Waiting for your move…
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

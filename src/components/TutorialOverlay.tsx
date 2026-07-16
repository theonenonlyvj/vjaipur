import { useState, useEffect, useRef, type CSSProperties } from 'react'
import { useGameStore } from '../store/gameStore'
import { TokenMatrix } from './TokenMatrix'

interface Step {
  title: string
  body: string
  trigger: 'button' | 'took-card' | 'sold'
  chapter: 1 | 2
  showTokenMatrix?: boolean
}

const STEPS: Step[] = [
  // Chapter 1: Basics
  {
    title: 'Welcome to Jaipur!',
    body: "You're a trader competing for the Maharaja's favor. Earn more rupees than your opponent to win.",
    trigger: 'button',
    chapter: 1,
  },
  {
    title: 'The Market',
    body: 'The 5 cards in the center are the market. On your turn: take 1 good, take all camels, or exchange cards.',
    trigger: 'button',
    chapter: 1,
  },
  {
    title: 'Your Hand',
    body: "Goods go to your hand (max 7). Camels go to your herd — they help with exchanges but can't be sold.",
    trigger: 'button',
    chapter: 1,
  },
  {
    title: 'Take a Card',
    body: "It's your turn! Tap any non-camel card in the market to take it.",
    trigger: 'took-card',
    chapter: 1,
  },
  {
    title: 'Sell Goods',
    body: 'Now try selling! Tap cards in your hand to select them, then hit Sell.',
    trigger: 'sold',
    chapter: 1,
  },
  {
    title: 'Exchanges',
    body: 'You can swap 2+ market cards for cards in your hand (plus camels). Select 2+ market cards to try it.',
    trigger: 'button',
    chapter: 1,
  },
  // Chapter 2: Scoring & Strategy
  {
    title: 'Token Values',
    body: "First to sell gets the best price — values drop as tokens are claimed. Selling diamonds first earns 7 per token. Selling last earns 5. Race to sell!",
    trigger: 'button',
    chapter: 2,
    showTokenMatrix: true,
  },
  {
    title: 'Precious Goods',
    body: 'Diamonds, gold, and silver are "precious" — worth more, but you must sell at least 2 at a time. Common goods (cloth, spice, leather) can be sold one at a time.',
    trigger: 'button',
    chapter: 2,
  },
  {
    title: 'Bonus Tokens',
    body: "Sell 3+ cards at once to earn a bonus token. These are shuffled face-down — you won't know the exact value until you earn one. Sell 3 → worth 1-3 pts, sell 4 → worth 4-6 pts, sell 5+ → worth 8-10 pts. Big bulk sales are game-changers!",
    trigger: 'button',
    chapter: 2,
  },
  {
    title: 'Camels Are Powerful',
    body: "Don't overlook camels! They don't count against your 7-card hand limit, so they're free resources. Use them in exchanges to grab goods without giving any up. A large herd also earns 5 bonus rupees at round end. Taking all camels from the market also refreshes it with new cards — sometimes that's the real play.",
    trigger: 'button',
    chapter: 2,
  },
  {
    title: 'Controlling the Endgame',
    body: "The round ends when 3 token piles are empty or the deck runs out. If you're ahead, force the round to end quickly by selling to deplete piles. If you're behind, slow down — exchange and accumulate to set up big scoring turns. Keep an eye on the deck count at the top of the screen and the token piles!",
    trigger: 'button',
    chapter: 2,
  },
  {
    title: 'Seals of Excellence',
    body: 'Win a round to earn a Seal of Excellence. The match is best-of-N based on the Match Length you choose (1, 3, or 5 games)—first to a majority of seals wins. Ties are broken by most bonus tokens, then most goods tokens.',
    trigger: 'button',
    chapter: 2,
  },
  {
    title: 'Read Your Opponent',
    body: "You can see every card your opponent takes from the market. Track what's in their hand, watch their herd grow, and anticipate their next sell. The best traders are mind readers!",
    trigger: 'button',
    chapter: 2,
  },
  {
    title: "You're Ready!",
    body: 'Sell premium goods early, sell in bulk for bonuses, and watch the token piles. Good luck!',
    trigger: 'button',
    chapter: 2,
  },
]

const CHAPTER_1_COUNT = STEPS.filter(s => s.chapter === 1).length
const CHAPTER_2_COUNT = STEPS.filter(s => s.chapter === 2).length

interface Props {
  onDone: () => void
}

export function TutorialOverlay({ onDone }: Props) {
  const [step, setStep] = useState(0)
  const [showChapterTransition, setShowChapterTransition] = useState(false)
  const { state } = useGameStore()
  const prevStateRef = useRef(state)

  const current = STEPS[step]
  const isLast = step === STEPS.length - 1
  const chapterStepNum = current.chapter === 1 ? step + 1 : step + 1 - CHAPTER_1_COUNT
  const chapterTotal = current.chapter === 1 ? CHAPTER_1_COUNT : CHAPTER_2_COUNT

  // Auto-advance on action triggers
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
    // Show chapter transition after last step of chapter 1
    if (step === CHAPTER_1_COUNT - 1) {
      setShowChapterTransition(true)
      return
    }
    setStep(s => s + 1)
  }

  function continueToChapter2() {
    setShowChapterTransition(false)
    setStep(CHAPTER_1_COUNT)
  }

  // Chapter transition screen
  if (showChapterTransition) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', pointerEvents: 'none' }}>
        <div style={{ background: 'rgba(10, 6, 2, 0.55)', position: 'absolute', inset: 0, pointerEvents: 'none' }} />
        <div style={{ ...panelStyle, pointerEvents: 'all' }}>
          <div style={{ fontSize: 20, fontWeight: 900, color: '#f0c030', marginBottom: 8 }}>
            Chapter 1 complete!
          </div>
          <div style={{ fontSize: 14, color: '#e8dcc8', marginBottom: 24, lineHeight: 1.6 }}>
            Continue to Scoring &amp; Strategy?
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <button onClick={onDone} style={skipBtnStyle}>
              Skip — Start Playing
            </button>
            <button onClick={continueToChapter2} style={primaryBtnStyle}>
              Continue →
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Compact top banner for action-triggered steps
  if (current.trigger !== 'button') {
    return (
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
        <div style={{
          background: '#1a120a',
          border: '1.5px solid #f0c030',
          borderRadius: '0 0 12px 12px',
          padding: '10px 16px',
          maxWidth: 620, width: '100%',
          pointerEvents: 'all',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <div>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#f0c030' }}>{current.title}: </span>
            <span style={{ fontSize: 13, color: '#e8dcc8' }}>{current.body}</span>
          </div>
          <button onClick={onDone} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}>
            Skip
          </button>
        </div>
      </div>
    )
  }

  // Modal overlay for button-triggered steps
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', pointerEvents: 'none' }}>
      <div style={{ background: 'rgba(10, 6, 2, 0.55)', position: 'absolute', inset: 0, pointerEvents: 'none' }} />
      <div style={{ ...panelStyle, pointerEvents: 'all' }}>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 8, letterSpacing: 1, textTransform: 'uppercase' }}>
          Chapter {current.chapter} · {chapterStepNum} / {chapterTotal}
        </div>
        <div style={{ fontSize: 17, fontWeight: 700, color: '#f0c030', marginBottom: 10 }}>
          {current.title}
        </div>
        <div style={{ fontSize: 14, color: '#e8dcc8', lineHeight: 1.65, marginBottom: current.showTokenMatrix ? 12 : 22 }}>
          {current.body}
        </div>
        {current.showTokenMatrix && (
          <div style={{ marginBottom: 22 }}>
            <TokenMatrix />
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <button onClick={onDone} style={skipBtnStyle}>
            Skip Tutorial
          </button>
          <button onClick={advance} style={primaryBtnStyle}>
            {isLast ? 'Play!' : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  )
}

const panelStyle: CSSProperties = {
  position: 'relative', zIndex: 1,
  background: '#1a120a',
  border: '1.5px solid #f0c030',
  borderRadius: '16px 16px 0 0',
  padding: '20px 20px 32px',
  maxWidth: 620, width: '100%', margin: '0 auto',
}

const skipBtnStyle: CSSProperties = {
  background: 'none', border: 'none', color: '#666',
  cursor: 'pointer', fontSize: 13, padding: '6px 0',
}

const primaryBtnStyle: CSSProperties = {
  background: '#5a3a00', border: '1.5px solid #f0c030',
  color: '#f0e8d8', fontSize: 15, fontWeight: 700,
  borderRadius: 8, padding: '10px 28px', cursor: 'pointer',
}

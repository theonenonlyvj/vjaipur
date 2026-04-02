import { useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import { TokenMatrix } from '../components/TokenMatrix'

type Tab = 'gameplay' | 'scoring' | 'strategy'

export function RulesScreen() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('gameplay')
  const { setDifficulty, startTutorial, startGame } = useGameStore()

  function handleStartTutorial() {
    setDifficulty('easy')
    startTutorial()
    startGame('vs-ai')
    navigate('/game')
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      maxWidth: 620, margin: '0 auto', width: '100%',
      background: 'radial-gradient(circle at 50% 50%, #1a0a00 0%, #000000 100%)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px', gap: 16 }}>
        <button onClick={() => navigate('/')} style={backBtnStyle}>← Back</button>
        <h1 style={{ fontSize: 20, fontWeight: 900, color: '#f0c030', margin: 0, letterSpacing: 2 }}>HOW TO PLAY</h1>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.1)', padding: '0 20px' }}>
        {(['gameplay', 'scoring', 'strategy'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              ...tabBtnStyle,
              color: tab === t ? '#f0c030' : '#666',
              borderBottom: tab === t ? '2px solid #f0c030' : '2px solid transparent',
            }}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px 120px' }}>
        {tab === 'gameplay' && <GameplayTab />}
        {tab === 'scoring' && <ScoringTab />}
        {tab === 'strategy' && <StrategyTab />}
      </div>

      {/* Fixed bottom button */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        padding: '16px 24px 32px',
        background: 'linear-gradient(transparent, #000 40%)',
        display: 'flex', justifyContent: 'center',
      }}>
        <button onClick={handleStartTutorial} style={tutorialBtnStyle}>
          Start Tutorial
        </button>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={sectionTitleStyle}>{title}</div>
      <div style={sectionBodyStyle}>{children}</div>
    </div>
  )
}

function GameplayTab() {
  return (
    <>
      <Section title="Your Turn">
        On your turn you can do one of three things: take 1 good card from the market, take all camel cards from the market, or exchange 2+ cards between the market and your hand.
      </Section>
      <Section title="The Market">
        5 cards sit in the center. When you take cards, the market is replenished from the deck.
      </Section>
      <Section title="Hand Limit">
        You can hold a maximum of 7 goods cards. Camels go to your herd and don't count toward this limit.
      </Section>
      <Section title="Exchanges">
        Swap 2 or more market cards for cards in your hand plus camels from your herd. The number given must equal the number taken.
      </Section>
      <Section title="Round End">
        The round ends when 3 token piles are empty or the deck runs out. The deck count is visible at the top of the screen.
      </Section>
    </>
  )
}

function ScoringTab() {
  return (
    <>
      <Section title="Token Values">
        Each good has a stack of tokens with decreasing values. First to sell gets the best price.
      </Section>
      <div style={{ marginBottom: 24 }}>
        <TokenMatrix />
      </div>
      <Section title="Precious Goods">
        Diamonds, gold, and silver are worth more but must be sold 2 or more at a time. Common goods (cloth, spice, leather) can be sold 1 at a time.
      </Section>
      <Section title="Bonus Tokens">
        {"Sell 3 or more matching cards at once to earn a bonus token. Bonus tokens are shuffled face-down — you won't know the exact value until you earn one. Sell 3 → worth 1-3 pts. Sell 4 → worth 4-6 pts. Sell 5+ → worth 8-10 pts."}
      </Section>
      <Section title="Camel Bonus">
        The player with the most camels at round end earns 5 bonus rupees.
      </Section>
      <Section title="Seals of Excellence">
        The player with more total rupees wins a Seal. In best-of-3, first to 2 seals wins the match. Ties are broken by: most bonus tokens, then most goods tokens.
      </Section>
    </>
  )
}

function StrategyTab() {
  return (
    <>
      <Section title="Sell Early">
        {"Token values decrease as they're claimed. First seller gets the best price — especially for precious goods."}
      </Section>
      <Section title="Sell in Bulk">
        Bonus tokens for 3+ card sales are massive point swings. A single 5-card sell can earn 8-10 extra points on top of the token values.
      </Section>
      <Section title="Camels Are Powerful">
        {"Don't overlook camels. They don't count against your hand limit, they fuel exchanges without giving up goods, taking them refreshes the market with new cards, and the largest herd earns 5 bonus rupees at round end."}
      </Section>
      <Section title="Control the Pace">
        {"If you're ahead, deplete token piles to end the round fast. If you're behind, slow down — exchange and accumulate to set up big scoring turns. Watch the deck count and token piles closely."}
      </Section>
      <Section title="Read Your Opponent">
        {"Every card your opponent takes from the market is visible to you. Track what's in their hand, watch their herd grow, and anticipate their next sell. The best traders are mind readers!"}
      </Section>
    </>
  )
}

const backBtnStyle: CSSProperties = {
  background: 'none', border: 'none', color: '#888',
  cursor: 'pointer', fontSize: 14, fontWeight: 600, padding: 0,
}

const tabBtnStyle: CSSProperties = {
  background: 'none', border: 'none',
  fontSize: 14, fontWeight: 700, padding: '12px 16px',
  cursor: 'pointer', textTransform: 'capitalize',
  letterSpacing: 0.5,
}

const sectionTitleStyle: CSSProperties = {
  fontSize: 13, fontWeight: 900, color: '#f0c030',
  textTransform: 'uppercase', letterSpacing: 1.5,
  marginBottom: 6,
}

const sectionBodyStyle: CSSProperties = {
  fontSize: 14, color: '#ccc', lineHeight: 1.7,
}

const tutorialBtnStyle: CSSProperties = {
  padding: '14px 40px', fontSize: 16, fontWeight: 900,
  background: 'linear-gradient(to bottom, #306010, #1a4000)',
  color: '#e0f0d0',
  border: '2px solid #60c040', borderRadius: 12,
  cursor: 'pointer', letterSpacing: 1,
  textTransform: 'uppercase',
  minWidth: 220,
}

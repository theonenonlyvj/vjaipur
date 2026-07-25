import type { CSSProperties } from 'react'
import { TokenMatrix } from './TokenMatrix'

export type RulesTab = 'gameplay' | 'scoring' | 'strategy'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={sectionTitleStyle}>{title}</div>
      <div style={sectionBodyStyle}>{children}</div>
    </div>
  )
}

export function GameplayTab() {
  return (
    <>
      <Section title="Your Turn">
        On your turn you can do one of three things: take 1 good card from the market, take all camel cards from the market, or exchange 2+ cards between the market and your hand.
      </Section>
      <Section title="The Market">
        5 cards sit in the center. When you take cards, the market is replenished from a 55-card deck: 44 goods (6 diamond, 6 gold, 6 silver, 8 cloth, 8 spice, 10 leather) and 11 camels.
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

export function ScoringTab() {
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
        The player with the most camels at round end earns 5 bonus rupees (11 in the deck).
      </Section>
      <Section title="Seals of Excellence">
        Win a round to earn a Seal of Excellence. The match is best-of-N based on the Match Length you choose (1, 3, or 5 games)—first to a majority of seals wins. Ties are broken by most bonus tokens, then most goods tokens.
      </Section>
    </>
  )
}

export function StrategyTab() {
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

export const tabBtnStyle: CSSProperties = {
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

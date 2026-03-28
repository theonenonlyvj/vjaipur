import type { Card } from '../engine'

const BG: Record<string, string> = {
  diamond: 'linear-gradient(135deg, #5a0010, #c0102a)',
  gold:    'linear-gradient(135deg, #5a3a00, #c08010)',
  silver:  'linear-gradient(135deg, #2a3040, #6a7a90)',
  cloth:   'linear-gradient(135deg, #2a0040, #7a20a0)',
  spice:   'linear-gradient(135deg, #0a2a00, #307820)',
  leather: 'linear-gradient(135deg, #2a1400, #7a4018)',
  camel:   'linear-gradient(135deg, #3a2a10, #907040)',
}

const ACCENT: Record<string, string> = {
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
  const label = card.type.charAt(0).toUpperCase() + card.type.slice(1)
  const w = size === 'sm' ? 56 : 72
  const h = size === 'sm' ? 80 : 100
  return (
    <div
      onClick={onClick}
      style={{
        width: w, height: h,
        background: BG[card.type] ?? '#333',
        border: `2px solid ${ACCENT[card.type] ?? '#888'}`,
        borderRadius: 8,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: onClick ? 'pointer' : 'default',
        outline: selected ? '2px solid #fff' : 'none',
        outlineOffset: 3,
        userSelect: 'none',
        flexShrink: 0,
      }}
    >
      <span style={{
        color: '#fff',
        fontSize: size === 'sm' ? 10 : 12,
        fontWeight: 700,
        textAlign: 'center',
        textTransform: 'uppercase',
        letterSpacing: 1,
        pointerEvents: 'none',
      }}>
        {label}
      </span>
    </div>
  )
}

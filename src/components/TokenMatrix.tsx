import type { CSSProperties } from 'react'
import type { Good } from '../engine'

const ACCENT: Record<Good, string> = {
  diamond: '#ff4060', gold: '#f0c030', silver: '#c0d0e0',
  cloth: '#c060e0', spice: '#60c040', leather: '#c08040',
}

const TOKEN_VALUES: { good: Good; values: number[] }[] = [
  { good: 'diamond', values: [7, 7, 5, 5, 5] },
  { good: 'gold',    values: [6, 6, 5, 5, 5] },
  { good: 'silver',  values: [5, 5, 5, 5, 5] },
  { good: 'cloth',   values: [5, 3, 3, 2, 2, 1, 1] },
  { good: 'spice',   values: [5, 3, 3, 2, 2, 1, 1] },
  { good: 'leather', values: [4, 3, 2, 1, 1, 1, 1, 1, 1] },
]

export function TokenMatrix() {
  return (
    <table style={tableStyle}>
      <tbody>
        {TOKEN_VALUES.map(({ good, values }) => (
          <tr key={good}>
            <td style={{ ...cellStyle, color: ACCENT[good], fontWeight: 700, textTransform: 'capitalize', whiteSpace: 'nowrap', paddingRight: 12 }}>
              {good.charAt(0).toUpperCase() + good.slice(1)}
            </td>
            <td style={cellStyle}>
              {values.map((v, i) => (
                <span key={i} style={tokenStyle}>{v}</span>
              ))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const tableStyle: CSSProperties = {
  borderCollapse: 'collapse',
  fontSize: 13,
  width: '100%',
}

const cellStyle: CSSProperties = {
  padding: '3px 0',
  color: '#ccc',
  verticalAlign: 'middle',
}

const tokenStyle: CSSProperties = {
  display: 'inline-block',
  background: 'rgba(255,255,255,0.08)',
  borderRadius: 4,
  padding: '2px 6px',
  marginRight: 4,
  fontSize: 12,
  fontWeight: 600,
  color: '#e8dcc8',
}

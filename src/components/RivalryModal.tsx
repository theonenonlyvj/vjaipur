import type { CSSProperties } from 'react'
import type { RivalryPerGameEntry, RivalryResponse } from '../net/online'

/**
 * "YOU vs <NAME>" head-to-head modal (StatsDashboard.tsx: click an Online
 * Rival row). Layered ON TOP of the Hall of Records modal (higher zIndex —
 * see overlayStyle below), same overlay convention as ProfileOverlay.tsx/
 * RulesModal.tsx (fixed, dimmed, blurred backdrop, click-outside-to-close).
 *
 * FRAMING (design council rule, carried over from this feature's brief):
 * every row here reports FACTS of shared history ("what happened"), never a
 * style CLAIM or a coaching verdict — neutral labels only ("Tokens per
 * card — you 3.71 · them 3.35"), no "you're better at X". The ONE exception
 * is `edgeFinder` (DELTA B, owner 2026-07-28, explicitly overruling the
 * above for this single line) — playful, fact-grounded, private-to-the-
 * viewer banter, rendered in its own distinct callout.
 *
 * Fetch/cache/loading/error state all live in the PARENT (StatsDashboard.tsx)
 * — this component is purely presentational, mirroring how the MY STYLE tab
 * is structured (state owned by the dashboard, the tab itself just renders).
 */

export interface RivalryModalProps {
  opponentName: string
  loading: boolean
  error: string
  data: RivalryResponse | null
  onClose: () => void
}

/** Naive-but-correct-enough pluralizer for this modal's own vocabulary
 *  (game/match) — a bare `+s` would mangle "match" into "matchs", so words
 *  ending in ch/sh/s/x/z get `+es` instead (also correctly handles a future
 *  "loss"/"win" reuse). Not a general-purpose English pluralizer. */
function pluralize(n: number, word: string): string {
  if (n === 1) return `${n} ${word}`
  const plural = /(?:[sxz]|[cs]h)$/i.test(word) ? `${word}es` : `${word}s`
  return `${n} ${plural}`
}

function streakLine(record: RivalryResponse['record']): string | null {
  const { currentStreak } = record.games
  if (currentStreak.n === 0) return null
  const verb = currentStreak.who === 'me' ? 'won' : 'lost'
  return `${verb} the last ${pluralize(currentStreak.n, 'game')}`
}

/** Cosmetic-only bar width (0..45, half the track) for a tug-of-war row —
 *  NOT the same ranking heuristic the worker's edgeFinder uses internally;
 *  this purely drives how full the visual bar looks. */
function tugBarWidth(mine: number, theirs: number): number {
  const max = Math.max(mine, theirs)
  if (max <= 0) return 0
  return Math.min(45, (Math.abs(mine - theirs) / max) * 90)
}

function fmtDecimal(n: number): string {
  return n.toFixed(2)
}

interface MatchGroup {
  matchCode: string
  endedAt: number | null
  games: RivalryPerGameEntry[]
}

/** perGame arrives already grouped contiguously (matches newest-first, games
 *  ascending within a match — see worker/src/do/rivalry.ts) — this just
 *  folds consecutive same-matchCode runs into display groups, never
 *  re-sorts. */
function groupPerGame(perGame: RivalryPerGameEntry[]): MatchGroup[] {
  const groups: MatchGroup[] = []
  for (const g of perGame) {
    const last = groups[groups.length - 1]
    if (last && last.matchCode === g.matchCode) last.games.push(g)
    else groups.push({ matchCode: g.matchCode, endedAt: g.endedAt, games: [g] })
  }
  return groups
}

function fmtDate(ts: number | null): string {
  if (ts == null) return ''
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function TugRow({ label, mine, theirs, mineDisplay, theirsDisplay }: {
  label: string
  mine: number
  theirs: number
  mineDisplay: string
  theirsDisplay: string
}) {
  const width = tugBarWidth(mine, theirs)
  const side: 'mine' | 'theirs' | 'even' = mine === theirs ? 'even' : mine > theirs ? 'mine' : 'theirs'
  return (
    <div style={{ marginBottom: 13 }}>
      <div style={{ fontSize: 12, color: '#dcd0b8', marginBottom: 4 }}>{label}</div>
      <div style={tugTrackStyle}>
        <div style={tugClineStyle} />
        {side !== 'even' && (
          <div
            style={
              side === 'mine'
                ? { ...tugPullBaseStyle, left: '50%', width: `${width}%`, background: 'linear-gradient(90deg, #b8860b, #f0c030)' }
                : { ...tugPullBaseStyle, right: '50%', width: `${width}%`, background: 'linear-gradient(270deg, #4a3a6a, #7a68a8)' }
            }
          />
        )}
      </div>
      <div style={{ fontSize: 10.5, color: '#997', marginTop: 3 }}>
        you {mineDisplay} · them {theirsDisplay}
      </div>
    </div>
  )
}

export function RivalryModal({ opponentName, loading, error, data, onClose }: RivalryModalProps) {
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, color: '#f0c030', letterSpacing: 1, fontSize: 19, fontWeight: 900 }}>
            YOU vs {(data?.opponentName ?? opponentName).toUpperCase()}
          </h2>
          <button onClick={onClose} style={closeBtnStyle} aria-label="Close">✕</button>
        </div>

        {loading && !data && (
          <div style={{ color: '#888', textAlign: 'center', padding: '40px 0', fontStyle: 'italic' }}>
            Loading head-to-head…
          </div>
        )}
        {error && !data && (
          <div style={{ color: '#ff6060', textAlign: 'center', padding: '20px 0' }}>{error}</div>
        )}

        {data && (
          <>
            {/* ── Hero: games record (primary) + streak, matches (secondary) ── */}
            <div style={{ fontSize: 26, fontWeight: 900, color: '#f0e8d8' }}>
              {data.record.games.wins}–{data.record.games.losses} <span style={{ fontSize: 14, color: '#cbbf9a', fontWeight: 700 }}>in games</span>
            </div>
            {streakLine(data.record) && (
              <div style={{ fontSize: 12, color: '#f0c030', fontWeight: 700, marginTop: 2 }}>{streakLine(data.record)}</div>
            )}
            <div style={{ color: '#997', fontSize: 11.5, marginTop: 4, marginBottom: 18 }}>
              across {pluralize(data.record.matches.wins + data.record.matches.losses, 'match')} ({data.record.matches.wins}–{data.record.matches.losses})
            </div>

            {/* ── Totals ── */}
            <h3 style={sectionHeaderStyle}>TOTALS</h3>
            <TugRow
              label="Points"
              mine={data.totals.myPoints}
              theirs={data.totals.theirPoints}
              mineDisplay={String(data.totals.myPoints)}
              theirsDisplay={String(data.totals.theirPoints)}
            />
            <TugRow
              label="Games won"
              mine={data.totals.gamesWon[0]}
              theirs={data.totals.gamesWon[1]}
              mineDisplay={String(data.totals.gamesWon[0])}
              theirsDisplay={String(data.totals.gamesWon[1])}
            />
            <TugRow
              label="Camel majority games"
              mine={data.totals.camelMajorityGames[0]}
              theirs={data.totals.camelMajorityGames[1]}
              mineDisplay={String(data.totals.camelMajorityGames[0])}
              theirsDisplay={String(data.totals.camelMajorityGames[1])}
            />

            {/* ── DELTA B: Edge Finder — the ONE coaching-toned line ── */}
            <div style={edgeFinderStyle}>{data.edgeFinder}</div>

            {/* ── Biggest game callout ── */}
            {data.biggestGame && (
              <div style={{ ...calloutStyle, marginTop: 14 }}>
                {(() => {
                  const bg = data.biggestGame
                  const mine = bg.myScore >= bg.theirScore
                  const headline = mine
                    ? `Your ${bg.myScore}–${bg.theirScore}`
                    : `Their ${bg.theirScore}–${bg.myScore}`
                  return `${headline} — game ${bg.gameNumber} of ${bg.matchCode}`
                })()}
              </div>
            )}

            {/* ── Craft ── */}
            <h3 style={{ ...sectionHeaderStyle, marginTop: 22 }}>CRAFT</h3>
            {data.craft.tokensPerCard.eligible ? (
              <TugRow
                label="Tokens per card"
                mine={data.craft.tokensPerCard.mine}
                theirs={data.craft.tokensPerCard.theirs}
                mineDisplay={fmtDecimal(data.craft.tokensPerCard.mine)}
                theirsDisplay={fmtDecimal(data.craft.tokensPerCard.theirs)}
              />
            ) : (
              <div style={notEnoughDataStyle}>not enough sells yet to compare craft</div>
            )}
            {data.craft.bonusSales.eligible ? (
              <>
                <TugRow
                  label="3-card bonus sales"
                  mine={data.craft.bonusSales.mine3}
                  theirs={data.craft.bonusSales.theirs3}
                  mineDisplay={String(data.craft.bonusSales.mine3)}
                  theirsDisplay={String(data.craft.bonusSales.theirs3)}
                />
                <TugRow
                  label="4-card bonus sales"
                  mine={data.craft.bonusSales.mine4}
                  theirs={data.craft.bonusSales.theirs4}
                  mineDisplay={String(data.craft.bonusSales.mine4)}
                  theirsDisplay={String(data.craft.bonusSales.theirs4)}
                />
                <TugRow
                  label="5-card bonus sales"
                  mine={data.craft.bonusSales.mine5}
                  theirs={data.craft.bonusSales.theirs5}
                  mineDisplay={String(data.craft.bonusSales.mine5)}
                  theirsDisplay={String(data.craft.bonusSales.theirs5)}
                />
              </>
            ) : (
              <div style={notEnoughDataStyle}>not enough sells yet to compare craft</div>
            )}

            {/* ── Per-game list, grouped by match ── */}
            <h3 style={{ ...sectionHeaderStyle, marginTop: 22 }}>GAMES</h3>
            {groupPerGame(data.perGame).map((group) => (
              <div key={group.matchCode} style={{ marginBottom: 14 }}>
                <div style={matchLabelStyle}>
                  MATCH {group.matchCode}{group.endedAt != null ? ` · ${fmtDate(group.endedAt)}` : ''}
                </div>
                {group.games.map((g) => (
                  <div key={`${group.matchCode}-${g.gameNumberInMatch}`} style={gameChipRowStyle}>
                    <span style={{ color: '#997', fontSize: 12 }}>Game {g.gameNumberInMatch}</span>
                    <span style={{ color: '#ddd', fontSize: 12, fontWeight: 700 }}>{g.myScore}–{g.theirScore}</span>
                    <span style={g.won ? wChipStyle : lChipStyle}>{g.won ? 'W' : 'L'}</span>
                  </div>
                ))}
              </div>
            ))}
          </>
        )}

        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <button onClick={onClose} style={closePrimaryBtnStyle}>CLOSE</button>
        </div>
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  background: 'rgba(0,0,0,0.85)',
  display: 'flex', justifyContent: 'center', alignItems: 'center',
  zIndex: 2100, backdropFilter: 'blur(8px)', padding: 20,
}
const modalStyle: CSSProperties = {
  background: '#1a1a1a', width: '100%', maxWidth: 480,
  maxHeight: '90vh', overflowY: 'auto',
  borderRadius: 16, border: '2px solid #f0c030',
  padding: '24px 24px 32px 24px', position: 'relative',
}
const closeBtnStyle: CSSProperties = {
  background: 'none', border: 'none', color: '#888',
  fontSize: 24, cursor: 'pointer', padding: 4,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
const sectionHeaderStyle: CSSProperties = {
  fontSize: 11, fontWeight: 900, color: '#f0c030', letterSpacing: 1.5,
  marginBottom: 12, borderBottom: '1px solid #333', paddingBottom: 6,
}
const closePrimaryBtnStyle: CSSProperties = {
  background: '#f0c030', color: '#000', border: 'none',
  padding: '12px 32px', borderRadius: 8, fontWeight: 900,
  cursor: 'pointer', fontSize: 14, letterSpacing: 1,
}

// Tug-of-war track — same visual language as StatsDashboard.tsx's MY STYLE
// tab (gold = me, purple #7a68a8 = the other side).
const tugTrackStyle: CSSProperties = {
  position: 'relative', height: 14, background: '#221609', borderRadius: 7, overflow: 'hidden',
}
const tugClineStyle: CSSProperties = {
  position: 'absolute', left: '50%', top: 0, bottom: 0, width: 2, background: '#554', zIndex: 2,
}
const tugPullBaseStyle: CSSProperties = {
  position: 'absolute', top: 2, bottom: 2, borderRadius: 6,
}

const edgeFinderStyle: CSSProperties = {
  background: 'rgba(240,192,48,.10)', border: '1px solid rgba(240,192,48,.35)', borderRadius: 12,
  padding: '10px 12px', fontSize: 12.5, color: '#f0e0b0', marginTop: 14, lineHeight: 1.45, fontWeight: 600,
}
const calloutStyle: CSSProperties = {
  background: 'rgba(122,104,168,.12)', border: '1px solid rgba(122,104,168,.35)', borderRadius: 12,
  padding: '10px 12px', fontSize: 12.5, color: '#d8d0e8', lineHeight: 1.4,
}
const notEnoughDataStyle: CSSProperties = {
  color: '#666', fontStyle: 'italic', fontSize: 12, padding: '4px 0 13px 0',
}
const matchLabelStyle: CSSProperties = {
  fontSize: 10, color: '#776', fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4,
}
const gameChipRowStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '6px 8px', borderBottom: '1px solid #222',
}
const chipBaseStyle: CSSProperties = {
  marginLeft: 'auto', fontSize: 10, fontWeight: 900, borderRadius: 4, padding: '1px 6px',
}
const wChipStyle: CSSProperties = { ...chipBaseStyle, background: 'rgba(64,192,87,.15)', color: '#40c057', border: '1px solid rgba(64,192,87,.4)' }
const lChipStyle: CSSProperties = { ...chipBaseStyle, background: 'rgba(224,80,80,.15)', color: '#e05050', border: '1px solid rgba(224,80,80,.4)' }

#!/usr/bin/env node
// tools/mlogs/analyze.mjs
//
// Re-runnable ISMCTS / match_logs analyzer, ported (metric-for-metric) from a
// one-off Python script run over the vjaipur `match_logs` D1 table
// (2026-07-27, corpus: 87 Vijay-vs-ISMCTS games). See
// docs/ai/2026-07-27-ismcts-baseline-eval.md for the frozen baseline this
// script's output is compared against.
//
// Two modes:
//   --pull    shells out to `npx wrangler d1 execute vjaipur --remote --json`
//             (run from worker/) to dump match_logs + matches + players into
//             tools/mlogs/data/ (gitignored).
//   (default) reads tools/mlogs/data/ and prints a markdown report: a BOT
//             (ISMCTS) health block, then a PER-PLAYER STYLE REPORT for every
//             account with >=5 logged games (or the one --account filtered
//             to).
//
// Data facts (see src/store/aiGameLog.ts for the authoritative shapes):
//   - match_logs(id, account_id, opponent_type, timestamp, log, created_at)
//     `log` is a JSON string of AiLogEntry[].
//   - matches(timestamp, won, player_score, opponent_score, account_id,
//     opponent_type) joins to match_logs by `timestamp`.
//   - players(account_id, display_name) gives human-readable names.
//   - Human is always player 0, AI is always player 1 in every preState
//     snapshot (vs-AI mode pins myIndex=0).
//   - preState may be stripped (capLogForReport) off the OLDEST entries of a
//     very long match to fit the wire-size budget — every metric below that
//     reads preState must (and does) tolerate it being absent.
//
// No dependencies beyond Node's stdlib — this repo is TS/Node, and this tool
// intentionally has no Python dependency.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

// ---------------------------------------------------------------------------
// Constants (identical to analyze.py)
// ---------------------------------------------------------------------------

export const GOOD_ORDER = ['diamond', 'gold', 'silver', 'cloth', 'spice', 'leather']
export const PRECIOUS = new Set(['diamond', 'gold', 'silver'])

// ---------------------------------------------------------------------------
// Small stats helpers (ported to match Python's `statistics` module exactly —
// in particular `quantiles(data, n=10, method='exclusive')`, the default
// CPython uses, so p10/p90 reproduce the baseline bit-for-bit).
// ---------------------------------------------------------------------------

export function mean(nums) {
  if (!nums.length) return NaN
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

export function median(nums) {
  if (!nums.length) return NaN
  const s = [...nums].sort((a, b) => a - b)
  const n = s.length
  const mid = Math.floor(n / 2)
  return n % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Port of CPython's statistics.quantiles(data, n=n, method='exclusive'):
 *  returns n-1 cut points. Default n=10 -> deciles; result[0] is p10,
 *  result[8] is p90. */
export function quantilesExclusive(nums, n = 10) {
  const data = [...nums].sort((a, b) => a - b)
  const ld = data.length
  if (ld < 2) return []
  const m = ld + 1
  const result = []
  for (let i = 1; i < n; i++) {
    let j = Math.floor((i * m) / n)
    j = j < 1 ? 1 : j > ld - 1 ? ld - 1 : j
    const delta = i * m - j * n
    result.push((data[j - 1] * (n - delta) + data[j] * delta) / n)
  }
  return result
}

function pct(n, tot) {
  return tot ? (100 * n) / tot : 0
}

// ---------------------------------------------------------------------------
// Parsing / joining raw D1 dump rows into games
// ---------------------------------------------------------------------------

/** `row.log` is a JSON string in the raw D1 dump; already-parsed arrays (as
 *  used by the test fixtures) pass through untouched. Returns null (not
 *  throws) on malformed JSON, matching analyze.py's `except: continue`. */
export function parseLogEntries(raw) {
  if (Array.isArray(raw)) return raw
  if (typeof raw !== 'string') return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * Turn raw match_logs rows (as returned by `wrangler d1 execute --json`,
 * i.e. `{id, account_id, opponent_type?, timestamp, log}`) into game
 * objects. Rows whose `log` fails to parse are dropped (matches
 * analyze.py).
 * @param {Array<{id: number, account_id?: string|null, opponent_type?: string|null, timestamp: number, log: string|any[]}>} matchLogRows
 * @returns {Array<{id: number, accountId: string|null, timestamp: number, tier: string|null, log: any[]}>}
 */
export function buildGames(matchLogRows) {
  const games = []
  for (const row of matchLogRows) {
    const entries = parseLogEntries(row.log)
    if (!entries) continue
    games.push({
      id: row.id,
      accountId: row.account_id ?? null,
      timestamp: row.timestamp,
      // Prefer the column if the dump has it; else derive from the first
      // entry that carries a `tier` (every entry does in practice).
      tier: row.opponent_type ?? entries.find((e) => e.tier)?.tier ?? null,
      log: entries,
    })
  }
  return games
}

/** Normalize raw `matches` rows and backfill `account_id`/`opponent_type`
 *  when the dump doesn't carry them (older/narrower SELECTs — see the
 *  lead's original one-off dump), using the timestamp join against
 *  `games` (which always carries account_id from match_logs, and a
 *  derivable tier). Falls back to "the corpus's one known account/tier"
 *  when a matches row still can't be attributed and the corpus is
 *  unambiguous (single account, single tier) — the common case today.
 *  Returns { matches, note } where `note` documents how many rows were
 *  backfilled/inferred, for the report's transparency.
 * @param {Array<{accountId: string|null, timestamp: number, tier: string|null}>} games
 * @param {Array<{timestamp: number, won: number|boolean, player_score?: number, opponent_score?: number, account_id?: string|null, opponent_type?: string|null}>} matchRows
 * @returns {{matches: Array<{timestamp: number, won: boolean, playerScore: number|undefined, opponentScore: number|undefined, accountId: string|null, opponentType: string|null}>, note: {total: number, backfilledFromLogJoin: number, inferredFromSoleAccount: number}}}
 */
export function joinOutcomes(games, matchRows) {
  const tsToAccount = new Map()
  const tsToTier = new Map()
  for (const g of games) {
    if (g.accountId) tsToAccount.set(g.timestamp, g.accountId)
    if (g.tier) tsToTier.set(g.timestamp, g.tier)
  }
  const knownAccounts = new Set(tsToAccount.values())
  const knownTiers = new Set(tsToTier.values())

  let backfilled = 0
  let inferredFromSoleKnown = 0
  const matches = matchRows.map((r) => {
    let accountId = r.account_id ?? null
    let opponentType = r.opponent_type ?? null
    if (!accountId && tsToAccount.has(r.timestamp)) {
      accountId = tsToAccount.get(r.timestamp)
      backfilled++
    }
    if (!opponentType && tsToTier.has(r.timestamp)) {
      opponentType = tsToTier.get(r.timestamp)
    }
    if (!accountId && knownAccounts.size === 1) {
      accountId = [...knownAccounts][0]
      inferredFromSoleKnown++
    }
    if (!opponentType && knownTiers.size === 1) {
      opponentType = [...knownTiers][0]
    }
    return {
      timestamp: r.timestamp,
      won: !!r.won,
      playerScore: r.player_score,
      opponentScore: r.opponent_score,
      accountId,
      opponentType,
    }
  })

  const note = { total: matchRows.length, backfilledFromLogJoin: backfilled, inferredFromSoleAccount: inferredFromSoleKnown }
  return { matches, note }
}

/**
 * Attach `.outcome` (the matching `matches` row, or null) to each game by
 * timestamp.
 * @template {{timestamp: number}} G
 * @param {G[]} games
 * @param {Array<{timestamp: number, won: boolean}>} matches
 * @returns {Array<G & {outcome: {timestamp: number, won: boolean} | null}>}
 */
export function attachOutcomes(games, matches) {
  const byTs = new Map(matches.map((m) => [m.timestamp, m]))
  return games.map((g) => ({ ...g, outcome: byTs.get(g.timestamp) ?? null }))
}

/** Resolve a CLI `--account` value (an id, or a display_name / substring of
 *  one) to an account_id. Falls back to treating the input as a raw id if
 *  no player match is found (so `--account <id>` always works even without
 *  a players dump). */
export function resolveAccountId(input, players) {
  if (!input) return null
  if (players.has(input)) return input
  const lower = input.toLowerCase()
  for (const [id, name] of players) {
    if (name && name.toLowerCase() === lower) return id
  }
  for (const [id, name] of players) {
    if (name && name.toLowerCase().includes(lower)) return id
  }
  return input
}

// ---------------------------------------------------------------------------
// Core metrics — one pass over games' log entries, mirroring analyze.py's
// single loop body metric-for-metric. Every counter below is a plain Map
// (insertion order preserved; formatting sorts explicitly where analyze.py
// did, see fmtActionMix/fmtSellSizes).
// ---------------------------------------------------------------------------

function bump(map, key, n = 1) {
  map.set(key, (map.get(key) ?? 0) + n)
}

/** The main aggregator. `games` must already be outcome-joined (each has
 *  `.outcome`) and filtered to whatever scope (account/tier) the caller
 *  wants stats for. Only games with a non-null `.outcome` contribute (same
 *  as analyze.py's `matched` list) — the caller is expected to have already
 *  filtered to those, but this function re-filters defensively so it's safe
 *  to call directly in tests. */
export function computeCorpusStats(games) {
  const matched = games.filter((g) => g.outcome)

  const top1Visits = []
  const top1Share = []
  const qs = []
  let nearTies = 0
  let nAiMoves = 0
  const qByResult = { win: [], loss: [] }
  const sellSizes = { human: new Map(), ai: new Map() }
  const actionMix = { human: new Map(), ai: new Map() }
  // key = min(quantity, 5), only for quantity >= 3 — deliberately mirrors
  // analyze.py's `bonus_earned[who][min(q, 5)] += 1`: "3+"/"4+"/"5+" in the
  // printed report are really "quantity == 3" / "== 4" / ">= 5", not
  // cumulative "at least" buckets. Keep it exactly this way — see
  // docs/ai/2026-07-27-ismcts-baseline-eval.md.
  const bonusEarned = { human: new Map(), ai: new Map() }
  const preciousSells = { human: new Map(), ai: new Map() } // key = quantity sold
  const takeCamelHerd = { human: [], ai: [] }
  const tokensPerCard = { human: [], ai: [] }
  // top1/top2 visit ratios, for near-tie % and decisiveness thresholds —
  // same eligibility as top1Share: candidates.length >= 2 and
  // candidates[1].visits > 0.
  const ratios = []

  for (const g of matched) {
    const botWon = !g.outcome.won
    for (const e of g.log) {
      const a = e.action ?? {}
      const t = a.type
      const who = e.actor
      if (!actionMix[who]) continue // defensive: unknown actor label
      bump(actionMix[who], t)
      const pre = e.preState

      if (t === 'SELL') {
        const q = a.quantity ?? 0
        bump(sellSizes[who], q)
        if (q >= 3) bump(bonusEarned[who], Math.min(q, 5))
        if (PRECIOUS.has(a.good)) bump(preciousSells[who], q)
        if (pre) {
          const gi = GOOD_ORDER.indexOf(a.good)
          if (gi !== -1) {
            const pile = pre.tok[gi] ?? []
            const got = pile.slice(0, q).reduce((s, v) => s + v, 0)
            tokensPerCard[who].push(got / q)
          }
        }
      }

      if (t === 'TAKE_CAMELS' && pre) {
        takeCamelHerd[who].push(pre.herd[who === 'human' ? 0 : 1])
      }

      if (who === 'ai') {
        nAiMoves++
        const cands = e.candidates
        if (cands && cands.length) {
          const tv = cands[0].visits
          top1Visits.push(tv)
          const tot = cands.reduce((s, c) => s + c.visits, 0)
          if (cands.length >= 2 && cands[1].visits > 0) {
            const ratio = cands[0].visits / Math.max(1, cands[1].visits)
            if (ratio < 1.15) nearTies++
            top1Share.push(cands[0].visits / Math.max(1, tot))
            ratios.push(ratio)
          }
          qs.push(cands[0].q)
          qByResult[botWon ? 'win' : 'loss'].push(cands[0].q)
        }
      }
    }
  }

  return {
    nMatched: matched.length,
    top1Visits,
    top1Share,
    qs,
    nearTies,
    nAiMoves,
    qByResult,
    sellSizes,
    actionMix,
    bonusEarned,
    preciousSells,
    takeCamelHerd,
    tokensPerCard,
    ratios,
  }
}

/** % of eligible ai moves whose top1/top2 visit ratio is >= each threshold.
 *  "Eligible" = same population as `ratios` in computeCorpusStats (>=2
 *  candidates, candidates[1].visits > 0). */
export function decisivenessPct(ratios, thresholds = [2, 3, 5, 10]) {
  if (!ratios.length) return thresholds.map((t) => ({ t, pct: null }))
  return thresholds.map((t) => ({ t, pct: (100 * ratios.filter((r) => r >= t).length) / ratios.length }))
}

/** Score trajectory (human minus bot) by game-phase quartile, over
 *  `preState`-bearing entries only (an entry can be missing preState if it
 *  was capped off a very long match's oldest entries). Ports analyze.py's
 *  `ph = min(3, int(4*i/n))` bucketing exactly. */
export function computeScoreTrajectoryPhases(games) {
  const buckets = { 0: [], 1: [], 2: [], 3: [] }
  for (const g of games) {
    const entries = g.log.filter((e) => e.preState)
    const n = entries.length
    if (!n) continue
    entries.forEach((e, i) => {
      const ph = Math.min(3, Math.floor((4 * i) / n))
      const s = e.preState.score
      buckets[ph].push(s[0] - s[1])
    })
  }
  return buckets
}

/** Who made the last move of each COMPLETED round (mid-match transitions,
 *  no suffix), plus who made the very last move of the whole match
 *  ("<actor>_final", one per game). Ports analyze.py's `trig` Counter
 *  exactly, including the quirk that today's corpus is single-round-per-log
 *  so only the "_final" keys ever populate — see baseline doc. */
export function computeRoundEndTrigger(games) {
  const matched = games.filter((g) => g.outcome)
  const trig = new Map()
  for (const g of matched) {
    let prevRound = null
    const log = g.log
    for (let i = 0; i < log.length; i++) {
      const e = log[i]
      if (prevRound !== null && e.round !== prevRound) bump(trig, log[i - 1].actor)
      prevRound = e.round
    }
    if (log.length) bump(trig, log[log.length - 1].actor + '_final')
  }
  return trig
}

/**
 * Overall win/loss record from the `matches` table (independent of whether
 * a game has a log) — the "overall" half of "overall NNW-NNL (logged
 * subset X-Y)".
 * @param {Array<{accountId: string|null, opponentType: string|null, won: boolean}>} matches
 * @param {{account?: string|null, tier?: string|null}} [opts]
 * @returns {{wins: number, losses: number, total: number}}
 */
export function computeRecord(matches, { account = null, tier = null } = {}) {
  let rows = matches
  if (account) rows = rows.filter((m) => m.accountId === account)
  if (tier) rows = rows.filter((m) => m.opponentType === tier)
  const wins = rows.filter((m) => m.won).length
  return { wins, losses: rows.length - wins, total: rows.length }
}

// ---------------------------------------------------------------------------
// Formatting (markdown to stdout)
// ---------------------------------------------------------------------------

function fmtActionMix(counter) {
  const tot = [...counter.values()].reduce((a, b) => a + b, 0)
  const entries = [...counter.entries()].sort((a, b) => b[1] - a[1])
  return { tot, text: entries.map(([k, v]) => `${k}:${pct(v, tot).toFixed(0)}%`).join('  ') }
}

function fmtSellSizes(counter) {
  const tot = [...counter.values()].reduce((a, b) => a + b, 0)
  const entries = [...counter.entries()].sort((a, b) => a[0] - b[0])
  return { tot, text: entries.map(([q, v]) => `${q}c:${pct(v, tot).toFixed(0)}%`).join('  ') }
}

function fmtMapCompact(map) {
  return '{' + [...map.entries()].map(([k, v]) => `${k}: ${v}`).join(', ') + '}'
}

function fmtSigned(n, digits = 3) {
  return (n >= 0 ? '+' : '') + n.toFixed(digits)
}

export function formatBotHealth(stats, { label = 'all logged games' } = {}) {
  const lines = []
  lines.push(`## BOT (ISMCTS) health — ${label}`)
  lines.push('')
  lines.push(`- games with outcome joined: ${stats.nMatched}`)
  lines.push(`- ai moves: ${stats.nAiMoves}, with candidates: ${stats.top1Visits.length}`)
  if (stats.top1Visits.length) {
    const q = quantilesExclusive(stats.top1Visits, 10)
    const p10 = q[0]
    const p90 = q[8]
    lines.push(
      `- top1 visits (ISMCTS iterations landing on the eventual best move): median ${median(stats.top1Visits).toFixed(0)}  p10 ${p10.toFixed(0)}  p90 ${p90.toFixed(0)}  min ${Math.min(...stats.top1Visits)}`
    )
  }
  if (stats.top1Share.length) {
    lines.push(`- top1 share of top3 visits: median ${median(stats.top1Share).toFixed(2)}`)
  }
  const nearTiePct = stats.top1Visits.length ? (100 * stats.nearTies) / stats.top1Visits.length : 0
  lines.push(`- near-ties (top1/top2 visits < 1.15): ${stats.nearTies} (${nearTiePct.toFixed(0)}%)`)
  if (stats.ratios.length) {
    const dec = decisivenessPct(stats.ratios)
    lines.push(`- decisiveness (top1/top2 visit ratio): ${dec.map((d) => `>=${d.t}x ${d.pct.toFixed(0)}%`).join('  ')}`)
  }
  if (stats.qs.length) {
    lines.push(`- root q (bot's perspective): mean ${fmtSigned(mean(stats.qs))}`)
    if (stats.qByResult.win.length) lines.push(`  - in games bot WON:  mean ${fmtSigned(mean(stats.qByResult.win))}  (n=${stats.qByResult.win.length})`)
    if (stats.qByResult.loss.length) lines.push(`  - in games bot LOST: mean ${fmtSigned(mean(stats.qByResult.loss))}  (n=${stats.qByResult.loss.length})`)
  }
  lines.push(
    `- earlyStopped fire-rate: not available — \`IsmctsCandidateLog\` (src/store/aiGameLog.ts) doesn't carry the \`earlyStopped\` field yet, only \`IsmctsDebugInfo\` does. Add it to the logger if/when this needs measuring in the wild.`
  )
  return lines.join('\n')
}

export function formatPlayerReport(name, accountId, stats, record, loggedRecord, trajWins, trajLosses, roundEndTrigger) {
  const lines = []
  lines.push(`## ${name} (${accountId})`)
  lines.push('')
  lines.push(`- record: overall ${record.wins}W-${record.losses}L (${record.total} matches)  ·  logged subset ${loggedRecord.wins}W-${loggedRecord.losses}L (${loggedRecord.total} games)`)
  lines.push('')
  lines.push('**Action mix (per-move %)**')
  for (const who of ['human', 'ai']) {
    const { tot, text } = fmtActionMix(stats.actionMix[who])
    lines.push(`- ${who} n=${tot}  ${text}`)
  }
  lines.push('')
  lines.push('**Sell size distribution**')
  for (const who of ['human', 'ai']) {
    const { tot, text } = fmtSellSizes(stats.sellSizes[who])
    const b = stats.bonusEarned[who]
    const pAt2 = stats.preciousSells[who].get(2) ?? 0
    const pTot = [...stats.preciousSells[who].values()].reduce((a, b2) => a + b2, 0)
    lines.push(`- ${who} sales=${tot}  ${text}`)
    lines.push(`  bonus sales: 3+:${b.get(3) ?? 0}  4+:${b.get(4) ?? 0}  5+:${b.get(5) ?? 0}   precious sells@2: ${pAt2} of ${pTot}`)
  }
  lines.push('')
  lines.push('**Tokens-per-card efficiency (from pile state at sale)**')
  lines.push(`- human avg tokens/card sold: ${mean(stats.tokensPerCard.human).toFixed(2)}   bot: ${mean(stats.tokensPerCard.ai).toFixed(2)}`)
  lines.push('')
  lines.push('**Camels**')
  for (const who of ['human', 'ai']) {
    const h = stats.takeCamelHerd[who]
    if (h.length) lines.push(`- ${who} TAKE_CAMELS n=${h.length}  herd-before median ${median(h).toFixed(0)}`)
  }
  lines.push('')
  lines.push('**Score trajectory (human minus bot, by game phase)**')
  const trajLine = (label, buckets) => {
    const parts = [0, 1, 2, 3].map((p) => (buckets[p].length ? `P${p}:${fmtSigned(mean(buckets[p]), 1)}` : `P${p}:n/a`))
    return `- ${label}  ${parts.join('  ')}`
  }
  lines.push(trajLine('WINS  ', trajWins))
  lines.push(trajLine('LOSSES', trajLosses))
  lines.push('')
  lines.push('**Round-end trigger (who made the last move)**')
  lines.push(`- ${fmtMapCompact(roundEndTrigger)}`)
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Data loading (wrangler --json dump files, as written by --pull)
// ---------------------------------------------------------------------------

function readWranglerDump(file) {
  if (!fs.existsSync(file)) return []
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  const rows = []
  for (const stmt of parsed) {
    for (const row of stmt.results ?? []) rows.push(row)
  }
  return rows
}

function loadMatchLogRows(dataDir) {
  if (!fs.existsSync(dataDir)) return []
  const files = fs
    .readdirSync(dataDir)
    .filter((f) => /^batch_.*\.json$/.test(f))
    .sort()
  const rows = []
  for (const f of files) rows.push(...readWranglerDump(path.join(dataDir, f)))
  return rows
}

function loadMatchesRows(dataDir) {
  return readWranglerDump(path.join(dataDir, 'matches.json'))
}

function loadPlayersRows(dataDir) {
  return readWranglerDump(path.join(dataDir, 'players.json'))
}

function groupByAccount(games) {
  const m = new Map()
  for (const g of games) {
    if (!g.accountId) continue
    if (!m.has(g.accountId)) m.set(g.accountId, [])
    m.get(g.accountId).push(g)
  }
  return m
}

// ---------------------------------------------------------------------------
// Report mode
// ---------------------------------------------------------------------------

function runReport(dataDir, args) {
  const matchLogRows = loadMatchLogRows(dataDir)
  if (!matchLogRows.length) {
    console.error(`No match_logs dump found in ${dataDir} — run \`node tools/mlogs/analyze.mjs --pull\` first.`)
    process.exitCode = 1
    return
  }
  const matchRows = loadMatchesRows(dataDir)
  const playerRows = loadPlayersRows(dataDir)
  const players = new Map(playerRows.map((p) => [p.account_id, p.display_name]))

  const rawGames = buildGames(matchLogRows)
  const { matches, note } = joinOutcomes(rawGames, matchRows)
  let games = attachOutcomes(rawGames, matches)

  const tierFilter = args.tier ?? null
  const accountFilter = args.account ? resolveAccountId(args.account, players) : null

  let scoped = games
  if (tierFilter) scoped = scoped.filter((g) => g.tier === tierFilter)
  if (accountFilter) scoped = scoped.filter((g) => g.accountId === accountFilter)

  const scopeLabel = [tierFilter ? `tier=${tierFilter}` : null, accountFilter ? `account=${players.get(accountFilter) ?? accountFilter}` : null]
    .filter(Boolean)
    .join(', ') || 'all logged games'

  console.log(`# match_logs analysis — ${scopeLabel}`)
  console.log('')
  console.log(`corpus: ${matchLogRows.length} match_logs rows loaded, ${scoped.length} in scope, ${scoped.filter((g) => g.outcome).length} with outcome joined`)
  if (note.backfilledFromLogJoin || note.inferredFromSoleAccount) {
    console.log(
      `note: ${note.backfilledFromLogJoin} of ${note.total} \`matches\` rows had no account_id/opponent_type in the dump and were backfilled via the timestamp join to match_logs` +
        (note.inferredFromSoleAccount ? `; ${note.inferredFromSoleAccount} more were attributed to the corpus's single known account (unambiguous today — will need real columns once a second player/tier shows up).` : '.')
    )
  }
  console.log('')

  const botStats = computeCorpusStats(scoped)
  console.log(formatBotHealth(botStats, { label: scopeLabel }))
  console.log('')

  const grouped = groupByAccount(scoped.filter((g) => g.outcome))
  for (const [accId, accGames] of grouped) {
    if (!accountFilter && accGames.length < 5) continue
    const name = players.get(accId) ?? accId
    const stats = computeCorpusStats(accGames)
    const record = computeRecord(matches, { account: accId, tier: tierFilter })
    const loggedWins = accGames.filter((g) => g.outcome.won).length
    const loggedRecord = { wins: loggedWins, losses: accGames.length - loggedWins, total: accGames.length }
    const trajWins = computeScoreTrajectoryPhases(accGames.filter((g) => g.outcome.won))
    const trajLosses = computeScoreTrajectoryPhases(accGames.filter((g) => !g.outcome.won))
    const roundEndTrigger = computeRoundEndTrigger(accGames)
    console.log(formatPlayerReport(name, accId, stats, record, loggedRecord, trajWins, trajLosses, roundEndTrigger))
    console.log('')
  }
}

// ---------------------------------------------------------------------------
// Pull mode
// ---------------------------------------------------------------------------

function runWrangler(workerDir, sql) {
  const res = spawnSync('npx', ['wrangler', 'd1', 'execute', 'vjaipur', '--remote', '--json', '--command', sql], {
    cwd: workerDir,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 64,
  })
  if (res.status !== 0) {
    throw new Error(`wrangler d1 execute failed (exit ${res.status}):\n${res.stderr || res.stdout}`)
  }
  return res.stdout
}

function pullMode(dataDir, repoRoot) {
  const workerDir = path.join(repoRoot, 'worker')
  if (!fs.existsSync(workerDir)) {
    throw new Error(`worker/ not found at ${workerDir} — --pull must run from inside the vjaipur repo`)
  }
  fs.mkdirSync(dataDir, { recursive: true })

  console.log('Fetching match_logs id list...')
  const idListOut = runWrangler(workerDir, 'SELECT id FROM match_logs ORDER BY id')
  const idListParsed = JSON.parse(idListOut)
  const ids = (idListParsed[0]?.results ?? []).map((r) => r.id)
  console.log(`  ${ids.length} rows`)

  const BATCH = 15
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH)
    const sql = `SELECT id, account_id, opponent_type, timestamp, log FROM match_logs WHERE id IN (${chunk.join(',')}) ORDER BY id`
    const out = runWrangler(workerDir, sql)
    const file = path.join(dataDir, `batch_${chunk[0]}.json`)
    fs.writeFileSync(file, out)
    console.log(`  wrote ${path.basename(file)} (${chunk.length} rows)`)
  }

  console.log('Fetching matches...')
  const matchesOut = runWrangler(workerDir, 'SELECT timestamp, won, player_score, opponent_score, account_id, opponent_type FROM matches')
  fs.writeFileSync(path.join(dataDir, 'matches.json'), matchesOut)

  console.log('Fetching players...')
  const playersOut = runWrangler(workerDir, 'SELECT account_id, display_name FROM players')
  fs.writeFileSync(path.join(dataDir, 'players.json'), playersOut)

  console.log(`Done. Data in ${dataDir}`)
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `match_logs / ISMCTS analyzer

Usage:
  node tools/mlogs/analyze.mjs --pull
      Pull match_logs, matches, and players from the remote D1 database
      (vjaipur) into tools/mlogs/data/ via \`npx wrangler d1 execute\`,
      run with cwd=worker/. Requires wrangler auth (may prompt). Batches
      match_logs by id (15/query) to stay under D1's per-response size limit.

  node tools/mlogs/analyze.mjs [--account <id|name>] [--tier <tier>]
      Read tools/mlogs/data/ (must exist — run --pull first, or see
      docs/ai/2026-07-27-ismcts-baseline-eval.md for how the baseline dump
      was captured) and print a markdown report to stdout:
        - a BOT (ISMCTS) health block (iterations/top1-share/near-ties/
          decisiveness/q-calibration)
        - a PER-PLAYER STYLE REPORT for every account with >=5 logged games
          (or just the one --account names, regardless of count)

  --account <id|name>   Restrict to one account (matches account_id, or a
                         case-insensitive substring of players.display_name).
  --tier <tier>          Restrict to one AI tier, e.g. ismcts, hard2, medium.
  --data-dir <path>      Override the data directory (default tools/mlogs/data).
  --help, -h              Show this help.

Metric definitions are a faithful, unmodified port of the one-off Python
analysis this tool replaces — see the comment header of this file and
docs/ai/2026-07-27-ismcts-baseline-eval.md for the frozen baseline they're
meant to keep comparing against.
`

function parseArgs(argv) {
  const args = { pull: false, account: null, tier: null, dataDir: null, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--pull') args.pull = true
    else if (a === '--account') args.account = argv[++i] ?? null
    else if (a === '--tier') args.tier = argv[++i] ?? null
    else if (a === '--data-dir') args.dataDir = argv[++i] ?? null
    else if (a === '--help' || a === '-h') args.help = true
  }
  return args
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(USAGE)
    return
  }
  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  const repoRoot = path.resolve(scriptDir, '..', '..')
  const dataDir = args.dataDir ? path.resolve(args.dataDir) : path.join(scriptDir, 'data')

  if (args.pull) {
    pullMode(dataDir, repoRoot)
    return
  }
  runReport(dataDir, args)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()

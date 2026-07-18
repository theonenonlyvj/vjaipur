#!/usr/bin/env node
// worker/scripts/migrate-stats.mjs
//
// One-off Supabase (legacy relay) -> D1 (vjaipur-worker) stats migration.
// Zero npm deps (Node's built-in fetch/fs/path only).
//
// Two halves:
//   1. A PURE transform (transformMatches/emitSql/sqlEscape) — unit-tested
//      against fixtures in migrate-stats.test.mjs. No network, no fs.
//   2. A thin `--live` CLI wrapper that pulls real rows from Supabase's REST
//      API, runs the transform, and writes the SQL + report artifacts to
//      worker/scripts/out/. NEVER invoked by the test suite; NEVER run
//      without explicit `--live` + real env creds.
//
// Real Supabase columns (discovered from server/db.ts + server/index.ts,
// the actual read/write path, not just docs/operations/supabase-schema.md):
//   players: id, friend_code, display_name, secret_key, created_at,
//            vgames_account_id (nullable dual-run bridge column)
//   matches: player_id, opponent_type, opponent_id, player_score,
//            opponent_score, won, timestamp (stored as an ISO string —
//            recordMatch() does `new Date(match.timestamp).toISOString()`)
//
// Migration rules (base spec §6/§8 + ADDENDUM sections U/V — the addendum
// OVERRIDES the base spec where they conflict):
//   - player_id -> players.vgames_account_id (canonical D1 account_id).
//     Rows whose player has no vgames_account_id are SKIPPED and counted.
//   - opponent_account_id is ALWAYS NULL (ADDENDUM U). Legacy `opponent_id`
//     is a self-reported friend_code (VJ-####/VG-####), not a players.id —
//     there is no reliable join from it to an account. Do NOT attempt one.
//   - opponent_type is carried over VERBATIM ('online' stays 'online', AI
//     tier ids like 'hard3' stay as-is) — ADDENDUM S: the app's existing
//     filters key on these literal strings.
//   - timestamp: ISO string -> epoch-ms integer via `new Date(x).getTime()`
//     (ADDENDUM V). Rows with an unparseable timestamp (NaN, not a safe
//     integer) are SKIPPED and counted.
//   - source = 'client_reported', ai_covered = 0, game_uuid = NULL for every
//     migrated row (these are all legacy locally-reported matches, never
//     server-authoritative online games).
//   - created_at = the same epoch-ms value as timestamp (no separate
//     created-at column exists upstream).

import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const SCRIPT_DIR = path.dirname(__filename)
const OUT_DIR = path.join(SCRIPT_DIR, 'out')

// ─────────────────────────────────────────────────────────────────────────
// Pure core
// ─────────────────────────────────────────────────────────────────────────

/**
 * @param {Array<{id: string, vgames_account_id?: string|null}>} supabasePlayers
 * @param {Array<{player_id: string, opponent_type: string, opponent_id: string|null,
 *   player_score: number, opponent_score: number, won: boolean, timestamp: string|number}>} supabaseMatches
 * @returns {{ inserts: object[], report: object }}
 */
export function transformMatches(supabasePlayers, supabaseMatches) {
  const accountByPlayerId = new Map()
  for (const p of supabasePlayers ?? []) {
    accountByPlayerId.set(p.id, p.vgames_account_id ?? null)
  }

  const inserts = []
  const report = {
    total: (supabaseMatches ?? []).length,
    migrated: 0,
    skippedNoAccount: 0,
    skippedBadTimestamp: 0,
    byOpponentType: {},
  }

  for (const m of supabaseMatches ?? []) {
    const accountId = accountByPlayerId.get(m.player_id)
    if (!accountId) {
      report.skippedNoAccount++
      continue
    }

    const epochMs = new Date(m.timestamp).getTime()
    if (!Number.isSafeInteger(epochMs)) {
      report.skippedBadTimestamp++
      continue
    }

    const row = {
      account_id: accountId,
      opponent_type: m.opponent_type,
      // ADDENDUM U — opponent_id is a spoofable, self-reported friend_code,
      // never a players.id. No join is attempted; this is always NULL.
      opponent_account_id: null,
      player_score: m.player_score,
      opponent_score: m.opponent_score,
      won: m.won ? 1 : 0,
      source: 'client_reported',
      ai_covered: 0,
      game_uuid: null,
      timestamp: epochMs,
      created_at: epochMs,
    }
    inserts.push(row)
    report.migrated++
    report.byOpponentType[m.opponent_type] = (report.byOpponentType[m.opponent_type] ?? 0) + 1
  }

  return { inserts, report }
}

/** Escapes a value for inline SQL literal use (single quotes doubled). */
export function sqlEscape(value) {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`sqlEscape: cannot emit non-finite number: ${value}`)
    return String(value)
  }
  if (typeof value === 'boolean') return value ? '1' : '0'
  return `'${String(value).replace(/'/g, "''")}'`
}

const MATCH_COLUMNS = [
  'account_id', 'opponent_type', 'opponent_account_id', 'player_score',
  'opponent_score', 'won', 'source', 'ai_covered', 'game_uuid',
  'timestamp', 'created_at',
]

/**
 * @param {object[]} inserts rows shaped like transformMatches()'s output
 * @returns {string} newline-joined INSERT statements
 */
export function emitSql(inserts) {
  const lines = inserts.map((row) => {
    const values = MATCH_COLUMNS.map((col) => sqlEscape(row[col])).join(', ')
    return `INSERT INTO matches (${MATCH_COLUMNS.join(', ')}) VALUES (${values}) ON CONFLICT(account_id,timestamp,opponent_type) DO NOTHING;`
  })
  return lines.length ? lines.join('\n') + '\n' : ''
}

export function renderReport(report) {
  const lines = []
  lines.push('# Stats Migration Report (Supabase -> D1)')
  lines.push('')
  lines.push(`- Total input matches: ${report.total}`)
  lines.push(`- Migrated: ${report.migrated}`)
  lines.push(`- Skipped (player has no vgames_account_id): ${report.skippedNoAccount}`)
  lines.push(`- Skipped (unparseable timestamp): ${report.skippedBadTimestamp}`)
  lines.push('')
  lines.push('## Per opponent_type tally (migrated rows only)')
  lines.push('')
  const types = Object.keys(report.byOpponentType).sort()
  if (types.length === 0) {
    lines.push('_(none)_')
  } else {
    for (const t of types) {
      lines.push(`- ${t}: ${report.byOpponentType[t]}`)
    }
  }
  lines.push('')
  return lines.join('\n')
}

/** Emit INSERTs to seed the D1 `players` display-name cache the leaderboard
 *  joins on, so migrated accounts show their real names on day one instead of
 *  "Player N" (which otherwise only self-heals once each user next logs in and
 *  requireAuth upserts them). One row per Supabase player that has a canonical
 *  vgames_account_id AND a real (non-Guest_) display name. Idempotent via
 *  ON CONFLICT: refresh the name but never regress last_seen_at. */
export function emitPlayersSql(supabasePlayers, now = 0) {
  const seen = new Set()
  const lines = []
  for (const p of supabasePlayers) {
    const accountId = p.vgames_account_id
    const name = p.display_name
    if (!accountId || seen.has(accountId)) continue
    if (!name || String(name).startsWith('Guest_')) continue // skip anonymous ghosts
    seen.add(accountId)
    lines.push(
      `INSERT INTO players (account_id, display_name, last_seen_at) VALUES (${sqlEscape(accountId)}, ${sqlEscape(name)}, ${sqlEscape(now)}) ` +
        `ON CONFLICT(account_id) DO UPDATE SET display_name=excluded.display_name;`,
    )
  }
  return lines.length ? lines.join('\n') + '\n' : ''
}

/** Writes the SQL + markdown report artifacts to outDir (default worker/scripts/out/). */
export function writeArtifacts(inserts, report, outDir = OUT_DIR, supabasePlayers = null, now = 0) {
  mkdirSync(outDir, { recursive: true })
  const sqlPath = path.join(outDir, 'd1-matches.sql')
  const reportPath = path.join(outDir, 'classification-report.md')
  writeFileSync(sqlPath, emitSql(inserts))
  writeFileSync(reportPath, renderReport(report))
  let playersPath = null
  if (supabasePlayers) {
    playersPath = path.join(outDir, 'd1-players.sql')
    writeFileSync(playersPath, emitPlayersSql(supabasePlayers, now))
  }
  return { sqlPath, reportPath, playersPath }
}

// ─────────────────────────────────────────────────────────────────────────
// Live wrapper — guarded behind --live, never exercised by tests.
// ─────────────────────────────────────────────────────────────────────────

async function fetchSupabaseTable(supabaseUrl, serviceKey, table) {
  const url = `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/${table}?select=*`
  const res = await fetch(url, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '<unreadable body>')
    throw new Error(`Supabase fetch of "${table}" failed: ${res.status} ${res.statusText} — ${body}`)
  }
  return res.json()
}

async function runLive() {
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      'migrate-stats --live: missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY ' +
      'in the environment. Set both (never commit them) and re-run. Refusing to ' +
      'proceed without real credentials.'
    )
    process.exit(1)
    return
  }

  console.log('migrate-stats --live: pulling players + matches from Supabase REST API...')
  const [players, matches] = await Promise.all([
    fetchSupabaseTable(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'players'),
    fetchSupabaseTable(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'matches'),
  ])
  console.log(`migrate-stats --live: pulled ${players.length} players, ${matches.length} matches.`)

  const { inserts, report } = transformMatches(players, matches)
  const { sqlPath, reportPath, playersPath } = writeArtifacts(inserts, report, OUT_DIR, players)

  console.log(renderReport(report))
  console.log(`migrate-stats --live: wrote ${inserts.length} INSERT statements to ${sqlPath}`)
  console.log(`migrate-stats --live: wrote report to ${reportPath}`)
  console.log(`migrate-stats --live: wrote players seed to ${playersPath}`)
  console.log('migrate-stats --live: Supabase itself was left untouched (read-only pull).')
  console.log('Next: wrangler d1 execute vjaipur --remote --file=' + sqlPath)
  console.log('Then: wrangler d1 execute vjaipur --remote --file=' + playersPath)
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--live')) {
    await runLive()
    return
  }
  console.log('migrate-stats.mjs — Supabase -> D1 stats migration.')
  console.log('')
  console.log('This is a pure transform module by default (see transformMatches/emitSql,')
  console.log('exercised by migrate-stats.test.mjs). It does NOT touch Supabase or D1')
  console.log('unless run with --live and both SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set.')
  console.log('')
  console.log('Usage: node worker/scripts/migrate-stats.mjs --live')
}

// Only run the CLI when this file is executed directly (not when imported
// by the test suite).
if (process.argv[1] === __filename) {
  main().catch((err) => {
    console.error('migrate-stats: fatal error:', err)
    process.exit(1)
  })
}

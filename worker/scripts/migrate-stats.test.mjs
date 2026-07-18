// worker/scripts/migrate-stats.test.mjs
//
// Pure fixture-based unit tests for the migration transform. No network, no
// live Supabase/D1 access — run with: node worker/scripts/migrate-stats.test.mjs
// (or `node --test worker/scripts/migrate-stats.test.mjs`).

import test from 'node:test'
import assert from 'node:assert/strict'
import { transformMatches, emitSql, sqlEscape, renderReport } from './migrate-stats.mjs'

// ── Fixtures ────────────────────────────────────────────────────────────

const players = [
  { id: 'p-vijay', friend_code: 'VJ-1234', display_name: 'Vijay', vgames_account_id: 'acct-vijay' },
  { id: 'p-noaccount', friend_code: 'VJ-9999', display_name: "O'Brien", vgames_account_id: null },
]

const baseMatches = [
  // 1. Normal online match — friend_code opponent_id, must be dropped/NULLed.
  {
    player_id: 'p-vijay',
    opponent_type: 'online',
    opponent_id: 'VJ-5678',
    player_score: 42,
    opponent_score: 30,
    won: true,
    timestamp: '2026-05-01T12:00:00.000Z',
  },
  // 2. vs-AI match — tier id must be preserved verbatim.
  {
    player_id: 'p-vijay',
    opponent_type: 'hard3',
    opponent_id: null,
    player_score: 40,
    opponent_score: 35,
    won: true,
    timestamp: '2026-05-02T08:30:00.000Z',
  },
  // 3. Player with no vgames_account_id — must be skipped + counted.
  {
    player_id: 'p-noaccount',
    opponent_type: 'medium',
    opponent_id: null,
    player_score: 10,
    opponent_score: 40,
    won: false,
    timestamp: '2026-05-03T00:00:00.000Z',
  },
  // 4. Bad/unparseable timestamp — must be skipped + counted.
  {
    player_id: 'p-vijay',
    opponent_type: 'easy',
    opponent_id: null,
    player_score: 40,
    opponent_score: 20,
    won: true,
    timestamp: 'not-a-date',
  },
]

test('normal online match: opponent_account_id NULL, timestamp epoch-ms, source client_reported', () => {
  const { inserts, report } = transformMatches(players, [baseMatches[0]])
  assert.equal(inserts.length, 1)
  const row = inserts[0]
  assert.equal(row.account_id, 'acct-vijay')
  assert.equal(row.opponent_type, 'online')
  assert.equal(row.opponent_account_id, null) // ADDENDUM U — never joined
  assert.equal(row.player_score, 42)
  assert.equal(row.opponent_score, 30)
  assert.equal(row.won, 1)
  assert.equal(row.source, 'client_reported')
  assert.equal(row.ai_covered, 0)
  assert.equal(row.game_uuid, null)
  assert.equal(row.timestamp, Date.parse('2026-05-01T12:00:00.000Z'))
  assert.ok(Number.isSafeInteger(row.timestamp))
  assert.equal(row.created_at, row.timestamp)
  assert.equal(report.migrated, 1)
})

test('vs-AI match (hard3): opponent_type preserved verbatim, opponent_account_id NULL', () => {
  const { inserts } = transformMatches(players, [baseMatches[1]])
  assert.equal(inserts.length, 1)
  assert.equal(inserts[0].opponent_type, 'hard3')
  assert.equal(inserts[0].opponent_account_id, null)
})

test('player with no vgames_account_id is skipped and counted', () => {
  const { inserts, report } = transformMatches(players, [baseMatches[2]])
  assert.equal(inserts.length, 0)
  assert.equal(report.skippedNoAccount, 1)
  assert.equal(report.migrated, 0)
})

test('unknown player_id (not present in players at all) is skipped and counted', () => {
  const { inserts, report } = transformMatches(players, [
    { ...baseMatches[0], player_id: 'p-does-not-exist' },
  ])
  assert.equal(inserts.length, 0)
  assert.equal(report.skippedNoAccount, 1)
})

test('ISO-string timestamp converts to the correct epoch ms', () => {
  const iso = '2026-01-15T09:30:00.000Z'
  const { inserts } = transformMatches(players, [{ ...baseMatches[1], timestamp: iso }])
  assert.equal(inserts[0].timestamp, Date.parse(iso))
})

test('bad timestamp is skipped and counted, not thrown', () => {
  const { inserts, report } = transformMatches(players, [baseMatches[3]])
  assert.equal(inserts.length, 0)
  assert.equal(report.skippedBadTimestamp, 1)
  assert.equal(report.migrated, 0)
})

test('full fixture set: report counts add up correctly', () => {
  const { inserts, report } = transformMatches(players, baseMatches)
  assert.equal(report.total, 4)
  assert.equal(report.migrated, 2) // online + hard3
  assert.equal(report.skippedNoAccount, 1)
  assert.equal(report.skippedBadTimestamp, 1)
  assert.equal(inserts.length, 2)
  assert.deepEqual(report.byOpponentType, { online: 1, hard3: 1 })
})

test('won:false maps to 0, not a truthy string', () => {
  const { inserts } = transformMatches(players, [
    { ...baseMatches[1], won: false },
  ])
  assert.equal(inserts[0].won, 0)
})

// ── emitSql ─────────────────────────────────────────────────────────────

test('emitSql includes the dedup ON CONFLICT clause', () => {
  const { inserts } = transformMatches(players, [baseMatches[0]])
  const sql = emitSql(inserts)
  assert.match(sql, /ON CONFLICT\(account_id,timestamp,opponent_type\) DO NOTHING;/)
  assert.match(sql, /^INSERT INTO matches \(/)
})

test('emitSql emits a NULL literal for opponent_account_id and game_uuid', () => {
  const { inserts } = transformMatches(players, [baseMatches[0]])
  const sql = emitSql(inserts)
  // account_id, opponent_type NOT NULL columns; opponent_account_id + game_uuid are NULL.
  assert.match(sql, /VALUES \('acct-vijay', 'online', NULL, 42, 30, 1, 'client_reported', 0, NULL, \d+, \d+\)/)
})

test('emitSql on an empty insert list returns an empty string', () => {
  assert.equal(emitSql([]), '')
})

// ── SQL escaping ────────────────────────────────────────────────────────

test('sqlEscape doubles single quotes in a display value', () => {
  assert.equal(sqlEscape("O'Brien"), "'O''Brien'")
})

test('sqlEscape renders NULL literally for null/undefined', () => {
  assert.equal(sqlEscape(null), 'NULL')
  assert.equal(sqlEscape(undefined), 'NULL')
})

test('sqlEscape passes numbers through unquoted', () => {
  assert.equal(sqlEscape(42), '42')
  assert.equal(sqlEscape(0), '0')
})

test('a display-name-shaped value with an apostrophe round-trips safely through emitSql', () => {
  // account_id is normally a plain vgames account id, but the escaper must be
  // safe for any string field, e.g. an apostrophe-bearing value.
  const { inserts } = transformMatches(
    [{ id: 'p-quote', vgames_account_id: "acct-o'brien" }],
    [{ ...baseMatches[0], player_id: 'p-quote' }],
  )
  const sql = emitSql(inserts)
  assert.match(sql, /'acct-o''brien'/)
  // and NOT the raw unescaped apostrophe followed by "brien'" (which would
  // break out of the SQL string literal)
  assert.doesNotMatch(sql, /'acct-o'brien'/)
})

// ── report rendering ────────────────────────────────────────────────────

test('renderReport includes the skip counts and per-type tally', () => {
  const { report } = transformMatches(players, baseMatches)
  const md = renderReport(report)
  assert.match(md, /Total input matches: 4/)
  assert.match(md, /Migrated: 2/)
  assert.match(md, /no vgames_account_id\): 1/)
  assert.match(md, /unparseable timestamp\): 1/)
  assert.match(md, /- hard3: 1/)
  assert.match(md, /- online: 1/)
})

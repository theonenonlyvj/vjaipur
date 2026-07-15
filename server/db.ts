import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const supabaseUrl = process.env.SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
export const supabase = createClient(supabaseUrl, supabaseKey)

export interface Player {
  id: string
  friend_code: string
  display_name: string | null
  secret_key: string
  // Dual-run bridge (see ensurePlayerForVGames below). Not present until the
  // cutover migration adds the column — optional here so existing rows still
  // type-check.
  vgames_account_id?: string | null
}

export interface Match {
  player_id: string
  opponent_type: string
  opponent_id: string | null
  player_score: number
  opponent_score: number
  won: boolean
  timestamp?: number
}

export async function recordMatch(match: Match) {
  const payload: any = {
    player_id: match.player_id,
    opponent_type: match.opponent_type,
    opponent_id: match.opponent_id,
    player_score: match.player_score,
    opponent_score: match.opponent_score,
    won: match.won,
  }
  if (match.timestamp) {
    payload.timestamp = new Date(match.timestamp).toISOString()
  }
  const { error } = await supabase.from('matches').insert([payload])
  if (error) throw error
}

export async function getPlayerMatches(playerId: string) {
  try {
    const { data, error } = await supabase
      .from('matches')
      .select('*')
      .eq('player_id', playerId)
      .order('timestamp', { ascending: false })
    if (error) throw error
    return data
  } catch (err) {
    console.error('db: getPlayerMatches error:', err)
    throw err
  }
}

/**
 * Read-only lookup of the Supabase `players` row for a VGames-verified
 * accountId (the dual-run `vgames_account_id` bridge column back-written at
 * cutover). Unlike ensurePlayerForVGames this NEVER writes — used by
 * PULL_HISTORY to fetch a signed-in account's own match history on a fresh
 * device without mutating the row (a write would clobber the real
 * friend_code/secret_key). Returns null when the account has no Supabase row.
 */
export async function getPlayerByVGamesAccountId(accountId: string) {
  try {
    const { data, error } = await supabase
      .from('players')
      .select('*')
      .eq('vgames_account_id', accountId)
      .limit(1)
    if (error) throw error
    return data && data.length > 0 ? data[0] : null
  } catch (err) {
    console.error('db: getPlayerByVGamesAccountId error:', err)
    throw err
  }
}

// ── VGames dual-run bridge (Task C4) ────────────────────────────────────────
// vjaipur now authenticates against the shared VGames Identity worker (see
// server/vgamesAuth.ts) but keeps using this Supabase `players`/`matches`
// pair for match history + the leaderboard during the dual-run phase.
//
// Migration note — NOT applied here; apply at cutover (see
// vgames-platform/docs/RUNBOOK-P1-cutover.md), gated on Vijay's go. Both
// statements land in the SAME migration/deploy:
//   ALTER TABLE players ADD COLUMN vgames_account_id text;
//   CREATE UNIQUE INDEX IF NOT EXISTS idx_players_vgames_account_id
//     ON players (vgames_account_id) WHERE vgames_account_id IS NOT NULL;
// ensurePlayerForVGames below is upsert-safe: it does a single
// `.upsert(row, { onConflict: 'vgames_account_id' })` rather than
// select-then-insert, so it's correct (no TOCTOU double-insert window) as
// soon as the unique index above exists. Until that column+index exist in
// production, this path isn't reached at all — live traffic doesn't hit it
// until the migration + this deploy land together (and Postgres would error
// resolving ON CONFLICT without the index anyway, which the fail-closed
// catch below turns into a blocked write, not a bad one). Locally/in tests
// it's mocked, so this ships ahead of the migration without risk.
function syntheticFriendCode(accountId: string): string {
  // Cosmetic/legacy-shape only — vgames_account_id is the real key. Kept
  // deterministic (not random) so repeated provisioning of the same account
  // never needs a fresh code.
  let h = 0
  for (const c of accountId) h = (h * 31 + c.charCodeAt(0)) | 0
  const digits = (Math.abs(h) % 9000 + 1000).toString()
  return `VG-${digits}`
}

function syntheticSecretKey(): string {
  // Vestigial placeholder. VGames JWTs (not this column) are the source of
  // truth for auth now — this only exists in case `players.secret_key` is
  // still NOT NULL until the cutover migration relaxes it. Never returned to
  // a client, never compared against anything (no plaintext-secret round-trip).
  return `vgames-managed-${randomUUID()}`
}

/**
 * Idempotently provisions (or finds) the Supabase `players` row for a
 * VGames-verified `accountId`, mirroring `display_name`. Race-safe: a single
 * UPSERT keyed on `vgames_account_id` (not select-then-insert), so two
 * concurrent SYNC_MATCH calls for the same accountId can't double-insert —
 * correct even without an app-level lock, relying on the DB-level unique
 * index (see migration note above) to resolve the conflict atomically.
 * Fail-closed: on any error this returns null, and callers (SYNC_MATCH) must
 * treat that as "block the write" rather than orphan a match against a
 * missing player row.
 */
export async function ensurePlayerForVGames(accountId: string, displayName: string): Promise<Player | null> {
  try {
    const { data, error } = await supabase
      .from('players')
      .upsert(
        {
          vgames_account_id: accountId,
          display_name: displayName,
          friend_code: syntheticFriendCode(accountId),
          secret_key: syntheticSecretKey(),
        },
        { onConflict: 'vgames_account_id' },
      )
      .select()
      .single()
    if (error) throw error
    return data
  } catch (err) {
    console.error('db: ensurePlayerForVGames error:', err)
    return null
  }
}

export async function isUsernameAvailable(name: string, excludeFriendCode?: string) {
  if (!name || name.trim() === '') return false

  let query = supabase
    .from('players')
    .select('id, friend_code', { count: 'exact', head: true })
    .ilike('display_name', name.trim())
  
  if (excludeFriendCode) {
    query = query.neq('friend_code', excludeFriendCode)
  }

  const { count, error } = await query
  if (error) throw error
  return count === 0
}

export interface LeaderboardRow {
  display_name: string
  opponent_type: string
  games: number
  wins: number
  avg_delta: number
}

export async function getLeaderboard(): Promise<LeaderboardRow[]> {
  const { data: players, error: pe } = await supabase
    .from('players')
    .select('id, display_name')
    .not('display_name', 'is', null)
  if (pe) throw pe
  if (!players?.length) return []

  const ids = players.map(p => p.id)
  const { data: matches, error: me } = await supabase
    .from('matches')
    .select('player_id, opponent_type, won, player_score, opponent_score')
    .in('player_id', ids)
  if (me) throw me
  if (!matches?.length) return []

  const nameOf = new Map(players.map(p => [p.id, p.display_name as string]))
  const agg = new Map<string, { games: number; wins: number; totalDelta: number }>()

  for (const m of matches) {
    const name = nameOf.get(m.player_id)
    if (!name) continue
    const key = `${name}\x00${m.opponent_type}`
    const s = agg.get(key) ?? { games: 0, wins: 0, totalDelta: 0 }
    s.games++
    if (m.won) s.wins++
    s.totalDelta += (m.player_score - m.opponent_score)
    agg.set(key, s)
  }

  return Array.from(agg.entries()).map(([key, s]) => {
    const [display_name, opponent_type] = key.split('\x00')
    return { display_name, opponent_type, games: s.games, wins: s.wins, avg_delta: s.totalDelta / s.games }
  })
}

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

export async function createPlayer(friendCode: string, secretKey: string, displayName?: string) {
  try {
    const { data, error } = await supabase
      .from('players')
      .insert([{ friend_code: friendCode, secret_key: secretKey, display_name: displayName }])
      .select()
      .single()
    if (error) throw error
    return data
  } catch (err) {
    console.error('db: createPlayer error:', err)
    throw err
  }
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

export async function getPlayerByCode(friendCode: string) {
  try {
    const { data, error } = await supabase
      .from('players')
      .select('*')
      .eq('friend_code', friendCode)
      .limit(1)
    
    if (error) throw error
    return data && data.length > 0 ? data[0] : null
  } catch (err) {
    console.error('db: getPlayerByCode error:', err)
    throw err
  }
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

// ── VGames dual-run bridge (Task C4) ────────────────────────────────────────
// vjaipur now authenticates against the shared VGames Identity worker (see
// server/vgamesAuth.ts) but keeps using this Supabase `players`/`matches`
// pair for match history + the leaderboard during the dual-run phase.
//
// Migration note — NOT applied here; apply at cutover (see
// vgames-platform/docs/RUNBOOK-P1-cutover.md), gated on Vijay's go:
//   ALTER TABLE players ADD COLUMN vgames_account_id text;
//   CREATE UNIQUE INDEX IF NOT EXISTS idx_players_vgames_account_id
//     ON players (vgames_account_id) WHERE vgames_account_id IS NOT NULL;
// Until that column exists in production, the `.eq('vgames_account_id', ...)`
// lookup below will error there (undefined column) — acceptable pre-cutover,
// since live traffic doesn't reach this path until the migration + this
// deploy both land together. Locally/in tests it's mocked, so this ships
// ahead of the migration without risk.
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
 * VGames-verified `accountId`, mirroring `display_name`. Fail-closed: on any
 * lookup/write error this returns null, and callers (SYNC_MATCH) must treat
 * that as "block the write" rather than orphan a match against a missing
 * player row.
 */
export async function ensurePlayerForVGames(accountId: string, displayName: string): Promise<Player | null> {
  try {
    const { data: existing, error: selErr } = await supabase
      .from('players')
      .select('*')
      .eq('vgames_account_id', accountId)
      .single()

    if (selErr && selErr.code !== 'PGRST116') throw selErr

    if (existing) {
      if (displayName && existing.display_name !== displayName) {
        const { data: updated, error: updErr } = await supabase
          .from('players')
          .update({ display_name: displayName })
          .eq('id', existing.id)
          .select()
          .single()
        if (updErr) throw updErr
        return updated
      }
      return existing
    }

    const { data: created, error: insErr } = await supabase
      .from('players')
      .insert([{
        vgames_account_id: accountId,
        display_name: displayName,
        friend_code: syntheticFriendCode(accountId),
        secret_key: syntheticSecretKey(),
      }])
      .select()
      .single()
    if (insErr) throw insErr
    return created
  } catch (err) {
    console.error('db: ensurePlayerForVGames error:', err)
    return null
  }
}

export async function updatePlayerName(playerId: string, displayName: string) {
  const { error } = await supabase
    .from('players')
    .update({ display_name: displayName })
    .eq('id', playerId)
  if (error) throw error
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

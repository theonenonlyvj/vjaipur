import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
export const supabase = createClient(supabaseUrl, supabaseKey)

export interface Player {
  id: string
  friend_code: string
  display_name: string | null
  secret_key: string
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

export async function getPlayerByUsername(username: string) {
  try {
    const { data, error } = await supabase
      .from('players')
      .select('*')
      .ilike('display_name', username)
      .order('created_at', { ascending: false })
      .limit(1)
    
    if (error) throw error
    return data && data.length > 0 ? data[0] : null
  } catch (err) {
    console.error('db: getPlayerByUsername error:', err)
    throw err
  }
}

export async function updatePlayerToSecured(friendCode: string, username: string, password: string) {
  try {
    // Try to find existing player by friendCode
    const existing = await getPlayerByCode(friendCode)
    
    if (existing) {
      // Update existing
      const { data, error } = await supabase
        .from('players')
        .update({ display_name: username, secret_key: password })
        .eq('id', existing.id)
        .select()
        .single()
      if (error) throw error
      return data
    } else {
      // Create new
      return createPlayer(friendCode, password, username)
    }
  } catch (err) {
    console.error('db: updatePlayerToSecured error:', err)
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
    .not('display_name', 'like', 'Guest%')
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

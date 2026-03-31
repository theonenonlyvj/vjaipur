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
}

export async function createPlayer(friendCode: string, secretKey: string, displayName?: string) {
  const { data, error } = await supabase
    .from('players')
    .insert([{ friend_code: friendCode, secret_key: secretKey, display_name: displayName }])
    .select()
    .single()
  if (error) throw error
  return data
}

export async function recordMatch(match: Match) {
  const { error } = await supabase.from('matches').insert([match])
  if (error) throw error
}

export async function getPlayerByCode(friendCode: string) {
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .eq('friend_code', friendCode)
    .single()
  if (error && error.code !== 'PGRST116') throw error
  return data
}

export async function getPlayerMatches(playerId: string) {
  const { data, error } = await supabase
    .from('matches')
    .select('*')
    .eq('player_id', playerId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function updatePlayerName(playerId: string, displayName: string) {
  const { error } = await supabase
    .from('players')
    .update({ display_name: displayName })
    .eq('id', playerId)
  if (error) throw error
}

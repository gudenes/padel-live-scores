// apps/labs/src/lib/data/search-player.ts
// Fuzzy player name search. Uses ILIKE + ranking-based ordering. Returns
// canonical player ids the chat engine can pass to other skills.

import { supabaseService } from '@/lib/db'
import type { PlayerRow } from './types'

export async function searchPlayer(
  query: string,
  opts: { limit?: number } = {},
): Promise<PlayerRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 5, 1), 20)
  const q = query.trim()
  if (q.length < 2) return []

  const supabase = supabaseService()
  const { data, error } = await supabase
    .from('players')
    .select('id, name, country, category, ranking')
    .ilike('name', `%${q}%`)
    .order('ranking', { ascending: true, nullsFirst: false })
    .limit(limit)

  if (error) throw new Error(`searchPlayer failed: ${error.message}`)
  return (data ?? []) as PlayerRow[]
}

import type { SupabaseClient } from '@supabase/supabase-js'
import type { MarketRow } from './_shared'
import { EDITORIAL_FAMILIES } from '../../../../shared/play-editorial'
import type { EditorialView } from '../../../../shared/play-editorial-view'

export function editorialKind(key?: string): EditorialView['kind'] | null {
  return (Object.entries(EDITORIAL_FAMILIES).find(([,v]) => v.resolver === key)?.[0] as EditorialView['kind']) ?? null
}
/** One bounded player lookup for the entire page; missing data never becomes a rank of zero. */
export async function fetchEditorialViews(db: SupabaseClient, rows: MarketRow[]): Promise<Map<string, EditorialView>> {
  const selected = rows.filter(r => editorialKind(r.resolver_key))
  const ids = [...new Set(selected.flatMap(r => {
    const p = r.resolver_params ?? {}
    return [p.playerId, p.player1Id, p.player2Id].filter((id): id is string => typeof id === 'string')
  }))]
  const result = new Map<string, EditorialView>()
  if (!ids.length) return result
  const { data, error } = await db.from('players').select('id,name,display_name,avatar_url,photo_url,ranking').in('id', ids)
  if (error) { console.error('[play/editorial] player lookup failed:', error.message); return result }
  const eventIds = [...new Set(selected.flatMap(r => Array.isArray(r.resolver_params?.tournamentIds) ? r.resolver_params.tournamentIds.filter((id): id is string => typeof id === 'string') : []))]
  const finalsResult = eventIds.length ? await db.from('matches')
    .select('id,tournament_id,category,status,winner_pair,pair1_player1_id,pair1_player2_id,pair2_player1_id,pair2_player2_id')
    .in('tournament_id',eventIds).eq('round_canonical','F').limit(1000) : null
  const finals = finalsResult && !finalsResult.error && (finalsResult.data?.length ?? 0) < 1000 ? finalsResult.data : null
  const players = new Map((data ?? []).map(p => [p.id,p]))
  for (const row of selected) {
    const p = row.resolver_params ?? {}
    const subject = [p.playerId,p.player1Id,p.player2Id].flatMap(id => {
      const player = players.get(id)
      return player ? [{id:player.id, name:player.display_name || player.name,
        avatarUrl:player.avatar_url || null, photoUrl:player.photo_url || null,
        ranking:player.ranking && Number(player.ranking) > 0 ? Number(player.ranking) : null}] : []
    })
    const scopedFinals = finals?.filter(f => f.category === row.category && Array.isArray(p.tournamentIds) && p.tournamentIds.includes(f.tournament_id))
    // Ambiguous duplicate finals cannot supply trustworthy progress.
    const ambiguous = scopedFinals?.some(f => scopedFinals.filter(other => other.tournament_id === f.tournament_id).length > 1)
    const completed = scopedFinals && !ambiguous ? scopedFinals.filter(f => {
      if (!['finished','retired'].includes(f.status) || ![1,2].includes(f.winner_pair)) return false
      const winners = f.winner_pair === 1 ? [f.pair1_player1_id,f.pair1_player2_id] : [f.pair2_player1_id,f.pair2_player2_id]
      return winners.includes(p.player1Id) && winners.includes(p.player2Id)
    }).length : null
    const probability = Number(row.seed_prob)
    result.set(row.id, {kind:editorialKind(row.resolver_key)!,players:subject,
      completed: editorialKind(row.resolver_key) === 'titles' ? completed : null,
      target: typeof (p.rank ?? p.titles) === 'number' ? Number(p.rank ?? p.titles) : null,
      round: typeof p.round === 'string' ? p.round : null,
      endsAt: typeof p.endsAt === 'string' ? p.endsAt : null,
      scope: typeof row.tokens?.scope === 'string' ? row.tokens.scope : null,
      openingProbability: probability > 0 && probability < 1 ? probability : null,
      source: typeof row.tokens?.price_source === 'string' ? row.tokens.price_source : null})
  }
  return result
}

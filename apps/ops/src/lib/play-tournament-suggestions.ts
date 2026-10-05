import type { SupabaseClient } from '@supabase/supabase-js'
import type { EditorialConfig } from '../../../../shared/play-editorial'
import { previewEditorial, type EditorialPreview } from './play-editorial-service'

export interface SuggestionEvent { id: string; name: string; starts_at: string; ends_at: string; level: string }
export interface ProjectionPair {
  category: 'men' | 'women'; pair_player_ids: string[]; champion_prob: number | string | null;
  finalist_prob: number | string | null; semifinal_prob: number | string | null; status: string | null;
}
export interface TournamentSuggestion {
  id: string; config: EditorialConfig; reason: string; preview: EditorialPreview;
  existingMarketId: string | null;
}
export interface TournamentSuggestions {
  events: SuggestionEvent[]; tournamentId: string | null; suggestions: TournamentSuggestion[];
  generatedAt: string; publishingEnabled: boolean;
}
const DAY = 86400000
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const probability = (value: number | string | null) => value === null ? NaN : Number(value)

/** Small balanced shortlist, built only from real pairs in the tournament model. */
export function suggestTournamentConfigs(event: SuggestionEvent, projections: ProjectionPair[], locksAt = '') {
  if (!Number.isFinite(Date.parse(event.ends_at))) return []
  const endsAt = new Date(`${event.ends_at.slice(0, 10)}T23:59:59Z`).toISOString()
  const candidates: { id: string; config: EditorialConfig; reason: string }[] = []
  for (const category of ['men', 'women'] as const) {
    const pairs = projections.filter(p => p.category === category && p.status !== 'eliminated'
      && p.pair_player_ids?.length === 2 && new Set(p.pair_player_ids).size === 2
      && p.pair_player_ids.every(id => UUID.test(id)))
    const seen = new Set<string>()
    const unique = pairs.filter(p => {
      const key = [...p.pair_player_ids].sort().join(':')
      if (seen.has(key)) return false
      seen.add(key); return true
    })
    const used = new Set<string>()
    const add = (pair: ProjectionPair, family: 'champion' | 'round', round: 'SF' | 'F', reason: string) => {
      const playerIds = [...pair.pair_player_ids].sort(), key = playerIds.join(':')
      used.add(key)
      candidates.push({ id: `${event.id}:${category}:${family}:${family === 'round' ? round : ''}:${key}`, reason,
        config: { family, category, playerIds, tournamentIds: [event.id], round, target: 1, minimumStarts: 1,
          startsAt: '', endsAt, locksAt, voidAfter: new Date(Date.parse(endsAt) + 7 * DAY).toISOString(),
          probability: null, probabilitySource: '', maxLoss: 5000 } })
    }
    const contenders = unique.filter(p => probability(p.champion_prob) >= .02 && probability(p.champion_prob) <= .98)
      .sort((a,b) => probability(b.champion_prob) - probability(a.champion_prob) || a.pair_player_ids.join().localeCompare(b.pair_player_ids.join()))
    contenders.slice(0,2).forEach((p,i) => add(p,'champion','F',i === 0 ? 'Leading title contender in the current draw.' : 'A challenger to the title favourite.'))
    for (const round of ['F','SF'] as const) {
      const column = round === 'F' ? 'finalist_prob' : 'semifinal_prob'
      const pick = unique.filter(p => !used.has([...p.pair_player_ids].sort().join(':')) && probability(p[column]) >= .15 && probability(p[column]) <= .85)
        .sort((a,b) => Math.abs(probability(a[column]) - .5) - Math.abs(probability(b[column]) - .5) || a.pair_player_ids.join().localeCompare(b.pair_player_ids.join()))[0]
      if (pick) add(pick,'round',round,`A competitive ${round === 'F' ? 'final' : 'semifinal'} prediction beyond the title favourites.`)
    }
  }
  return candidates
}

type ExistingMarket = { id: string; category: string; resolver_key: string; resolver_params: Record<string, unknown> }
/** Include the legacy outright and opposite wording: they represent the same bet. */
export function matchingTournamentMarket(config: EditorialConfig, markets: ExistingMarket[]): string | null {
  return markets.find(m => {
    if (m.category !== config.category) return false
    const p = m.resolver_params
    if ([p.player1Id,p.player2Id].sort().join(':') !== config.playerIds.join(':')) return false
    return config.family === 'champion'
      ? ['tournament.pair_champion_v1','tournament.champion_is_pair','tournament.other_pair_wins_v1'].includes(m.resolver_key)
      : m.resolver_key === 'tournament.pair_reaches_round_v1' && p.round === config.round
  })?.id ?? null
}

export async function loadTournamentSuggestions(db: SupabaseClient, tournamentId: string | null, now = new Date(), locksAt = ''): Promise<TournamentSuggestions> {
  if (tournamentId && !UUID.test(tournamentId)) throw new Error('Invalid tournament ID.')
  const eventsResult = await db.from('tournaments').select('id,name,starts_at,ends_at,level')
    .in('level',['p1','p2','major']).gte('ends_at', now.toISOString().slice(0,10))
    .lte('starts_at', new Date(now.getTime() + 30 * DAY).toISOString()).order('starts_at').limit(100)
  if (eventsResult.error) throw new Error(eventsResult.error.message)
  const events = (eventsResult.data ?? []) as SuggestionEvent[]
  // Prefer the next tournament over the final day of the current one.
  const event = tournamentId ? events.find(t => t.id === tournamentId)
    : events.find(t => t.starts_at.slice(0,10) >= now.toISOString().slice(0,10)) ?? events[0]
  if (tournamentId && !event) throw new Error('Choose a current or upcoming Premier tournament.')
  const base = { events, tournamentId: event?.id ?? null, generatedAt: now.toISOString(), publishingEnabled: process.env.PLAY_EDITORIAL_PUBLISH_ENABLED === 'true' }
  if (!event) return { ...base, suggestions: [] }
  const [projections, markets] = await Promise.all([
    db.from('tournament_projections').select('category,pair_player_ids,champion_prob,finalist_prob,semifinal_prob,status')
      .eq('tournament_id',event.id).limit(256),
    db.from('markets').select('id,category,resolver_key,resolver_params').eq('tournament_id',event.id).limit(500),
  ])
  if (projections.error || markets.error) throw new Error(projections.error?.message ?? markets.error?.message)
  if ((projections.data?.length ?? 0) >= 256 || (markets.data?.length ?? 0) >= 500) throw new Error('Tournament data may be incomplete. Review coverage before suggesting markets.')
  const candidates = suggestTournamentConfigs(event, (projections.data ?? []) as ProjectionPair[], locksAt)
  const suggestions: TournamentSuggestion[] = []
  // Four pairs per draw at most; bound query concurrency to avoid flooding Supabase.
  for (let i = 0; i < candidates.length; i += 2) {
    suggestions.push(...await Promise.all(candidates.slice(i,i+2).map(async candidate => ({ ...candidate,
      preview: await previewEditorial(db,candidate.config,now),
      existingMarketId: matchingTournamentMarket(candidate.config,(markets.data ?? []) as ExistingMarket[]),
    }))))
  }
  return { ...base, suggestions }
}

import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { EDITORIAL_FAMILIES, validateEditorialConfig, editorialBindingErrors, editorialParams, editorialCopy } from '../../../../shared/play-editorial'
import type { ResolverContext } from '../../../../padelgod/src/lib/market-resolvers/types'
import { pairReachesRound, otherPairWinsTournament, pairTitleCount, playerReachesRanking } from '../../../../padelgod/src/lib/market-resolvers/selected-beta'

// Import the shared implementations directly: the worker registry uses Node's
// emitted .js paths, which the Next.js source bundler cannot resolve.
const editorialResolvers = { round: pairReachesRound, other_champion: otherPairWinsTournament, titles: pairTitleCount, ranking: playerReachesRanking }

export interface EditorialPreview {
  errors: string[]; fingerprint: string; templateKey: string; seasonId: string | null;
  category: string; tournamentId: string | null; editorialScope: string | null; boundMatchId: string | null;
  resolverKey: string; params: Record<string, unknown>; tokens: Record<string, unknown>;
  probability: number | null; seedSource: string; priceSource: string; maxLoss: number; locksAt: string;
  question: Record<string,string>; rules: Record<string,string>; evidence: Record<string,unknown>;
}
type Row = Record<string, unknown>
export async function previewEditorial(db: SupabaseClient, raw: unknown, now = new Date()): Promise<EditorialPreview> {
  const c = validateEditorialConfig(raw), meta = EDITORIAL_FAMILIES[c.family]
  const errors = editorialBindingErrors(c, now)
  const [playersResult, eventsResult, seasonResult, templateResult] = await Promise.all([
    db.from('players').select('id,name,category').in('id',c.playerIds),
    db.from('tournaments').select('id,name,level,starts_at,ends_at').in('id',c.tournamentIds),
    db.from('market_seasons').select('id,starts_at,ends_at').eq('status','active').maybeSingle(),
    db.from('market_templates').select('enabled').eq('key',`editorial.${c.family}.v1`).maybeSingle(),
  ])
  for (const result of [playersResult,eventsResult,seasonResult,templateResult]) if (result.error) throw new Error(result.error.message)
  const players = (playersResult.data ?? []) as Row[], events = ((eventsResult.data ?? []) as Row[]).sort((a,b)=>String(a.id).localeCompare(String(b.id)))
  if (players.length !== c.playerIds.length || players.some(p => p.category !== c.category)) errors.push('Player records must exist and match the selected draw.')
  if (events.length !== c.tournamentIds.length || events.some(t => !['p1','p2','major'].includes(String(t.level)))) errors.push('Choose verified Premier P1/P2/Major events.')
  const season = seasonResult.data
  if (!season || Date.parse(season.starts_at) > now.getTime() || Date.parse(c.voidAfter) >= Date.parse(season.ends_at)) errors.push('An active season must cover the full review window.')
  if (!templateResult.data?.enabled) errors.push('This template is disabled in Templates.')
  const name = (rows: Row[], id: string) => String(rows.find(r => r.id === id)?.name ?? id)
  const copy = editorialCopy(c,c.playerIds.map(id => name(players,id)),c.tournamentIds.map(id => name(events,id)))
  const params = editorialParams(c)
  let locksAt = c.locksAt, boundMatchId: string | null = null, probability = c.probability
  let priceSource = c.probabilitySource
  const tournamentScoped = c.family === 'round' || c.family === 'other_champion'
  const evidence: Record<string, unknown> = {}
  if (tournamentScoped && c.tournamentIds.length === 1 && c.playerIds.length === 2) {
    const result = await db.from('matches').select('id,status,winner_pair,scheduled_at,round_canonical,pair1_player1_id,pair1_player2_id,pair2_player1_id,pair2_player2_id')
      .eq('tournament_id',c.tournamentIds[0]).eq('category',c.category).in('round_canonical',['R128','R64','R32','R16','QF','SF','F']).limit(256)
    if (result.error) throw new Error(result.error.message)
    const matches = (result.data ?? []) as Row[]
    if (matches.length >= 256) errors.push('Draw response may be incomplete.')
    const pairMatches = matches.filter(m => [1,2].some(n => [m[`pair${n}_player1_id`],m[`pair${n}_player2_id`]].sort().join(':') === c.playerIds.join(':')))
    if (pairMatches.some(m => ['live','on_court'].includes(String(m.status)))) errors.push('The selected pair is currently playing; wait for a fresh preview after the result.')
    if (pairMatches.some(m => ['finished','retired'].includes(String(m.status)) && [1,2].includes(Number(m.winner_pair)) && ![m[`pair${m.winner_pair}_player1_id`],m[`pair${m.winner_pair}_player2_id`]].every(id=>c.playerIds.includes(String(id))))) errors.push('This pair has already been eliminated; do not open a new market.')
    const upcoming = pairMatches.filter(m => m.status === 'scheduled').sort((a,b) => String(a.scheduled_at ?? '').localeCompare(String(b.scheduled_at ?? '')))
    const next = upcoming[0]
    if (!next?.scheduled_at || Date.parse(String(next.scheduled_at)) <= now.getTime()) errors.push('The pair needs a future confirmed next-match start.')
    else { boundMatchId = String(next.id); locksAt = String(next.scheduled_at); evidence.nextMatch = { id: next.id, startsAt: next.scheduled_at } }
    const projections = await db.from('tournament_projections').select('pair_player_ids,champion_prob,finalist_prob,semifinal_prob,computed_at,model_version,status')
      .eq('tournament_id',c.tournamentIds[0]).eq('category',c.category).contains('pair_player_ids',c.playerIds).limit(2)
    if (projections.error) throw new Error(projections.error.message)
    const projection = projections.data?.length === 1 ? projections.data[0] : null
    probability = null
    if (!projection || !Number.isFinite(Date.parse(projection.computed_at)) || Date.parse(projection.computed_at) > now.getTime() || now.getTime()-Date.parse(projection.computed_at)>6*3600000) errors.push('A unique tournament projection less than six hours old is required.')
    else {
      const rawProb = c.family === 'other_champion' ? projection.champion_prob : c.round === 'SF' ? projection.semifinal_prob : projection.finalist_prob
      const p = rawProb === null ? NaN : Number(rawProb)
      probability = c.family === 'other_champion' ? 1-p : p
      priceSource = `${projection.model_version}, computed ${projection.computed_at}${c.family === 'other_champion' ? '; 1 minus champion probability' : ''}`
      evidence.projection = { at: projection.computed_at, model: projection.model_version }
    }
    if (Date.parse(c.endsAt) < Date.parse(String(events[0]?.ends_at)) || Date.parse(c.voidAfter) <= Date.parse(locksAt)) errors.push('The result/review window must cover the tournament and closing time.')
  }
  if (c.family === 'titles') {
    if (events.some(e => !e.starts_at || !e.ends_at || Date.parse(String(e.starts_at)) < Date.parse(c.startsAt) || Date.parse(String(e.ends_at)) > Date.parse(c.endsAt))) errors.push('All selected events must fall inside the result window.')
    const chronological = [...events].sort((a,b)=>String(a.starts_at).localeCompare(String(b.starts_at)))
    if (chronological.some((e,i)=>i>0 && Date.parse(String(e.starts_at))<=Date.parse(String(chronological[i-1].ends_at)))) errors.push('Selected events overlap; check for duplicate calendar records.')
  }
  if (probability === null || !Number.isFinite(probability) || probability < .02 || probability > .98) errors.push('Opening probability must be between 2% and 98%.')
  if (!locksAt || !Number.isFinite(Date.parse(locksAt)) || Date.parse(locksAt)<=now.getTime()) errors.push('Closing time must be in the future.')
  if (errors.length === 0) {
    const outcome = await editorialResolvers[c.family]({ supabase: db as unknown as ResolverContext['supabase'], marketId:'preview', matchId:null,
      tournamentId: tournamentScoped ? c.tournamentIds[0] : null, category:c.category, tokens:{}, now }, params)
    if (outcome.state !== 'undecided') errors.push('This outcome is already determined or unresolvable; do not publish.')
  }
  const preview: EditorialPreview = {
    errors, fingerprint:'', templateKey:`editorial.${c.family}.v1`,seasonId:season?.id ?? null,
    category:c.category,tournamentId:tournamentScoped ? c.tournamentIds[0] ?? null : null,
    editorialScope:tournamentScoped ? null : `${c.family}:${c.startsAt}:${c.endsAt}`,
    boundMatchId, resolverKey:meta.resolver,params,
    tokens:{ question:copy.question.en, subject:c.playerIds.map(id=>name(players,id)).join(' / '), scope:events.map(e=>e.name).join(', '), price_source:priceSource },
    probability,seedSource:tournamentScoped ? 'projection':'fixed',priceSource,maxLoss:c.maxLoss,locksAt,
    ...copy,evidence,
  }
  // Stable data only: preview generation time and capacity are not part of the reviewed contract.
  preview.fingerprint = createHash('sha256').update(JSON.stringify(preview)).digest('hex')
  return preview
}

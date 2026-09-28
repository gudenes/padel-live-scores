// Fetches everything a Pro Padel League franchise page needs.
//
// Kept apart from ppl-team.ts so the shaping stays importable by tests
// without dragging a Supabase client in. Everything here is I/O; every
// decision is over there.

import type { SupabaseClient } from '@supabase/supabase-js'
import { viewTies, totalsFrom, type TieInput, type TieView, type SeasonTotals } from './ppl-team'
import { levelToLeague, type PplLevel } from './ppl-hub'

export interface PplTeamPlayer {
  playerId: string
  name: string
  displayName: string | null
  avatarUrl: string | null
  country: string | null
  gamesPlayed: number | null
  wins: number | null
  losses: number | null
}

export interface PplTeamStanding {
  /** Which table this standing is from: 'all', or a gender for PPL II. */
  scope: string
  rank: number | null
  points: number | null
  matchesPlayed: number | null
  wins: number | null
  losses: number | null
  pctMatches: number | null
  pctSets: number | null
}

export interface PplTeamPageData {
  team: {
    id: string
    slug: string
    name: string
    city: string | null
    crestUrl: string | null
    brandColor: string | null
  }
  level: PplLevel
  seasonId: string
  /** Divisions this franchise actually has a season row for. */
  availableLevels: PplLevel[]
  standing: PplTeamStanding | null
  roster: PplTeamPlayer[]
  ties: TieView[]
  totals: SeasonTotals
  /** Season id -> franchise name, for naming opponents. */
  opponentNames: Map<string, string>
  eventNames: Map<string, { name: string; externalId: string | null }>
}

const SEASON_KEY = 'season-2026'

/**
 * Returns null when the franchise does not exist, or has no season row in the
 * requested division.
 *
 * The division MUST be part of the lookup. A franchise has one team_seasons
 * row per division, and the SNP equivalent of this function filters by source
 * alone and takes `.limit(1)` — which for a PPL club would silently return
 * whichever division happened to sort first. That is the kind of wrong that
 * renders a complete, plausible page about the wrong competition.
 */
export async function fetchPplTeamPage(
  client: SupabaseClient,
  slug: string,
  level: PplLevel,
): Promise<PplTeamPageData | null> {
  const { data: team } = await client
    .from('teams')
    .select('id,name,city,crest_url,brand_color,external_id')
    .eq('source', 'ppl')
    .eq('external_id', slug)
    .maybeSingle()
  if (!team) return null

  const { data: seasons } = await client
    .from('team_seasons')
    .select('id,team_id,league')
    .eq('team_id', team.id)
    .not('league', 'is', null)

  const available = (seasons ?? [])
    .map((s) => (s.league === 'ppl-ii' ? 'ppl_ii' : 'ppl') as PplLevel)
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort()

  const season = (seasons ?? []).find((s) => s.league === levelToLeague(level))
  if (!season) return null

  // All league season ids, so an opponent can be named without a second
  // round-trip per tie.
  const { data: allSeasons } = await client
    .from('team_seasons')
    .select('id,team_id,league')
    .eq('league', levelToLeague(level))
  const { data: allTeams } = await client
    .from('teams')
    .select('id,name,external_id')
    .eq('source', 'ppl')
  const teamNameById = new Map((allTeams ?? []).map((t) => [t.id as string, t.name as string]))
  const opponentNames = new Map<string, string>()
  for (const s of allSeasons ?? []) {
    const n = teamNameById.get(s.team_id as string)
    if (n) opponentNames.set(s.id as string, n)
  }

  const seasonIdsInDivision = new Set((allSeasons ?? []).map((s) => s.id as string))

  const [tiesRes, standingRes, rosterRes] = await Promise.all([
    client.from('league_ties')
      .select('id,tournament_id,stage,scheduled_at,home_team_season_id,away_team_season_id')
      .or(`home_team_season_id.eq.${season.id},away_team_season_id.eq.${season.id}`),
    // No scope filter: PPL II publishes no overall table, because each club
    // fields ONE drafted pairing, so its standing lives under that pairing's
    // gender. Filtering on scope='all' returns nothing for half the league.
    client.from('league_standings')
      .select('scope,rank,points,matches_played,wins,losses,pct_matches_won,pct_sets_won')
      .eq('team_season_id', season.id).eq('event_key', SEASON_KEY),
    client.from('team_memberships')
      .select('player_id,games_played,wins,losses,player:players(id,name,display_name,avatar_url,country)')
      .eq('team_season_id', season.id),
  ])

  const tieRows = tiesRes.data ?? []
  const tieIds = tieRows.map((t) => t.id as string)

  const { data: matchRows } = tieIds.length
    ? await client.from('matches')
        .select('id,tie_id,category,winner_pair,scheduled_at,pair1_player1_id,pair1_player2_id,pair2_player1_id,pair2_player2_id')
        .in('tie_id', tieIds)
    : { data: [] as never[] }

  const matchIds = (matchRows ?? []).map((m) => m.id as string)
  const { data: setRows } = matchIds.length
    ? await client.from('sets')
        .select('match_id,set_number,pair1_games,pair2_games')
        .in('match_id', matchIds)
        .order('set_number', { ascending: true })
    : { data: [] as never[] }

  const setsByMatch = new Map<string, Array<{ home: number; away: number }>>()
  for (const s of setRows ?? []) {
    const k = s.match_id as string
    if (!setsByMatch.has(k)) setsByMatch.set(k, [])
    setsByMatch.get(k)!.push({ home: Number(s.pair1_games ?? 0), away: Number(s.pair2_games ?? 0) })
  }

  // league_ties.scheduled_at is NULL on every row — the importer dates the
  // matches, never the tie. Derived here from the earliest court, otherwise
  // every fixture sorts as undated and the page shows no dates at all.
  const tieDate = new Map<string, string>()
  for (const m of matchRows ?? []) {
    const at = m.scheduled_at as string | null
    if (!at) continue
    const k = m.tie_id as string
    const cur = tieDate.get(k)
    if (!cur || at < cur) tieDate.set(k, at)
  }

  const matchesByTie = new Map<string, TieInput['matches']>()
  for (const m of matchRows ?? []) {
    const k = m.tie_id as string
    if (!matchesByTie.has(k)) matchesByTie.set(k, [])
    matchesByTie.get(k)!.push({
      matchId: m.id as string,
      category: (m.category === 'men' || m.category === 'women' ? m.category : null),
      winnerPair: (m.winner_pair === 1 || m.winner_pair === 2 ? m.winner_pair : null) as 1 | 2 | null,
      homePlayerIds: [m.pair1_player1_id, m.pair1_player2_id].filter(Boolean) as string[],
      awayPlayerIds: [m.pair2_player1_id, m.pair2_player2_id].filter(Boolean) as string[],
      sets: setsByMatch.get(m.id as string) ?? [],
    })
  }

  // A tie whose other side belongs to the OTHER division would mean the data
  // crossed competitions; drop it rather than render a cross-division result.
  const inputs: TieInput[] = tieRows
    .filter((t) => seasonIdsInDivision.has(t.home_team_season_id as string)
      && seasonIdsInDivision.has(t.away_team_season_id as string))
    .map((t) => ({
      tieId: t.id as string,
      tournamentId: t.tournament_id as string,
      stage: (t.stage as string) ?? '',
      scheduledAt: (t.scheduled_at as string) ?? tieDate.get(t.id as string) ?? null,
      homeSeasonId: t.home_team_season_id as string,
      awaySeasonId: t.away_team_season_id as string,
      matches: matchesByTie.get(t.id as string) ?? [],
    }))

  const ties = viewTies(inputs, season.id as string)

  const { data: events } = await client
    .from('tournaments').select('id,name,external_id').eq('source', 'ppl')
  const eventNames = new Map(
    (events ?? []).map((e) => [e.id as string, {
      name: e.name as string,
      externalId: (e.external_id as string) ?? null,
    }]),
  )

  const roster: PplTeamPlayer[] = (rosterRes.data ?? []).map((r) => {
    const p = (r as unknown as { player: Record<string, unknown> | null }).player
    return {
      playerId: r.player_id as string,
      name: (p?.name as string) ?? '—',
      displayName: (p?.display_name as string) ?? null,
      avatarUrl: (p?.avatar_url as string) ?? null,
      country: (p?.country as string) ?? null,
      gamesPlayed: r.games_played as number | null,
      wins: r.wins as number | null,
      losses: r.losses as number | null,
    }
  }).sort((a, b) => (b.gamesPlayed ?? 0) - (a.gamesPlayed ?? 0) || a.name.localeCompare(b.name))

  // Prefer the overall table where it exists; otherwise take the single
  // gendered row, which for PPL II is the only standing there is.
  const standingRows = standingRes.data ?? []
  const st = standingRows.find((r) => r.scope === 'all') ?? standingRows[0] ?? null
  return {
    team: {
      id: team.id as string,
      slug: team.external_id as string,
      name: team.name as string,
      city: (team.city as string) ?? null,
      crestUrl: (team.crest_url as string) ?? null,
      brandColor: (team.brand_color as string) ?? null,
    },
    level,
    seasonId: season.id as string,
    availableLevels: available,
    standing: st
      ? {
          scope: (st.scope as string) ?? 'all',
          rank: st.rank as number | null,
          points: st.points as number | null,
          matchesPlayed: st.matches_played as number | null,
          wins: st.wins as number | null,
          losses: st.losses as number | null,
          pctMatches: st.pct_matches_won as number | null,
          pctSets: st.pct_sets_won as number | null,
        }
      : null,
    roster,
    ties,
    totals: totalsFrom(ties),
    opponentNames,
    eventNames,
  }
}

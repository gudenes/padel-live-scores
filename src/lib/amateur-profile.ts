// Assembles everything the amateur profile page renders, from the team model
// introduced by the 2026-09-09 spec.
//
// Split in two on purpose: fetchAmateurProfile does the I/O, buildAmateurProfile
// is pure and holds every shaping decision, so the interesting logic is testable
// without a database.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  computeRecord,
  computeUsualCourt,
  collectPartners,
  type AmateurGame,
  type AmateurRecord,
  type UsualCourt,
  type AmateurPartners,
} from '@/lib/amateur-derive'

export interface AmateurRawRows {
  membership: {
    team_season_id: string
    player_id: string
    competition_points: number | null
    competition_rank: number | null
    roster_rank: number | null
    games_played: number | null
    wins: number | null
    losses: number | null
  }
  season: {
    id: string
    team_id: string
    label: string
    ranking: number | null
    ties_played: number | null
    ties_won: number | null
    courts_won: number | null
    courts_lost: number | null
    points_for: number | null
    points_against: number | null
    notes: string | null
  }
  team: {
    id: string
    slug: string
    name: string
    club: string | null
    city: string | null
    country: string | null
    crest_url: string | null
    cover_image_url: string | null
    competition: string | null
    category: string | null
    badge_label: string | null
    short_name: string | null
  }
  roster: Array<{
    player_id: string
    roster_rank: number | null
    games_played: number | null
    wins: number | null
    losses: number | null
    player: { id: string; name: string; avatar_url: string | null } | null
  }>
  fixtures: Array<{
    id: string
    code: string
    label: string
    sort_order: number
    complete: boolean
    result: string | null
    points_for: number | null
    points_against: number | null
    courts_won: number | null
    courts_lost: number | null
    opponent_name: string | null
    played_on: string | null
  }>
  slots: Array<{
    id: string
    fixture_id: string
    label: string
    worth: number
    slot_group: number
    result: string | null
    sets: number | null
    court_count: number
    exact: boolean
    partial: boolean
    sort_order: number
    player_ids: string[]
  }>
}

export interface AmateurSlot {
  id: string
  label: string
  worth: number
  result: 'W' | 'L' | null
  sets: number | null
  exact: boolean
  partial: boolean
  courtCount: number
  playerIds: string[]
}

export interface AmateurFixture {
  id: string
  code: string
  label: string
  complete: boolean
  result: 'W' | 'L' | null
  pointsFor: number | null
  pointsAgainst: number | null
  courtsWon: number | null
  courtsLost: number | null
  opponentName: string | null
  slots: AmateurSlot[]
}

export interface AmateurRosterEntry {
  playerId: string
  name: string
  avatarUrl: string | null
  rosterRank: number | null
  gamesPlayed: number
  wins: number
  losses: number
}

export interface AmateurProfileData {
  team: AmateurRawRows['team']
  season: AmateurRawRows['season']
  competitionPoints: number | null
  competitionRank: number | null
  rosterRank: number | null
  games: AmateurGame[]
  fixtures: AmateurFixture[]
  roster: AmateurRosterEntry[]
  record: AmateurRecord
  usualCourt: UsualCourt | null
  partners: AmateurPartners
}

function asResult(value: string | null): 'W' | 'L' | null {
  return value === 'W' || value === 'L' ? value : null
}

/** Fixtures with their slots, ordered. Shared by the profile and the team page. */
export function buildFixtures(raw: AmateurRawRows): AmateurFixture[] {
  const ordered = [...raw.fixtures].sort((a, b) => a.sort_order - b.sort_order)
  return ordered.map(f => ({
    id: f.id,
    code: f.code,
    label: f.label,
    complete: f.complete,
    result: asResult(f.result),
    pointsFor: f.points_for,
    pointsAgainst: f.points_against,
    courtsWon: f.courts_won,
    courtsLost: f.courts_lost,
    opponentName: f.opponent_name,
    slots: raw.slots
      .filter(s => s.fixture_id === f.id)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(s => ({
        id: s.id,
        label: s.label,
        worth: s.worth,
        result: asResult(s.result),
        sets: s.sets,
        // A slot covering more than one court can never pin the pairing down,
        // whatever the import wrote into `exact`.
        exact: s.exact && s.court_count === 1,
        partial: s.partial,
        courtCount: s.court_count,
        playerIds: s.player_ids,
      })),
  }))
}

/** Squad, ordered by roster rank, players who never played included. */
export function buildRoster(raw: AmateurRawRows): AmateurRosterEntry[] {
  return raw.roster
    .filter(r => r.player != null)
    .map(r => ({
      playerId: r.player_id,
      name: r.player!.name,
      avatarUrl: r.player!.avatar_url,
      rosterRank: r.roster_rank,
      gamesPlayed: r.games_played ?? 0,
      wins: r.wins ?? 0,
      losses: r.losses ?? 0,
    }))
    .sort((a, b) => (a.rosterRank ?? 999) - (b.rosterRank ?? 999))
}

export function buildAmateurProfile(playerId: string, raw: AmateurRawRows): AmateurProfileData {
  const fixtureByOrder = new Map(raw.fixtures.map(f => [f.id, f]))
  const fixtures: AmateurFixture[] = buildFixtures(raw)

  const games: AmateurGame[] = raw.slots
    .filter(s => s.player_ids.includes(playerId))
    .sort((a, b) => {
      const fa = fixtureByOrder.get(a.fixture_id)?.sort_order ?? 0
      const fb = fixtureByOrder.get(b.fixture_id)?.sort_order ?? 0
      return fa - fb || a.sort_order - b.sort_order
    })
    .map(s => ({
      fixtureCode: fixtureByOrder.get(s.fixture_id)?.code ?? '',
      worth: s.worth,
      result: asResult(s.result),
      sets: s.sets,
      exact: s.exact && s.court_count === 1,
      complete: fixtureByOrder.get(s.fixture_id)?.complete ?? true,
      partnerIds: s.player_ids.filter(id => id !== playerId),
    }))

  const roster: AmateurRosterEntry[] = buildRoster(raw)

  return {
    team: raw.team,
    season: raw.season,
    competitionPoints: raw.membership.competition_points,
    competitionRank: raw.membership.competition_rank,
    rosterRank: raw.membership.roster_rank,
    games,
    fixtures,
    roster,
    record: computeRecord(games),
    usualCourt: computeUsualCourt(games),
    partners: collectPartners(games),
  }
}

export interface AmateurSeasonRef {
  seasonId: string
  label: string
  /** team_seasons.starts_on — null on the hand-imported 25/26. */
  startsOn: string | null
  teamId: string
  teamName: string
}

/**
 * Most recent first. Sorts by start date, then by label — the 25/26 import
 * left starts_on null, so label ordering is the real tiebreak in practice.
 * A dated season always outranks an undated one.
 */
export function sortSeasonRefs(refs: AmateurSeasonRef[]): AmateurSeasonRef[] {
  return [...refs].sort((a, b) => {
    if (a.startsOn && b.startsOn) return b.startsOn.localeCompare(a.startsOn)
    if (a.startsOn) return -1
    if (b.startsOn) return 1
    return b.label.localeCompare(a.label)
  })
}

/** Every season this player has a membership in, most recent first. */
export async function fetchAmateurSeasons(
  client: SupabaseClient,
  playerId: string,
): Promise<AmateurSeasonRef[]> {
  const { data } = await client
    .from('team_memberships')
    .select('team_season_id, season:team_seasons(id, label, starts_on, team:teams(id, name))')
    .eq('player_id', playerId)

  type Row = {
    team_season_id: string
    season: {
      id: string
      label: string
      starts_on: string | null
      team: { id: string; name: string } | null
    } | null
  }

  const refs = ((data ?? []) as unknown as Row[])
    .filter(r => r.season != null)
    .map(r => ({
      seasonId: r.season!.id,
      label: r.season!.label,
      startsOn: r.season!.starts_on,
      teamId: r.season!.team?.id ?? '',
      teamName: r.season!.team?.name ?? '',
    }))

  return sortSeasonRefs(refs)
}

/**
 * Loads the player's most recent team season, or a specific one when
 * `seasonId` is given. Returns null when the player has no membership — an
 * amateur row with no season still renders a profile, just without the team
 * sections.
 */
export async function fetchAmateurProfile(
  client: SupabaseClient,
  playerId: string,
  seasonId?: string,
): Promise<AmateurProfileData | null> {
  let membershipQuery = client
    .from('team_memberships')
    .select('team_season_id, player_id, competition_points, competition_rank, roster_rank, games_played, wins, losses')
    .eq('player_id', playerId)

  if (seasonId) membershipQuery = membershipQuery.eq('team_season_id', seasonId)

  const { data: membership } = await membershipQuery
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!membership) return null

  const { data: season } = await client
    .from('team_seasons')
    .select('id, team_id, label, ranking, ties_played, ties_won, courts_won, courts_lost, points_for, points_against, notes')
    .eq('id', membership.team_season_id)
    .single()
  if (!season) return null

  const { data: team } = await client
    .from('teams')
    .select('id, slug, name, club, city, country, crest_url, cover_image_url, competition, category, badge_label, short_name')
    .eq('id', season.team_id)
    .single()
  if (!team) return null

  const { data: roster } = await client
    .from('team_memberships')
    .select('player_id, roster_rank, games_played, wins, losses, player:players(id, name, avatar_url)')
    .eq('team_season_id', season.id)

  const { data: fixtures } = await client
    .from('team_fixtures')
    .select('id, code, label, sort_order, complete, result, points_for, points_against, courts_won, courts_lost, opponent_name, played_on')
    .eq('team_season_id', season.id)
    .order('sort_order')

  const fixtureIds = (fixtures ?? []).map(f => f.id)
  const { data: slots } = fixtureIds.length
    ? await client
        .from('team_fixture_slots')
        .select('id, fixture_id, label, worth, slot_group, result, sets, court_count, exact, partial, sort_order, players:team_fixture_slot_players(player_id)')
        .in('fixture_id', fixtureIds)
    : { data: [] as Array<Record<string, unknown>> }

  const normalizedSlots = (slots ?? []).map(s => {
    const row = s as unknown as AmateurRawRows['slots'][number] & {
      players: Array<{ player_id: string }> | null
    }
    return { ...row, player_ids: (row.players ?? []).map(p => p.player_id) }
  })

  return buildAmateurProfile(playerId, {
    membership,
    season,
    team,
    // Supabase's join-type inference reports `player` as an array even
    // though this is a to-one FK; the actual runtime shape is a single
    // object (or null), matching AmateurRawRows['roster'].
    roster: (roster ?? []) as unknown as AmateurRawRows['roster'],
    fixtures: (fixtures ?? []) as AmateurRawRows['fixtures'],
    slots: normalizedSlots as AmateurRawRows['slots'],
  })
}

export interface TeamSeasonPageData {
  team: AmateurRawRows['team']
  season: AmateurRawRows['season']
  roster: AmateurRosterEntry[]
  fixtures: AmateurFixture[]
}

/** Team-season view: everything about the squad, nothing about one player. */
export function buildTeamSeason(raw: AmateurRawRows): TeamSeasonPageData {
  return {
    team: raw.team,
    season: raw.season,
    roster: buildRoster(raw),
    fixtures: buildFixtures(raw),
  }
}

/**
 * Loads a team season by slug WITHIN a league. Resolving by slug alone would
 * let /snp/<x> serve a team from another league — the URL promises the league,
 * so the query has to honour it.
 */
export async function fetchTeamSeason(
  client: SupabaseClient,
  slug: string,
  source: string,
  seasonLabel?: string,
): Promise<TeamSeasonPageData | null> {
  const { data: team } = await client
    .from('teams')
    .select('id, slug, name, club, city, country, crest_url, cover_image_url, competition, category, badge_label, short_name')
    .eq('slug', slug)
    .eq('source', source)
    .maybeSingle()
  if (!team) return null

  let seasonQuery = client
    .from('team_seasons')
    .select('id, team_id, label, starts_on, ranking, ties_played, ties_won, courts_won, courts_lost, points_for, points_against, notes')
    .eq('team_id', team.id)
  if (seasonLabel) seasonQuery = seasonQuery.eq('label', seasonLabel)

  const { data: seasons } = await seasonQuery
    .order('starts_on', { ascending: false, nullsFirst: false })
    .order('label', { ascending: false })
    .limit(1)
  const season = seasons?.[0]
  if (!season) return null

  const { data: roster } = await client
    .from('team_memberships')
    .select('player_id, roster_rank, games_played, wins, losses, player:players(id, name, avatar_url)')
    .eq('team_season_id', season.id)

  const { data: fixtures } = await client
    .from('team_fixtures')
    .select('id, code, label, sort_order, complete, result, points_for, points_against, courts_won, courts_lost, opponent_name, played_on')
    .eq('team_season_id', season.id)
    .order('sort_order')

  const fixtureIds = (fixtures ?? []).map(f => f.id)
  const { data: slots } = fixtureIds.length
    ? await client
        .from('team_fixture_slots')
        .select('id, fixture_id, label, worth, slot_group, result, sets, court_count, exact, partial, sort_order, players:team_fixture_slot_players(player_id)')
        .in('fixture_id', fixtureIds)
    : { data: [] as Array<Record<string, unknown>> }

  const normalizedSlots = (slots ?? []).map(s => {
    const row = s as unknown as AmateurRawRows['slots'][number] & {
      players: Array<{ player_id: string }> | null
    }
    return { ...row, player_ids: (row.players ?? []).map(p => p.player_id) }
  })

  return buildTeamSeason({
    // membership is player-scoped and unused by the team view; a zeroed stub
    // keeps the shared AmateurRawRows shape without pretending a player exists.
    membership: {
      team_season_id: season.id, player_id: '',
      competition_points: null, competition_rank: null, roster_rank: null,
      games_played: null, wins: null, losses: null,
    },
    season,
    team,
    roster: (roster ?? []) as unknown as AmateurRawRows['roster'],
    fixtures: (fixtures ?? []) as AmateurRawRows['fixtures'],
    slots: normalizedSlots as AmateurRawRows['slots'],
  })
}

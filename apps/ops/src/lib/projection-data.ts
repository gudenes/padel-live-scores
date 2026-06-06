// apps/ops/src/lib/projection-data.ts
// Data layer for the /odds/projections QA page. Reads tournament_projections
// (all tiers) via the service-role client, mirroring odds-data.ts conventions.

import { createServiceClient } from './supabase'

export interface ProjectionRoundOpponent {
  pair_key: string
  player_ids: string[]
  names: string[]
  reach_prob: number
  win_prob: number
}

export interface ProjectionRound {
  round: string
  reach_prob: number
  expected_opponent_pair_key: string | null
  opponents: ProjectionRoundOpponent[]
}

export interface ProjectionRow {
  tournament_id: string
  category: 'men' | 'women'
  pair_key: string
  pair_player_ids: string[]
  tournament_level: string | null
  status: 'active' | 'eliminated' | 'champion'
  eliminated_round: string | null
  champion_prob: number
  finalist_prob: number
  semifinal_prob: number
  rounds: ProjectionRound[]
  computed_at: string
}

export interface ProjectionTournamentSummary {
  tournament_id: string
  name: string
  level: string | null
  category: string
  pairs: number
}

export async function getProjectionTournaments(): Promise<ProjectionTournamentSummary[]> {
  const supabase = createServiceClient()
  const { data: projRows } = await supabase
    .from('tournament_projections')
    .select('tournament_id, category, tournament_level')

  const counts = new Map<string, ProjectionTournamentSummary>()
  for (const r of (projRows ?? []) as Array<{ tournament_id: string; category: string; tournament_level: string | null }>) {
    const key = `${r.tournament_id}:${r.category}`
    const c = counts.get(key) ?? {
      tournament_id: r.tournament_id,
      name: r.tournament_id,
      level: r.tournament_level,
      category: r.category,
      pairs: 0,
    }
    c.pairs++
    counts.set(key, c)
  }

  const ids = [...new Set([...counts.values()].map((c) => c.tournament_id))]
  if (ids.length > 0) {
    const { data: ts } = await supabase.from('tournaments').select('id, name').in('id', ids)
    const names = new Map((ts ?? []).map((t) => [t.id as string, t.name as string]))
    for (const c of counts.values()) c.name = names.get(c.tournament_id) ?? c.tournament_id
  }

  return [...counts.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export async function getProjectionRows(
  tournamentId: string,
  category: string,
): Promise<ProjectionRow[]> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('tournament_projections')
    .select('*')
    .eq('tournament_id', tournamentId)
    .eq('category', category)
    .order('champion_prob', { ascending: false })
  return (data ?? []) as ProjectionRow[]
}

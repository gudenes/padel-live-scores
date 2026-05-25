// apps/ops/src/lib/entry-list-aggregator.ts
//
// Reads the latest entry-list snapshot for a tournament (per gender), pairs
// the rows back into teams, joins to public.players for resolution metadata,
// and synthesizes "ghost" EntryPlayers for partners the padelgod fetcher
// could not resolve. The synthesized ghost carries the raw `partner_name`
// the snapshot row preserved + a flag the UI uses to render the RESOLVE chip.
//
// Mirrors the read logic of /api/ops/padelgod-entry-list/route.ts in the
// main app, ported to apps/ops's pg-pool pattern.

import { pgPool } from './db'
import { normalizeName } from './normalize-name'

// ── Types ────────────────────────────────────────────────────────────────

export type ResolutionMethod = 'fip_id' | 'name_exact' | 'none'
export type DrawType = 'main_draw' | 'qualifying'

export interface EntryPlayer {
  fipId: string | null
  name: string
  country: string | null
  seed: number | null
  drawType: DrawType
  partnerFipId: string | null
  partnerName: string | null
  resolvedPlayerId: string | null
  resolvedPlayerName: string | null
  resolutionMethod: ResolutionMethod
  isGhostPartner?: boolean
}

export interface EntryTeam {
  player1: EntryPlayer
  player2: EntryPlayer | null
  seed: number | null
  drawType: DrawType
}

export interface CategoryBlock {
  category: 'men' | 'women'
  teams: EntryTeam[]
  stats: {
    playersTotal: number
    playersResolved: number
    playersWithFipId: number
    playersMissingFromDb: number
    teamsTotal: number
    teamsFullyResolved: number
  }
}

export interface TournamentRef {
  id: string
  name: string
  starts_at: string | null
  ends_at: string | null
  source: string | null
  level: string | null
  country: string | null
  fip_id: string | null
}

export interface EntryListPayload {
  tournament: TournamentRef
  capturedAt: string | null
  source: 'padelgod.entry_list_snapshots'
  categories: CategoryBlock[]
}

// ── Ghost synthesis (exported for unit testing) ─────────────────────────

export function synthesizeGhostPartners(teams: EntryTeam[]): EntryTeam[] {
  return teams.map((t) => {
    if (t.player2 !== null) return t
    if (!t.player1.partnerName) return t
    const ghost: EntryPlayer = {
      fipId: null,
      name: t.player1.partnerName,
      country: null,
      seed: null,
      drawType: t.drawType,
      partnerFipId: t.player1.fipId,
      partnerName: t.player1.name,
      resolvedPlayerId: null,
      resolvedPlayerName: null,
      resolutionMethod: 'none',
      isGhostPartner: true,
    }
    return { ...t, player2: ghost }
  })
}

// ── Main aggregator ─────────────────────────────────────────────────────

export async function getEntryListPayload(tournamentId: string): Promise<EntryListPayload | null> {
  const pool = pgPool()

  const tourRes = await pool.query(
    `select id, name, starts_at, ends_at, source, level, country, fip_id
       from public.tournaments where id = $1`,
    [tournamentId],
  )
  const tournament = tourRes.rows[0] as TournamentRef | undefined
  if (!tournament) return null

  // Latest scrape_job_id per category.
  const latestJobsRes = await pool.query(
    `select distinct on (category) category, scrape_job_id, captured_at
       from padelgod.entry_list_snapshots
       where tournament_id = $1
       order by category, captured_at desc`,
    [tournamentId],
  )
  if (latestJobsRes.rows.length === 0) {
    return {
      tournament,
      capturedAt: null,
      source: 'padelgod.entry_list_snapshots',
      categories: [emptyCategoryBlock('men'), emptyCategoryBlock('women')],
    }
  }

  const jobIdsByCategory = new Map<string, string>()
  let overallCapturedAt: string | null = null
  for (const r of latestJobsRes.rows as Array<{ category: string; scrape_job_id: string; captured_at: string }>) {
    jobIdsByCategory.set(r.category, r.scrape_job_id)
    if (!overallCapturedAt || r.captured_at > overallCapturedAt) overallCapturedAt = r.captured_at
  }

  // Snapshot rows from the latest job per category, with public.players join.
  const snapsRes = await pool.query(
    `select s.tournament_id, s.category, s.draw_type, s.fip_id, s.name, s.country, s.seed,
            s.partner_fip_id, s.partner_name, s.captured_at,
            pl.id as resolved_player_id, pl.name as resolved_player_name
       from padelgod.entry_list_snapshots s
       left join public.players pl on pl.fip_id = s.fip_id
       where s.tournament_id = $1
         and s.scrape_job_id = any($2::uuid[])
       order by s.category, s.draw_type, s.seed nulls last`,
    [tournamentId, [...jobIdsByCategory.values()]],
  )

  // Second pass: for rows whose fip_id didn't resolve, try by normalized
  // name + category (covers padelapi-created players without fip_id).
  const unresolvedRows = snapsRes.rows.filter((r: any) => !r.resolved_player_id)
  const byNormName = new Map<string, { id: string; name: string }>()
  if (unresolvedRows.length > 0) {
    const wantNames = [...new Set(unresolvedRows.map((r: any) => normalizeName(r.name)))]
    const wantCategories = [...new Set(unresolvedRows.map((r: any) => r.category))]
    const nameLookupRes = await pool.query(
      `select id, name, normalized_name, category from public.players
        where normalized_name = any($1::text[])
          and category = any($2::text[])`,
      [wantNames, wantCategories],
    )
    const byKey = new Map<string, Array<{ id: string; name: string }>>()
    for (const p of nameLookupRes.rows as Array<{ id: string; name: string; normalized_name: string; category: string }>) {
      const key = `${p.category}::${p.normalized_name}`
      if (!byKey.has(key)) byKey.set(key, [])
      byKey.get(key)!.push({ id: p.id, name: p.name })
    }
    for (const [key, cands] of byKey) {
      // Only accept unique single matches — leave ambiguous as unresolved.
      if (cands.length === 1) byNormName.set(key, cands[0]!)
    }
  }

  // Build EntryPlayer rows from snapshot rows.
  type SnapshotRow = {
    category: 'men' | 'women'
    draw_type: 'main_draw' | 'qualifying'
    fip_id: string | null
    name: string
    country: string | null
    seed: number | null
    partner_fip_id: string | null
    partner_name: string | null
    resolved_player_id: string | null
    resolved_player_name: string | null
  }
  const resolved = (snapsRes.rows as SnapshotRow[]).map((r) => {
    let resolvedPlayerId = r.resolved_player_id
    let resolvedPlayerName = r.resolved_player_name
    let resolutionMethod: ResolutionMethod = resolvedPlayerId ? 'fip_id' : 'none'
    if (!resolvedPlayerId) {
      const key = `${r.category}::${normalizeName(r.name)}`
      const hit = byNormName.get(key)
      if (hit) {
        resolvedPlayerId = hit.id
        resolvedPlayerName = hit.name
        resolutionMethod = 'name_exact'
      }
    }
    return {
      _category: r.category,
      player: {
        fipId: r.fip_id,
        name: r.name,
        country: r.country,
        seed: r.seed,
        drawType: r.draw_type,
        partnerFipId: r.partner_fip_id,
        partnerName: r.partner_name,
        resolvedPlayerId,
        resolvedPlayerName,
        resolutionMethod,
      } as EntryPlayer,
    }
  })

  // Pair into teams using fip_id pair-key (or name fallback). Partition by
  // draw_type so a player who appears in MD and Q isn't merged across draws.
  const pairKey = (p: EntryPlayer): string => {
    if (p.fipId && p.partnerFipId) {
      const [a, b] = [p.fipId, p.partnerFipId].sort()
      return `${p.drawType}::fip::${a}::${b}`
    }
    const me = normalizeName(p.name)
    const partner = p.partnerName ? normalizeName(p.partnerName) : ''
    const [a, b] = [me, partner].sort()
    return `${p.drawType}::name::${a}::${b}`
  }
  const grouped = new Map<string, Array<{ _category: 'men' | 'women'; player: EntryPlayer }>>()
  for (const r of resolved) {
    const k = `${r._category}::${pairKey(r.player)}`
    if (!grouped.has(k)) grouped.set(k, [])
    grouped.get(k)!.push(r)
  }

  const teamsByCategory: Record<'men' | 'women', EntryTeam[]> = { men: [], women: [] }
  for (const members of grouped.values()) {
    if (members.length === 0) continue
    const cat = members[0]!._category
    members.sort((a, b) => {
      const sa = a.player.seed ?? Number.MAX_SAFE_INTEGER
      const sb = b.player.seed ?? Number.MAX_SAFE_INTEGER
      if (sa !== sb) return sa - sb
      return (a.player.fipId ?? '').localeCompare(b.player.fipId ?? '')
    })
    const p1 = members[0]!.player
    const p2 = members[1]?.player ?? null
    const teamSeed =
      p1.seed != null && p2 && p2.seed != null
        ? Math.min(p1.seed, p2.seed)
        : (p1.seed ?? p2?.seed ?? null)
    teamsByCategory[cat].push({ player1: p1, player2: p2, seed: teamSeed, drawType: p1.drawType })
  }

  for (const cat of ['men', 'women'] as const) {
    teamsByCategory[cat] = synthesizeGhostPartners(teamsByCategory[cat])
    teamsByCategory[cat].sort((a, b) => {
      const drawOrder = (d: DrawType) => (d === 'main_draw' ? 0 : 1)
      const dd = drawOrder(a.drawType) - drawOrder(b.drawType)
      if (dd !== 0) return dd
      const sa = a.seed ?? Number.MAX_SAFE_INTEGER
      const sb = b.seed ?? Number.MAX_SAFE_INTEGER
      if (sa !== sb) return sa - sb
      return a.player1.name.localeCompare(b.player1.name)
    })
  }

  const categories: CategoryBlock[] = (['men', 'women'] as const).map((cat) => {
    const teams = teamsByCategory[cat]
    const allPlayers = teams.flatMap((t) => (t.player2 ? [t.player1, t.player2] : [t.player1]))
    const playersTotal = allPlayers.length
    const playersResolved = allPlayers.filter((p) => p.resolvedPlayerId !== null).length
    const playersWithFipId = allPlayers.filter((p) => !!p.fipId).length
    const playersMissingFromDb = playersTotal - playersResolved
    const teamsFullyResolved = teams.filter(
      (t) => t.player1.resolvedPlayerId !== null && t.player2 !== null && t.player2.resolvedPlayerId !== null,
    ).length
    return {
      category: cat,
      teams,
      stats: { playersTotal, playersResolved, playersWithFipId, playersMissingFromDb, teamsTotal: teams.length, teamsFullyResolved },
    }
  })

  return { tournament, capturedAt: overallCapturedAt, source: 'padelgod.entry_list_snapshots', categories }
}

function emptyCategoryBlock(cat: 'men' | 'women'): CategoryBlock {
  return {
    category: cat,
    teams: [],
    stats: {
      playersTotal: 0,
      playersResolved: 0,
      playersWithFipId: 0,
      playersMissingFromDb: 0,
      teamsTotal: 0,
      teamsFullyResolved: 0,
    },
  }
}

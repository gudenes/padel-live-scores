// src/app/api/ops/padelgod-entry-list/route.ts
//
// Returns the latest padelgod.entry_list_snapshots for a tournament,
// de-duplicated into team pairs, annotated with per-player resolution
// against `public.players`. Read-only — this route never writes.
//
// Purpose
// -------
// Scaffolding for the slow migration of match-creation authority from
// padelapi → padelgod. Before we let padelgod CREATE matches, we need
// visibility into how well its entry list covers reality:
//   - Does every player in padelgod's snapshot also exist in our `players`
//     table? If not, we'd be creating matches with TBD FKs.
//   - Are FIP IDs captured consistently (the strongest resolution signal)?
//   - Are the teams (pairs) self-consistent?
//
// The UI surfaces all of this so operators can judge per-tournament whether
// padelgod's view is trustworthy before turning on autonomous match creation.
//
// Auth: reads ops_token cookie via `checkOpsAuth`.

import { createClient } from '@supabase/supabase-js'
import { checkOpsAuth } from '@/lib/ops-auth'
import { normalize } from '@/lib/player-resolver'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

// ── Types ────────────────────────────────────────────────────────────────

/** How we resolved a padelgod-entry player to our public.players row. */
type ResolutionMethod =
  | 'fip_id' //     exact FIP id match — strongest
  | 'name_exact' // normalized name matched a single row
  | 'none' //       no confident match

interface EntryPlayer {
  fipId: string | null
  name: string
  country: string | null
  seed: number | null
  // Partner link — the raw FIP id padelgod captured for the pair-mate.
  // Used for de-dup (same pair appears as two rows, once per member).
  partnerFipId: string | null
  partnerName: string | null
  // Resolution against public.players
  resolvedPlayerId: string | null
  resolvedPlayerName: string | null
  resolutionMethod: ResolutionMethod
}

interface EntryTeam {
  player1: EntryPlayer
  player2: EntryPlayer | null // null when padelgod captured only one side
  seed: number | null // team seed = min(player1.seed, player2.seed) when both set
}

interface CategoryBlock {
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

// ── Handler ──────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const url = new URL(request.url)
  const tournamentId = url.searchParams.get('tournament_id')

  // Support a "list active tournaments" mode for the UI dropdown — returns
  // tournaments with any snapshot in the last 30 days. Keeps the dropdown
  // focused on tournaments padelgod actually tracks.
  if (!tournamentId) {
    const { data, error } = await supabase
      .schema('padelgod')
      .from('entry_list_snapshots')
      .select('tournament_id, captured_at')
      .gte(
        'captured_at',
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      )
      .order('captured_at', { ascending: false })

    if (error) {
      return Response.json(
        { error: `entry_list_snapshots read failed: ${error.message}` },
        { status: 500 },
      )
    }

    // Dedup tournaments, keep latest captured_at per tournament.
    const byId = new Map<string, string>()
    for (const row of (data ?? []) as Array<{
      tournament_id: string
      captured_at: string
    }>) {
      if (!byId.has(row.tournament_id)) byId.set(row.tournament_id, row.captured_at)
    }

    // Enrich with tournament name.
    const tournamentIds = [...byId.keys()]
    if (tournamentIds.length === 0) return Response.json({ tournaments: [] })

    const { data: tournaments, error: tourErr } = await supabase
      .from('tournaments')
      .select('id, name, starts_at, ends_at, source, level, country')
      .in('id', tournamentIds)
      .order('starts_at', { ascending: false })

    if (tourErr) {
      return Response.json(
        { error: `tournaments read failed: ${tourErr.message}` },
        { status: 500 },
      )
    }

    const enriched = (tournaments ?? []).map((t: any) => ({
      ...t,
      latestSnapshotAt: byId.get(t.id) ?? null,
    }))
    return Response.json({ tournaments: enriched })
  }

  // ── Single-tournament detail ───────────────────────────────────────────

  const { data: tournament, error: tourErr } = await supabase
    .from('tournaments')
    .select('id, name, starts_at, ends_at, source, level, country')
    .eq('id', tournamentId)
    .maybeSingle()

  if (tourErr) {
    return Response.json(
      { error: `tournaments read failed: ${tourErr.message}` },
      { status: 500 },
    )
  }
  if (!tournament) {
    return Response.json({ error: 'Tournament not found' }, { status: 404 })
  }

  // Fetch the latest snapshot per (tournament, category). We want each
  // category's most recent scrape_job; older snapshots are stale.
  const { data: entrySnaps, error: entryErr } = await supabase
    .schema('padelgod')
    .from('entry_list_snapshots')
    .select(
      'scrape_job_id, tournament_id, category, fip_id, name, country, seed, partner_fip_id, partner_name, captured_at',
    )
    .eq('tournament_id', tournamentId)
    .order('captured_at', { ascending: false })

  if (entryErr) {
    return Response.json(
      { error: `entry_list_snapshots read failed: ${entryErr.message}` },
      { status: 500 },
    )
  }

  const allRows = (entrySnaps ?? []) as Array<{
    scrape_job_id: string
    tournament_id: string
    category: 'men' | 'women'
    fip_id: string | null
    name: string
    country: string | null
    seed: number | null
    partner_fip_id: string | null
    partner_name: string | null
    captured_at: string
  }>

  if (allRows.length === 0) {
    return Response.json({
      tournament,
      capturedAt: null,
      source: 'padelgod.entry_list_snapshots',
      categories: [
        emptyCategoryBlock('men'),
        emptyCategoryBlock('women'),
      ],
      message: 'No entry-list snapshot yet',
    })
  }

  // Keep only rows from the latest scrape_job PER CATEGORY (men & women may
  // be scraped in separate jobs).
  const latestJobIdPerCat = new Map<string, string>()
  for (const r of allRows) {
    if (!latestJobIdPerCat.has(r.category)) {
      latestJobIdPerCat.set(r.category, r.scrape_job_id)
    }
  }
  const latestRows = allRows.filter(
    (r) => latestJobIdPerCat.get(r.category) === r.scrape_job_id,
  )

  // Overall capturedAt — most-recent across both categories.
  const overallCapturedAt = latestRows.reduce<string | null>(
    (acc, r) => (acc === null || r.captured_at > acc ? r.captured_at : acc),
    null,
  )

  // Resolve each entry against public.players in bulk. We try two passes:
  //   1. fip_id exact match — covers the strong case.
  //   2. normalized_name + category — picks up rows missing fip_id that
  //      nonetheless exist in players (e.g. padelapi-created rows without
  //      fip tracking).
  const fipIdsNonNull = latestRows
    .map((r) => r.fip_id)
    .filter((f): f is string => !!f)

  const byFipId = new Map<string, { id: string; name: string }>()
  if (fipIdsNonNull.length > 0) {
    const { data: byFipRows, error: fipErr } = await supabase
      .from('players')
      .select('id, name, fip_id')
      .in('fip_id', fipIdsNonNull)
    if (fipErr) {
      return Response.json(
        { error: `players (fip_id) read failed: ${fipErr.message}` },
        { status: 500 },
      )
    }
    for (const row of (byFipRows ?? []) as Array<{
      id: string
      name: string
      fip_id: string
    }>) {
      byFipId.set(row.fip_id, { id: row.id, name: row.name })
    }
  }

  // Name-based fallback is per-category so the search stays scoped. We
  // query each category's normalized names once. Only done for rows whose
  // fip_id lookup failed — keeps the query bounded.
  const needsNameLookup = latestRows.filter(
    (r) => !(r.fip_id && byFipId.has(r.fip_id)),
  )
  const byNormCat = new Map<string, { id: string; name: string }>()
  if (needsNameLookup.length > 0) {
    const normKeys = new Set<string>()
    for (const r of needsNameLookup) {
      normKeys.add(`${r.category}::${normalize(r.name)}`)
    }
    // Supabase doesn't support compound "IN" over (category, normalized_name),
    // so we fetch all players for the relevant categories and filter client-
    // side. This page is an ops tool; the cost is acceptable (~5000 rows
    // max per category).
    const categoriesNeeded = new Set(
      needsNameLookup.map((r) => r.category),
    )
    const { data: playerRows, error: nameErr } = await supabase
      .from('players')
      .select('id, name, normalized_name, category')
      .in('category', [...categoriesNeeded])

    if (nameErr) {
      return Response.json(
        { error: `players (name) read failed: ${nameErr.message}` },
        { status: 500 },
      )
    }

    const byKey = new Map<string, Array<{ id: string; name: string }>>()
    for (const p of (playerRows ?? []) as Array<{
      id: string
      name: string
      normalized_name: string | null
      category: 'men' | 'women'
    }>) {
      const norm = p.normalized_name ?? normalize(p.name)
      const key = `${p.category}::${norm}`
      if (!normKeys.has(key)) continue
      if (!byKey.has(key)) byKey.set(key, [])
      byKey.get(key)!.push({ id: p.id, name: p.name })
    }

    // Only accept unique matches — ambiguous (>1) is deliberately left
    // unresolved so the UI surfaces the problem for operator review.
    for (const [key, candidates] of byKey) {
      if (candidates.length === 1) byNormCat.set(key, candidates[0]!)
    }
  }

  // Build resolved player view per row.
  const resolved: Array<
    EntryPlayer & { _category: 'men' | 'women' }
  > = latestRows.map((r) => {
    let resolvedPlayerId: string | null = null
    let resolvedPlayerName: string | null = null
    let resolutionMethod: ResolutionMethod = 'none'

    if (r.fip_id && byFipId.has(r.fip_id)) {
      const hit = byFipId.get(r.fip_id)!
      resolvedPlayerId = hit.id
      resolvedPlayerName = hit.name
      resolutionMethod = 'fip_id'
    } else {
      const key = `${r.category}::${normalize(r.name)}`
      if (byNormCat.has(key)) {
        const hit = byNormCat.get(key)!
        resolvedPlayerId = hit.id
        resolvedPlayerName = hit.name
        resolutionMethod = 'name_exact'
      }
    }

    return {
      fipId: r.fip_id,
      name: r.name,
      country: r.country,
      seed: r.seed,
      partnerFipId: r.partner_fip_id,
      partnerName: r.partner_name,
      resolvedPlayerId,
      resolvedPlayerName,
      resolutionMethod,
      _category: r.category,
    }
  })

  // Pair resolved players into teams. Padelgod writes two rows per team
  // (one per member), each pointing to the other via partner_fip_id. We
  // dedup by the smaller of the two FIP ids. For pairs where one side has
  // no FIP id, fall back to name+partner_name matching.
  const pairKey = (p: EntryPlayer & { _category: 'men' | 'women' }) => {
    if (p.fipId && p.partnerFipId) {
      const [a, b] = [p.fipId, p.partnerFipId].sort()
      return `${p._category}::fip::${a}::${b}`
    }
    // Fallback — name-based key, lexicographically sorted for stability.
    const me = normalize(p.name)
    const partner = p.partnerName ? normalize(p.partnerName) : ''
    const [a, b] = [me, partner].sort()
    return `${p._category}::name::${a}::${b}`
  }
  const grouped = new Map<string, Array<EntryPlayer & { _category: 'men' | 'women' }>>()
  for (const r of resolved) {
    const k = pairKey(r)
    if (!grouped.has(k)) grouped.set(k, [])
    grouped.get(k)!.push(r)
  }

  const teamsByCategory: Record<'men' | 'women', EntryTeam[]> = { men: [], women: [] }
  const playersByCategory: Record<
    'men' | 'women',
    Array<EntryPlayer & { _category: 'men' | 'women' }>
  > = { men: [], women: [] }

  for (const members of grouped.values()) {
    if (members.length === 0) continue
    const cat = members[0]!._category
    // Order by seed (lowest first), then by fipId for stability.
    members.sort((a, b) => {
      const sa = a.seed ?? Number.MAX_SAFE_INTEGER
      const sb = b.seed ?? Number.MAX_SAFE_INTEGER
      if (sa !== sb) return sa - sb
      return (a.fipId ?? '').localeCompare(b.fipId ?? '')
    })
    const p1 = members[0]!
    const p2 = members[1] ?? null
    const teamSeed =
      p1.seed != null && p2 && p2.seed != null
        ? Math.min(p1.seed, p2.seed)
        : p1.seed ?? p2?.seed ?? null

    teamsByCategory[cat].push({
      player1: stripCategory(p1),
      player2: p2 ? stripCategory(p2) : null,
      seed: teamSeed,
    })
    playersByCategory[cat].push(...members)
  }

  // Sort teams by seed ascending, unseeded last.
  for (const cat of ['men', 'women'] as const) {
    teamsByCategory[cat].sort((a, b) => {
      const sa = a.seed ?? Number.MAX_SAFE_INTEGER
      const sb = b.seed ?? Number.MAX_SAFE_INTEGER
      if (sa !== sb) return sa - sb
      return a.player1.name.localeCompare(b.player1.name)
    })
  }

  const categories: CategoryBlock[] = (['men', 'women'] as const).map((cat) => {
    const teams = teamsByCategory[cat]
    const players = playersByCategory[cat]
    const playersTotal = players.length
    const playersResolved = players.filter(
      (p) => p.resolvedPlayerId !== null,
    ).length
    const playersWithFipId = players.filter((p) => !!p.fipId).length
    const playersMissingFromDb = playersTotal - playersResolved
    const teamsFullyResolved = teams.filter(
      (t) =>
        t.player1.resolvedPlayerId !== null &&
        (t.player2 === null || t.player2.resolvedPlayerId !== null),
    ).length
    return {
      category: cat,
      teams,
      stats: {
        playersTotal,
        playersResolved,
        playersWithFipId,
        playersMissingFromDb,
        teamsTotal: teams.length,
        teamsFullyResolved,
      },
    }
  })

  return Response.json({
    tournament,
    capturedAt: overallCapturedAt,
    source: 'padelgod.entry_list_snapshots',
    categories,
  })
}

// ── Helpers ──────────────────────────────────────────────────────────────

function stripCategory(
  p: EntryPlayer & { _category: 'men' | 'women' },
): EntryPlayer {
  const { _category: _cat, ...rest } = p
  return rest
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

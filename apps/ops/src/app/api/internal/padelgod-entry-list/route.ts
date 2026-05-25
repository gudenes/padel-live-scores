// apps/ops/src/app/api/internal/padelgod-entry-list/route.ts
//
// Returns the latest padelgod.entry_list_snapshots for a tournament,
// de-duplicated into team pairs, annotated with per-player resolution
// against `public.players`. Read-only — this route never writes.
//
// Ported from src/app/api/ops/padelgod-entry-list/route.ts (Plan 3a hotfix).
// Auth: next-auth session + isOperator flag.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import { normalize } from '@/lib/player-resolver'

// ── Types ────────────────────────────────────────────────────────────────

/** How we resolved a padelgod-entry player to our public.players row. */
type ResolutionMethod =
  | 'fip_id' //     exact FIP id match — strongest
  | 'name_exact' // normalized name matched a single row
  | 'none' //       no confident match

type DrawType = 'main_draw' | 'qualifying'

interface EntryPlayer {
  fipId: string | null
  name: string
  country: string | null
  seed: number | null
  drawType: DrawType
  // Partner link — the raw FIP id padelgod captured for the pair-mate.
  // Used for de-dup (same pair appears as two rows, once per member).
  partnerFipId: string | null
  partnerName: string | null
  // Resolution against public.players
  resolvedPlayerId: string | null
  resolvedPlayerName: string | null
  resolutionMethod: ResolutionMethod
  // Enrichment fields from the resolved players row — power PlayerLink's
  // status dot (enriched / thin / unresolved) across ops surfaces.
  resolvedAvatarUrl: string | null
  resolvedRanking: number | null
  resolvedPadelapiId: string | null
  // Resolved player's country — feeds PlayerLink hover card flag (T3 of Plan 8).
  // Does NOT affect status; falls back to the snapshot country when missing.
  resolvedCountry: string | null
  // True when this row was synthesized server-side from a surviving teammate's
  // `partner_name` because the padelgod fetcher could not resolve the partner.
  // The UI renders these with a RESOLVE chip + click handler that opens the
  // unresolved-partner modal (link to existing player / create new).
  isGhostPartner?: boolean
}

interface EntryTeam {
  player1: EntryPlayer
  player2: EntryPlayer | null // null when padelgod captured only one side
  seed: number | null // team seed = min(player1.seed, player2.seed) when both set
  drawType: DrawType
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
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()
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
      .select('id, name, starts_at, ends_at, source, level, country, fip_id')
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
    .select('id, name, starts_at, ends_at, source, level, country, fip_id')
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
      'scrape_job_id, tournament_id, category, draw_type, fip_id, name, country, seed, partner_fip_id, partner_name, captured_at',
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
    draw_type: 'main_draw' | 'qualifying'
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

  type ResolvedPlayer = {
    id: string
    name: string
    avatar_url: string | null
    ranking: number | null
    padelapi_id: string | null
    country: string | null
  }

  const byFipId = new Map<string, ResolvedPlayer>()
  if (fipIdsNonNull.length > 0) {
    const { data: byFipRows, error: fipErr } = await supabase
      .from('players')
      .select('id, name, fip_id, avatar_url, ranking, padelapi_id, country')
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
      avatar_url: string | null
      ranking: number | null
      padelapi_id: string | null
      country: string | null
    }>) {
      byFipId.set(row.fip_id, {
        id: row.id,
        name: row.name,
        avatar_url: row.avatar_url,
        ranking: row.ranking,
        padelapi_id: row.padelapi_id,
        country: row.country,
      })
    }
  }

  // Name-based fallback is per-category so the search stays scoped. We
  // query each category's normalized names once. Only done for rows whose
  // fip_id lookup failed — keeps the query bounded.
  const needsNameLookup = latestRows.filter(
    (r) => !(r.fip_id && byFipId.has(r.fip_id)),
  )
  const byNormCat = new Map<string, ResolvedPlayer>()
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
      .select('id, name, normalized_name, category, avatar_url, ranking, padelapi_id, country')
      .in('category', [...categoriesNeeded])

    if (nameErr) {
      return Response.json(
        { error: `players (name) read failed: ${nameErr.message}` },
        { status: 500 },
      )
    }

    const byKey = new Map<string, ResolvedPlayer[]>()
    for (const p of (playerRows ?? []) as Array<{
      id: string
      name: string
      normalized_name: string | null
      category: 'men' | 'women'
      avatar_url: string | null
      ranking: number | null
      padelapi_id: string | null
      country: string | null
    }>) {
      const norm = p.normalized_name ?? normalize(p.name)
      const key = `${p.category}::${norm}`
      if (!normKeys.has(key)) continue
      if (!byKey.has(key)) byKey.set(key, [])
      byKey.get(key)!.push({
        id: p.id,
        name: p.name,
        avatar_url: p.avatar_url,
        ranking: p.ranking,
        padelapi_id: p.padelapi_id,
        country: p.country,
      })
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
    let resolvedAvatarUrl: string | null = null
    let resolvedRanking: number | null = null
    let resolvedPadelapiId: string | null = null
    let resolvedCountry: string | null = null
    let resolutionMethod: ResolutionMethod = 'none'

    if (r.fip_id && byFipId.has(r.fip_id)) {
      const hit = byFipId.get(r.fip_id)!
      resolvedPlayerId = hit.id
      resolvedPlayerName = hit.name
      resolvedAvatarUrl = hit.avatar_url
      resolvedRanking = hit.ranking
      resolvedPadelapiId = hit.padelapi_id
      resolvedCountry = hit.country
      resolutionMethod = 'fip_id'
    } else {
      const key = `${r.category}::${normalize(r.name)}`
      if (byNormCat.has(key)) {
        const hit = byNormCat.get(key)!
        resolvedPlayerId = hit.id
        resolvedPlayerName = hit.name
        resolvedAvatarUrl = hit.avatar_url
        resolvedRanking = hit.ranking
        resolvedPadelapiId = hit.padelapi_id
        resolvedCountry = hit.country
        resolutionMethod = 'name_exact'
      }
    }

    return {
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
      resolvedAvatarUrl,
      resolvedRanking,
      resolvedPadelapiId,
      resolvedCountry,
      _category: r.category,
    }
  })

  // Pair resolved players into teams. Padelgod writes two rows per team
  // (one per member), each pointing to the other via partner_fip_id. We
  // dedup by the smaller of the two FIP ids. For pairs where one side has
  // no FIP id, fall back to name+partner_name matching.
  // Partition by draw_type so a player who appears in both MD and Q (rare,
  // but possible across separate scrapes or mid-tournament reseed) doesn't
  // get pair-merged across draws.
  const pairKey = (p: EntryPlayer & { _category: 'men' | 'women' }) => {
    if (p.fipId && p.partnerFipId) {
      const [a, b] = [p.fipId, p.partnerFipId].sort()
      return `${p._category}::${p.drawType}::fip::${a}::${b}`
    }
    // Fallback — name-based key, lexicographically sorted for stability.
    const me = normalize(p.name)
    const partner = p.partnerName ? normalize(p.partnerName) : ''
    const [a, b] = [me, partner].sort()
    return `${p._category}::${p.drawType}::name::${a}::${b}`
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
      drawType: p1.drawType,
    })
    playersByCategory[cat].push(...members)
  }

  // Sort: main draw before qualifying, then seed ascending, unseeded last.
  // synthesizeGhostPartners runs BEFORE the sort so ghost rows participate
  // in the ordering naturally (their team_seed comes from the surviving
  // partner, so the row stays at the correct seed position).
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
    // Stats derived from teams (which include ghost player2 entries) instead
    // of the raw snapshot rows. This makes `playersTotal` reflect PDF reality
    // (84 expected for FIP PLATINUM ALBANIA men's) rather than snapshot-row
    // count (80, missing the 4 unresolved partners). `playersMissingFromDb`
    // is then a meaningful red number rather than always 0.
    const allPlayers = teams.flatMap((t) => (t.player2 ? [t.player1, t.player2] : [t.player1]))
    const playersTotal = allPlayers.length
    const playersResolved = allPlayers.filter((p) => p.resolvedPlayerId !== null).length
    const playersWithFipId = allPlayers.filter((p) => !!p.fipId).length
    const playersMissingFromDb = playersTotal - playersResolved
    // Strict: requires BOTH players resolved. Ghosts (synthesized above) have
    // resolvedPlayerId=null so they correctly disqualify their team here.
    const teamsFullyResolved = teams.filter(
      (t) =>
        t.player1.resolvedPlayerId !== null &&
        t.player2 !== null &&
        t.player2.resolvedPlayerId !== null,
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

/**
 * Walk the teams produced by pair-grouping. For any team whose `player2` is
 * null but whose `player1.partnerName` carries a raw PDF name, synthesize a
 * ghost EntryPlayer for player2 so the UI can render the dropped name with a
 * RESOLVE chip. Other resolved-player enrichment fields are nulled out —
 * a ghost has, by definition, never been resolved to a public.players row.
 */
function synthesizeGhostPartners(teams: EntryTeam[]): EntryTeam[] {
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
      resolvedAvatarUrl: null,
      resolvedRanking: null,
      resolvedPadelapiId: null,
      resolvedCountry: null,
      isGhostPartner: true,
    }
    return { ...t, player2: ghost }
  })
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

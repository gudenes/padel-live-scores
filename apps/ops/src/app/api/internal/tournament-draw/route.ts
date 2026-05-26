// apps/ops/src/app/api/internal/tournament-draw/route.ts
//
// Tournament-scoped bracket view sourced from padelgod.draw_snapshots.
// Returns every draw slot captured by the hourly draw-fetcher, grouped by
// (category, draw_type) and ordered by round label. The Tournament
// Explorer "Draw" subtab renders these as a tabbed bracket.
//
// Auth: NextAuth session, isOperator required.

import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import { normalize } from '@/lib/player-resolver'

// ── Types ────────────────────────────────────────────────────────────────

type Category = 'men' | 'women'
type DrawType = 'main_draw' | 'qualifying'

/**
 * Per-slot player payload powering the shared PlayerLink component in the
 * Draw subtab. Each draw match has up to 4 slots (2 pairs × 2 players);
 * each carries enough fields to drive the status dot + deep-link to
 * /players/[id].
 *
 * `id` is null when we couldn't resolve the scraped name back to a
 * `public.players` row (PlayerLink renders plain italic text, status =
 * "unresolved"). When `id` is set, the enrichment fields determine whether
 * PlayerLink shows "thin" or "enriched".
 *
 * `name` is always the scraped name from the draw snapshot (canonical
 * display) — we don't overwrite it with the resolved player's name even
 * when the resolved name differs slightly, because the operator is
 * debugging exactly that mismatch.
 *
 * Note: `padelgod.draw_snapshots` carries no player FKs (unlike
 * `public.matches`), so resolution is purely name+category. See route body.
 */
interface ExplorerPlayer {
  id: string | null
  name: string
  avatar_url: string | null
  ranking: number | null
  padelapi_id: string | null
  fip_id: string | null
  /** Resolved player's country — feeds PlayerLink hover card flag (T3 of Plan 8).
   * Does NOT affect status. Null when slot was unresolved. */
  country: string | null
}

interface DrawMatch {
  drawPosition: number | null
  roundLabel: string | null
  // Raw scraped names — kept for back-compat with any consumer that
  // doesn't read the nested per-slot players block.
  team1Player1Name: string | null
  team1Player2Name: string | null
  team1Country: string | null
  team1Seed: number | null
  team2Player1Name: string | null
  team2Player2Name: string | null
  team2Country: string | null
  team2Seed: number | null
  // Per-slot enriched payloads — preferred for rendering. null when no
  // name was scraped for that slot at all.
  team1Player1: ExplorerPlayer | null
  team1Player2: ExplorerPlayer | null
  team2Player1: ExplorerPlayer | null
  team2Player2: ExplorerPlayer | null
  setScores: unknown | null
  winnerTeam: number | null
  status: string | null
}

interface DrawBlock {
  category: Category
  drawType: DrawType
  rounds: Array<{ roundLabel: string; matches: DrawMatch[] }>
  capturedAt: string | null
  total: number
}

interface DetailResponse {
  tournament: {
    id: string
    name: string
    starts_at: string | null
    ends_at: string | null
    level: string | null
    country: string | null
    source: string | null
  } | null
  blocks: DrawBlock[]
  capturedAt: string | null
}

// ── Handler ──────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = serviceClient()

  const url = new URL(request.url)
  const tournamentId = url.searchParams.get('tournament_id')
  if (!tournamentId) {
    return Response.json({ error: 'tournament_id is required' }, { status: 400 })
  }

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

  const { data: drawRows, error: drawErr } = await supabase
    .schema('padelgod')
    .from('draw_snapshots')
    .select(
      'scrape_job_id, category, draw_type, round_label, draw_position, ' +
        'team1_player1_name, team1_player2_name, team1_country, team1_seed, ' +
        'team2_player1_name, team2_player2_name, team2_country, team2_seed, ' +
        'set_scores, winner_team, status, captured_at',
    )
    .eq('tournament_id', tournamentId)
    .order('captured_at', { ascending: false })

  if (drawErr) {
    return Response.json(
      { error: `draw_snapshots read failed: ${drawErr.message}` },
      { status: 500 },
    )
  }

  type Row = {
    scrape_job_id: string
    category: Category
    draw_type: DrawType
    round_label: string | null
    draw_position: number | null
    team1_player1_name: string | null
    team1_player2_name: string | null
    team1_country: string | null
    team1_seed: number | null
    team2_player1_name: string | null
    team2_player2_name: string | null
    team2_country: string | null
    team2_seed: number | null
    set_scores: unknown | null
    winner_team: number | null
    status: string | null
    captured_at: string
  }

  const rows = (drawRows ?? []) as unknown as Row[]

  // Keep only rows from the latest scrape_job per (category, draw_type,
  // round_label). The draw-fetcher writes each round as its own job, so
  // newer scrapes fully replace older ones at that granularity.
  const latestJobPerBucket = new Map<string, string>()
  const bucketKey = (r: Row) => `${r.category}::${r.draw_type}::${r.round_label ?? ''}`
  for (const r of rows) {
    const k = bucketKey(r)
    if (!latestJobPerBucket.has(k)) latestJobPerBucket.set(k, r.scrape_job_id)
  }
  const latest = rows.filter((r) => latestJobPerBucket.get(bucketKey(r)) === r.scrape_job_id)

  // ── Player enrichment ────────────────────────────────────────────────
  //
  // `draw_snapshots` carries no player FKs — every slot is a scraped name.
  // So resolution is name+category only (unlike tournament-matches, which
  // also has a UUID-lookup pass via public.matches.pair*_player*_id).
  //
  // For each (category, normalized_name) pair seen on the latest rows,
  // look up `public.players` and accept only unique hits (ambiguous
  // matches stay unresolved — PlayerLink will render italic gray).
  //
  // Effect: tournaments whose entries already exist as canonical players
  // get PlayerLink coverage even when the FIP-side widget has no
  // crionet_widget mapping yet.

  type ResolvedPlayer = {
    id: string
    name: string
    avatar_url: string | null
    ranking: number | null
    padelapi_id: string | null
    fip_id: string | null
    country: string | null
  }

  const nameSlotsByCategory = new Map<Category, Set<string>>()
  const addName = (name: string | null, category: Category) => {
    if (!name) return
    const norm = normalize(name)
    if (!norm) return
    if (!nameSlotsByCategory.has(category)) nameSlotsByCategory.set(category, new Set())
    nameSlotsByCategory.get(category)!.add(norm)
  }
  for (const r of latest) {
    addName(r.team1_player1_name, r.category)
    addName(r.team1_player2_name, r.category)
    addName(r.team2_player1_name, r.category)
    addName(r.team2_player2_name, r.category)
  }

  const playersByNormCat = new Map<string, ResolvedPlayer>()
  const categoriesNeeded = [...nameSlotsByCategory.keys()]
  if (categoriesNeeded.length > 0) {
    const { data: byNameRows, error: byNameErr } = await supabase
      .from('players')
      .select('id, name, normalized_name, category, avatar_url, ranking, padelapi_id, fip_id, country')
      .in('category', categoriesNeeded)
    if (byNameErr) {
      return Response.json(
        { error: `players name lookup failed: ${byNameErr.message}` },
        { status: 500 },
      )
    }

    const byKey = new Map<string, ResolvedPlayer[]>()
    for (const p of (byNameRows ?? []) as Array<{
      id: string
      name: string
      normalized_name: string | null
      category: Category
      avatar_url: string | null
      ranking: number | null
      padelapi_id: string | null
      fip_id: string | null
      country: string | null
    }>) {
      const norm = p.normalized_name ?? normalize(p.name)
      const wanted = nameSlotsByCategory.get(p.category)
      if (!wanted || !wanted.has(norm)) continue
      const key = `${p.category}::${norm}`
      if (!byKey.has(key)) byKey.set(key, [])
      byKey.get(key)!.push({
        id: p.id,
        name: p.name,
        avatar_url: p.avatar_url,
        ranking: p.ranking,
        padelapi_id: p.padelapi_id,
        fip_id: p.fip_id,
        country: p.country,
      })
    }
    for (const [k, candidates] of byKey) {
      if (candidates.length === 1) playersByNormCat.set(k, candidates[0]!)
      // ambiguous → leave unresolved
    }
  }

  // Build the per-slot ExplorerPlayer. `name` is the canonical display
  // (scraped); enrichment is whatever the unique-hit resolver returned.
  // Returns null when no name was scraped at all.
  const buildSlot = (
    name: string | null,
    category: Category,
    teamCountry: string | null = null,
  ): ExplorerPlayer | null => {
    if (!name) return null
    const norm = normalize(name)
    const resolved = norm ? playersByNormCat.get(`${category}::${norm}`) ?? null : null
    return {
      id: resolved?.id ?? null,
      name,
      avatar_url: resolved?.avatar_url ?? null,
      ranking: resolved?.ranking ?? null,
      padelapi_id: resolved?.padelapi_id ?? null,
      fip_id: resolved?.fip_id ?? null,
      // Prefer the resolved player's country (canonical); fall back to the
      // draw snapshot's team-level country so the hover card still has a flag
      // even when the slot didn't resolve to a public.players row.
      country: resolved?.country ?? teamCountry ?? null,
    }
  }

  // Bucket by (category, draw_type) → round_label → matches.
  const blockMap = new Map<string, DrawBlock>()
  for (const r of latest) {
    const key = `${r.category}::${r.draw_type}`
    let block = blockMap.get(key)
    if (!block) {
      block = { category: r.category, drawType: r.draw_type, rounds: [], capturedAt: null, total: 0 }
      blockMap.set(key, block)
    }

    const round = (() => {
      const existing = block.rounds.find((x) => x.roundLabel === (r.round_label ?? ''))
      if (existing) return existing
      const created = { roundLabel: r.round_label ?? '', matches: [] as DrawMatch[] }
      block.rounds.push(created)
      return created
    })()

    round.matches.push({
      drawPosition: r.draw_position,
      roundLabel: r.round_label,
      team1Player1Name: r.team1_player1_name,
      team1Player2Name: r.team1_player2_name,
      team1Country: r.team1_country,
      team1Seed: r.team1_seed,
      team2Player1Name: r.team2_player1_name,
      team2Player2Name: r.team2_player2_name,
      team2Country: r.team2_country,
      team2Seed: r.team2_seed,
      team1Player1: buildSlot(r.team1_player1_name, r.category, r.team1_country),
      team1Player2: buildSlot(r.team1_player2_name, r.category, r.team1_country),
      team2Player1: buildSlot(r.team2_player1_name, r.category, r.team2_country),
      team2Player2: buildSlot(r.team2_player2_name, r.category, r.team2_country),
      setScores: r.set_scores,
      winnerTeam: r.winner_team,
      status: r.status,
    })
    block.total++
    if (!block.capturedAt || r.captured_at > block.capturedAt) block.capturedAt = r.captured_at
  }

  // Order: main_draw first, then qualifying; men before women. Within a
  // block, matches go by draw_position. Rounds keep insertion order (the
  // SELECT is newest-first, so rounds naturally fall in scrape sequence —
  // the draw-fetcher iterates 1..8, so sorting rounds by an embedded
  // integer is a nice-to-have rather than required).
  for (const block of blockMap.values()) {
    for (const round of block.rounds) {
      round.matches.sort((a, b) => (a.drawPosition ?? 0) - (b.drawPosition ?? 0))
    }
    block.rounds.sort((a, b) => parseRoundForSort(a.roundLabel) - parseRoundForSort(b.roundLabel))
  }

  const blocks = [...blockMap.values()].sort((a, b) => {
    const typeOrder = (t: DrawType) => (t === 'main_draw' ? 0 : 1)
    if (typeOrder(a.drawType) !== typeOrder(b.drawType))
      return typeOrder(a.drawType) - typeOrder(b.drawType)
    return a.category === 'men' ? -1 : 1
  })

  const overallCapturedAt = blocks.reduce<string | null>((acc, b) => {
    if (!b.capturedAt) return acc
    if (!acc || b.capturedAt > acc) return b.capturedAt
    return acc
  }, null)

  const response: DetailResponse = {
    tournament,
    blocks,
    capturedAt: overallCapturedAt,
  }

  return Response.json(response)
}

// ── Helpers ──────────────────────────────────────────────────────────────

// Round labels come in as "R1", "R2", "SF", "F", "QF", etc. We want rounds
// ordered by how close they are to the final: qualifier R1 → R32 → R16 →
// QF → SF → F. The widget already gives us round integers 1..8, so we
// extract digits; label strings without a digit map to 999 (surfaces last).
function parseRoundForSort(label: string): number {
  const m = label.match(/\d+/)
  if (m) return parseInt(m[0]!, 10)
  const lower = label.toLowerCase()
  if (lower.includes('final') && !lower.includes('semi') && !lower.includes('quarter')) return 100
  if (lower.includes('semi')) return 90
  if (lower.includes('quarter')) return 80
  return 999
}

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

// ── Types ────────────────────────────────────────────────────────────────

type Category = 'men' | 'women'
type DrawType = 'main_draw' | 'qualifying'

interface DrawMatch {
  drawPosition: number | null
  roundLabel: string | null
  team1Player1Name: string | null
  team1Player2Name: string | null
  team1Country: string | null
  team1Seed: number | null
  team2Player1Name: string | null
  team2Player2Name: string | null
  team2Country: string | null
  team2Seed: number | null
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

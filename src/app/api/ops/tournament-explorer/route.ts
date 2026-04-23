// src/app/api/ops/tournament-explorer/route.ts
//
// Tournament-centric view of padelgod data. Lists every tournament that has
// at least one padelgod snapshot across any of the four tables:
//
//   - padelgod.entry_list_snapshots
//   - padelgod.oop_snapshots
//   - padelgod.results_snapshots
//   - padelgod.draw_snapshots
//
// The returned list is the universe of tournaments the Tournament Explorer
// tab can drill into. Each row includes per-source `capturedAt` timestamps
// so the UI can show at a glance which data is fresh vs. stale.
//
// This endpoint is DISTINCT from `/api/ops/padelgod-entry-list` (which is
// entry-list-only) on purpose: the Explorer needs to surface tournaments
// that have only OOP or only results, etc. — e.g. a bracket-only feed
// shouldn't disappear just because no entry list was scraped.
//
// Auth: reads ops_token cookie via `checkOpsAuth`.

import { createClient } from '@supabase/supabase-js'
import { checkOpsAuth } from '@/lib/ops-auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

// ── Types ────────────────────────────────────────────────────────────────

interface TournamentWithSources {
  id: string
  name: string
  starts_at: string | null
  ends_at: string | null
  source: string | null
  level: string | null
  country: string | null
  logo_url: string | null
  // FIP id — when present, this tournament can be seeded from padelfip.com's
  // PDF entry list via /api/ops/seed-fip-entry-list. Null for padelapi-only
  // events, which can't use the FIP PDF fallback (e.g. most Premier Padel
  // tournaments — Brussels P2 is a classic example).
  fip_id: string | null
  // Most-recent captured_at per padelgod source (null = no snapshot yet).
  entryListCapturedAt: string | null
  oopCapturedAt: string | null
  resultsCapturedAt: string | null
  drawCapturedAt: string | null
}

// ── Handler ──────────────────────────────────────────────────────────────

export async function GET() {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  // Window: last 60 days. Padelgod only runs against active tournaments, so
  // anything older is either already archived upstream or not worth showing
  // in the live ops view.
  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()

  // Query each of the four snapshot tables in parallel. All we care about
  // per row is `tournament_id` + `captured_at` — the UI needs to know, per
  // tournament, the most recent capture per source.
  const [entryListRes, oopRes, resultsRes, drawRes] = await Promise.all([
    supabase
      .schema('padelgod')
      .from('entry_list_snapshots')
      .select('tournament_id, captured_at')
      .gte('captured_at', since)
      .order('captured_at', { ascending: false }),
    supabase
      .schema('padelgod')
      .from('oop_snapshots')
      .select('tournament_id, captured_at')
      .gte('captured_at', since)
      .order('captured_at', { ascending: false }),
    supabase
      .schema('padelgod')
      .from('results_snapshots')
      .select('tournament_id, captured_at')
      .gte('captured_at', since)
      .order('captured_at', { ascending: false }),
    supabase
      .schema('padelgod')
      .from('draw_snapshots')
      .select('tournament_id, captured_at')
      .gte('captured_at', since)
      .order('captured_at', { ascending: false }),
  ])

  for (const [label, res] of [
    ['entry_list_snapshots', entryListRes],
    ['oop_snapshots', oopRes],
    ['results_snapshots', resultsRes],
    ['draw_snapshots', drawRes],
  ] as const) {
    if (res.error) {
      return Response.json(
        { error: `${label} read failed: ${res.error.message}` },
        { status: 500 },
      )
    }
  }

  // Reduce each list to latestPerTournament.
  const latestPerSource = (
    rows: Array<{ tournament_id: string; captured_at: string }> | null,
  ) => {
    const m = new Map<string, string>()
    for (const r of rows ?? []) {
      if (!m.has(r.tournament_id)) m.set(r.tournament_id, r.captured_at)
    }
    return m
  }

  const entryListMap = latestPerSource(
    (entryListRes.data ?? []) as Array<{ tournament_id: string; captured_at: string }>,
  )
  const oopMap = latestPerSource(
    (oopRes.data ?? []) as Array<{ tournament_id: string; captured_at: string }>,
  )
  const resultsMap = latestPerSource(
    (resultsRes.data ?? []) as Array<{ tournament_id: string; captured_at: string }>,
  )
  const drawMap = latestPerSource(
    (drawRes.data ?? []) as Array<{ tournament_id: string; captured_at: string }>,
  )

  // Union of tournament IDs that appear in any padelgod snapshot table.
  const tournamentIds = new Set<string>([
    ...entryListMap.keys(),
    ...oopMap.keys(),
    ...resultsMap.keys(),
    ...drawMap.keys(),
  ])

  if (tournamentIds.size === 0) {
    return Response.json({ tournaments: [] as TournamentWithSources[] })
  }

  const { data: tournaments, error: tourErr } = await supabase
    .from('tournaments')
    .select('id, name, starts_at, ends_at, source, level, country, logo_url, fip_id')
    .in('id', [...tournamentIds])
    .order('starts_at', { ascending: false, nullsFirst: false })

  if (tourErr) {
    return Response.json(
      { error: `tournaments read failed: ${tourErr.message}` },
      { status: 500 },
    )
  }

  const enriched: TournamentWithSources[] = (tournaments ?? []).map((t: {
    id: string
    name: string
    starts_at: string | null
    ends_at: string | null
    source: string | null
    level: string | null
    country: string | null
    logo_url: string | null
    fip_id: string | null
  }) => ({
    ...t,
    entryListCapturedAt: entryListMap.get(t.id) ?? null,
    oopCapturedAt: oopMap.get(t.id) ?? null,
    resultsCapturedAt: resultsMap.get(t.id) ?? null,
    drawCapturedAt: drawMap.get(t.id) ?? null,
  }))

  return Response.json({ tournaments: enriched })
}

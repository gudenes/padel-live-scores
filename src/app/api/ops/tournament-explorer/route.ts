// src/app/api/ops/tournament-explorer/route.ts
//
// Tournament-centric ops view. Lists tournaments in a date window, with
// per-padelgod-source freshness flags + match count so the operator can
// audit data quality at a glance.
//
// 2026-04-26 redesign: previously this endpoint only returned tournaments
// that already had a padelgod snapshot in one of the four tables (entry
// list / OOP / results / draw). That made gaps invisible — a tournament
// with zero scraped data simply didn't appear in the list, defeating the
// "where are we missing data?" use case. The new shape returns every
// tournament whose dates overlap the window, regardless of snapshot
// presence, and the UI shows red dots for missing sources.
//
// Query params (all optional):
//   ?level=p1,p2,fip_gold     comma-separated whitelist; default = all
//   ?source=padelapi,fip      comma-separated whitelist; default = all
//   ?from=2026-01-01          inclusive start date; default = 90 days ago
//   ?to=2026-12-31            inclusive end date;   default = 90 days from now
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
  fip_id: string | null
  // Match count from public.matches — not snapshot-derived. Lets the UI
  // surface tournaments that have NO matches yet (zero) versus ones that
  // have matches but no padelgod snapshots (capture gap).
  matchCount: number
  // Most-recent captured_at per padelgod source (null = no snapshot yet).
  entryListCapturedAt: string | null
  oopCapturedAt: string | null
  resultsCapturedAt: string | null
  drawCapturedAt: string | null
}

// ── Helpers ──────────────────────────────────────────────────────────────

function parseCsvParam(raw: string | null): string[] | null {
  if (!raw) return null
  const items = raw.split(',').map(s => s.trim()).filter(Boolean)
  return items.length > 0 ? items : null
}

function parseDateParam(raw: string | null, fallback: Date): string {
  if (!raw) return fallback.toISOString()
  // Accept "YYYY-MM-DD" → start-of-day UTC for `from`, end-of-day for `to`
  // is up to the caller. We let Postgres do native date comparisons by
  // passing the raw string when it looks valid.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  // Anything else: trust the parser, fall back if invalid.
  const d = new Date(raw)
  return Number.isFinite(d.getTime()) ? d.toISOString() : fallback.toISOString()
}

// ── Handler ──────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const url = new URL(request.url)
  const levelFilter = parseCsvParam(url.searchParams.get('level'))
  const sourceFilter = parseCsvParam(url.searchParams.get('source'))
  const NOW = Date.now()
  const DAY = 24 * 60 * 60 * 1000
  const fromDate = parseDateParam(url.searchParams.get('from'), new Date(NOW - 90 * DAY))
  const toDate = parseDateParam(url.searchParams.get('to'), new Date(NOW + 90 * DAY))

  // ── Tournament base query ─────────────────────────────────────────────
  // Match the window if EITHER starts_at falls inside it OR ends_at does.
  // PostgREST `or()` syntax: comma-separated nested predicates.
  let query = supabase
    .from('tournaments')
    .select('id, name, starts_at, ends_at, source, level, country, logo_url, fip_id')
    .or(
      `and(starts_at.gte.${fromDate},starts_at.lte.${toDate}),` +
      `and(ends_at.gte.${fromDate},ends_at.lte.${toDate})`,
    )
    .order('starts_at', { ascending: false, nullsFirst: false })
    .limit(500)

  if (levelFilter) {
    query = query.in('level', levelFilter)
  }
  if (sourceFilter) {
    query = query.in('source', sourceFilter)
  }

  const { data: tournaments, error: tourErr } = await query
  if (tourErr) {
    return Response.json(
      { error: `tournaments read failed: ${tourErr.message}` },
      { status: 500 },
    )
  }

  const ids = (tournaments ?? []).map(t => t.id as string)
  if (ids.length === 0) {
    return Response.json({
      tournaments: [] as TournamentWithSources[],
      filters: { level: levelFilter, source: sourceFilter, from: fromDate, to: toDate },
    })
  }

  // ── Padelgod snapshot freshness — one row per (tournament, source) ───
  // We only need the latest captured_at per tournament_id per table.
  // Pull-everything-then-reduce is fine here: we cap tournaments at 500
  // and snapshots-per-tournament rarely exceeds a few dozen.
  const [entryListRes, oopRes, resultsRes, drawRes] = await Promise.all([
    supabase.schema('padelgod')
      .from('entry_list_snapshots')
      .select('tournament_id, captured_at')
      .in('tournament_id', ids)
      .order('captured_at', { ascending: false }),
    supabase.schema('padelgod')
      .from('oop_snapshots')
      .select('tournament_id, captured_at')
      .in('tournament_id', ids)
      .order('captured_at', { ascending: false }),
    supabase.schema('padelgod')
      .from('results_snapshots')
      .select('tournament_id, captured_at')
      .in('tournament_id', ids)
      .order('captured_at', { ascending: false }),
    supabase.schema('padelgod')
      .from('draw_snapshots')
      .select('tournament_id, captured_at')
      .in('tournament_id', ids)
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

  const latestPerTournament = (
    rows: Array<{ tournament_id: string; captured_at: string }> | null,
  ) => {
    const m = new Map<string, string>()
    for (const r of rows ?? []) {
      if (!m.has(r.tournament_id)) m.set(r.tournament_id, r.captured_at)
    }
    return m
  }

  const entryListMap = latestPerTournament(
    (entryListRes.data ?? []) as Array<{ tournament_id: string; captured_at: string }>,
  )
  const oopMap = latestPerTournament(
    (oopRes.data ?? []) as Array<{ tournament_id: string; captured_at: string }>,
  )
  const resultsMap = latestPerTournament(
    (resultsRes.data ?? []) as Array<{ tournament_id: string; captured_at: string }>,
  )
  const drawMap = latestPerTournament(
    (drawRes.data ?? []) as Array<{ tournament_id: string; captured_at: string }>,
  )

  // ── Match counts — single grouped query against public.matches ───────
  // PostgREST doesn't return GROUP BY directly; we pull (tournament_id) for
  // every match in the window and count client-side. Cheap because matches
  // is indexed on tournament_id.
  const { data: matchRows, error: matchErr } = await supabase
    .from('matches')
    .select('tournament_id')
    .in('tournament_id', ids)

  if (matchErr) {
    return Response.json(
      { error: `matches read failed: ${matchErr.message}` },
      { status: 500 },
    )
  }

  const matchCountByTournament = new Map<string, number>()
  for (const r of (matchRows ?? []) as Array<{ tournament_id: string | null }>) {
    if (!r.tournament_id) continue
    matchCountByTournament.set(
      r.tournament_id,
      (matchCountByTournament.get(r.tournament_id) ?? 0) + 1,
    )
  }

  // ── Stitch ─────────────────────────────────────────────────────────────
  const enriched: TournamentWithSources[] = (tournaments ?? []).map(t => ({
    id: t.id as string,
    name: t.name as string,
    starts_at: (t.starts_at as string | null) ?? null,
    ends_at: (t.ends_at as string | null) ?? null,
    source: (t.source as string | null) ?? null,
    level: (t.level as string | null) ?? null,
    country: (t.country as string | null) ?? null,
    logo_url: (t.logo_url as string | null) ?? null,
    fip_id: (t.fip_id as string | null) ?? null,
    matchCount: matchCountByTournament.get(t.id as string) ?? 0,
    entryListCapturedAt: entryListMap.get(t.id as string) ?? null,
    oopCapturedAt: oopMap.get(t.id as string) ?? null,
    resultsCapturedAt: resultsMap.get(t.id as string) ?? null,
    drawCapturedAt: drawMap.get(t.id as string) ?? null,
  }))

  return Response.json({
    tournaments: enriched,
    filters: { level: levelFilter, source: sourceFilter, from: fromDate, to: toDate },
  })
}

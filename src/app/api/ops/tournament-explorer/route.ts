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
  // Identity
  id: string
  name: string
  source: string | null
  padelapi_id: string | null
  fip_id: string | null
  matchscorer_url: string | null
  // Calendar
  starts_at: string | null
  ends_at: string | null
  timezone: string | null
  // Geography
  country: string | null
  location: string | null
  venue: string | null
  venue_address: string | null
  venue_type: string | null
  n_courts: number | null
  surface: string | null
  // Format
  level: string | null
  prize_money: string | null         // padelapi text format ("$525,000")
  prize_money_fip: number | null     // FIP integer (euros)
  draw_size_md: number | null
  draw_size_qd: number | null
  // Status
  status: string | null
  entry_list_status: string | null
  // Visual
  logo_url: string | null
  // Match count from public.matches — not snapshot-derived. Lets the UI
  // surface tournaments that have NO matches yet (zero) versus ones that
  // have matches but no padelgod snapshots (capture gap).
  matchCount: number
  // True when any match with round='F'/'Final' has a winner_pair set —
  // i.e. the tournament's final is in the books even if `ends_at` hasn't
  // arrived yet. Used by the UI to override `tournament.status='live'`
  // for events that are de-facto finished but not yet reflected in the
  // status column.
  finalPlayed: boolean
  // Per-phase start dates derived from match.scheduled_at, grouped by
  // normalized round name. Lets the UI show "Q1 starts Apr 24, MD R32
  // Apr 26, Final Apr 27" inline without an extra query. Sorted by
  // start date asc — earliest phase first. Empty array when no
  // matches have scheduled_at populated.
  phases: Array<{ round: string; firstStartsAt: string; matchCount: number }>
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
    .select(
      // fip_slug was deprecated in favor of fip_id (per migration
      // 20260407_canonical_source_ids — both columns held the same slug,
      // fip_slug got dropped). Use fip_id alone for URL construction.
      'id, name, source, padelapi_id, fip_id, matchscorer_url, ' +
      'starts_at, ends_at, timezone, ' +
      'country, location, venue, venue_address, venue_type, n_courts, surface, ' +
      'level, prize_money, prize_money_fip, draw_size_md, draw_size_qd, ' +
      'status, entry_list_status, logo_url',
    )
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

  // ── Match counts + finals-played flag — single query, two outputs ────
  // PostgREST doesn't return GROUP BY directly; we pull (tournament_id,
  // round, winner_pair) for every match in the window and aggregate
  // client-side. Cheap because matches is indexed on tournament_id.
  //
  // `finalPlayed` is the operator-facing "tournament is actually done"
  // signal — flipped true when ANY match with round='F'/'Final' has a
  // winner_pair set. Both round-naming conventions are accepted:
  //   - 'F' / 'Final' / 'Men F' / 'Women Final' …
  //   - case-insensitive prefix match keeps it forgiving
  const { data: matchRows, error: matchErr } = await supabase
    .from('matches')
    .select('tournament_id, round, winner_pair, scheduled_at')
    .in('tournament_id', ids)

  if (matchErr) {
    return Response.json(
      { error: `matches read failed: ${matchErr.message}` },
      { status: 500 },
    )
  }

  const matchCountByTournament = new Map<string, number>()
  const finalPlayedByTournament = new Set<string>()
  // tournamentId → (normalizedRound → { earliestStart, count })
  // We collect per-round earliest scheduled_at + match count, then flatten
  // to a sorted array per tournament at stitch time.
  const phasesByTournament = new Map<string, Map<string, { firstStartsAt: string; matchCount: number }>>()

  // Round value is "Final" in F/SF/QF/R16/R32/R64/R128 — but a final match
  // (round starts with "F" + has winner) signals the tournament is done.
  // Reject "F" inside "Final" or "Finals" — the lone-letter "F" code is
  // the only one we treat as final without a longer match. Use a regex.
  // Round naming convention varies by source. The DB has at least:
  //   - "Finals" (FIP / padelapi-stored — plural, surprisingly)
  //   - "Final" (some sources, singular)
  //   - "F"     (FIP scraper short code)
  //   - "Men F" / "Women Final" (category-prefixed in some pipelines)
  // We accept all of them. The category prefix is stripped by taking
  // the last whitespace-delimited token before the regex test.
  const isFinalRound = (round: string | null): boolean => {
    if (!round) return false
    const r = (round.trim().split(/\s+/).pop() ?? '').toLowerCase()
    return r === 'f' || r === 'final' || r === 'finals'
  }

  // Normalize round labels for phase grouping. Strips category prefix
  // ("Men F" → "F", "Women Round of 32" → "Round of 32") and normalizes
  // common short-code variants. Returns null for rounds we don't want
  // to surface (qualifiers we'd rather collapse, anything unrecognized).
  const normalizeRoundForPhase = (round: string | null): string | null => {
    if (!round) return null
    // Strip category prefix if present (Men/Women/M/W/F category words)
    const cleaned = round.trim().replace(/^(men|women|m|w)\s+/i, '')
    if (!cleaned) return null
    return cleaned
  }

  for (const r of (matchRows ?? []) as Array<{
    tournament_id: string | null
    round: string | null
    winner_pair: number | null
    scheduled_at: string | null
  }>) {
    if (!r.tournament_id) continue
    matchCountByTournament.set(
      r.tournament_id,
      (matchCountByTournament.get(r.tournament_id) ?? 0) + 1,
    )
    if (isFinalRound(r.round) && r.winner_pair !== null) {
      finalPlayedByTournament.add(r.tournament_id)
    }

    // Phase aggregation — only consider matches with both round and
    // scheduled_at. Earliest scheduled_at across the round becomes
    // that phase's start.
    const roundKey = normalizeRoundForPhase(r.round)
    if (roundKey && r.scheduled_at) {
      let perTournament = phasesByTournament.get(r.tournament_id)
      if (!perTournament) {
        perTournament = new Map()
        phasesByTournament.set(r.tournament_id, perTournament)
      }
      const existing = perTournament.get(roundKey)
      if (!existing) {
        perTournament.set(roundKey, { firstStartsAt: r.scheduled_at, matchCount: 1 })
      } else {
        if (r.scheduled_at < existing.firstStartsAt) existing.firstStartsAt = r.scheduled_at
        existing.matchCount += 1
      }
    }
  }

  // ── Stitch ─────────────────────────────────────────────────────────────
  // Spread the row first, then layer the derived fields on top. The DB row
  // keys already match the TournamentWithSources shape exactly, so no
  // per-field aliasing is needed — saves us from drift when columns are
  // added in future migrations.
  const enriched: TournamentWithSources[] = (tournaments ?? []).map(t => {
    const row = t as Partial<TournamentWithSources>
    return {
      ...(row as TournamentWithSources),
      matchCount: matchCountByTournament.get(t.id as string) ?? 0,
      finalPlayed: finalPlayedByTournament.has(t.id as string),
      phases: Array.from(phasesByTournament.get(t.id as string)?.entries() ?? [])
        .map(([round, info]) => ({ round, firstStartsAt: info.firstStartsAt, matchCount: info.matchCount }))
        .sort((a, b) => a.firstStartsAt.localeCompare(b.firstStartsAt)),
      entryListCapturedAt: entryListMap.get(t.id as string) ?? null,
      oopCapturedAt: oopMap.get(t.id as string) ?? null,
      resultsCapturedAt: resultsMap.get(t.id as string) ?? null,
      drawCapturedAt: drawMap.get(t.id as string) ?? null,
    }
  })

  return Response.json({
    tournaments: enriched,
    filters: { level: levelFilter, source: sourceFilter, from: fromDate, to: toDate },
  })
}

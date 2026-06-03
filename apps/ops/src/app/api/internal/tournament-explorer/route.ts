// apps/ops/src/app/api/internal/tournament-explorer/route.ts
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
// Auth: NextAuth session, isOperator required.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import { buildPremierBreakdownFromRulebook } from '@/lib/earnings/premier-prize-table'

// ── Types ────────────────────────────────────────────────────────────────

interface TournamentWithSources {
  // Identity
  id: string
  name: string
  name_source: string | null   // 'manual' = operator-locked (see source-priority.ts)
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
  prize_money_eur: number | null              // normalized EUR (PR 1+2)
  prize_money_eur_source: string | null       // 'fip_int' | 'parsed_text' | 'manual'
  // Per-round payout breakdown. Scraped from FIP when available; otherwise
  // synthesized in the response stitch from the Premier rulebook so the
  // ops breakdown card isn't empty for Premier events (FIP rarely
  // publishes a per-round table for them). Carries a `source` key
  // ('rulebook' for synthesized, scraped values omit it / set 'scraped').
  prize_breakdown: Record<string, number | string> | null
  // Per-gender synthesized breakdown for P1/P2 events. Men's and women's
  // Premier P1/P2 rulebook tables diverge substantially (e.g. P1 winner:
  // men €26,270 vs women €17,000), so a single `prize_breakdown` would
  // be misleading. Only populated for synthesized P1/P2 cases; null for
  // Major (men=women), FIP-tier, and scraped breakdowns.
  prize_breakdown_by_category: {
    men: Record<string, number | string> | null
    women: Record<string, number | string> | null
  } | null
  draw_size_md: number | null
  draw_size_qd: number | null
  // Factsheet PDF — when an FIP event publishes a structured factsheet PDF
  // on its event page, /api/cron/process-factsheets ML-extracts the per-day
  // schedule (with start times) and per-round prize_money into
  // factsheet_data via the Claude API. This is a separate pipeline from
  // prize_breakdown (which is HTML-scraped by padelgod's
  // fip-event-page-enricher) — the factsheet is the richer source when it
  // exists, because it carries wall-clock start times that the HTML page
  // doesn't expose. Null on every tournament without a published factsheet.
  factsheet_url: string | null
  factsheet_data: {
    schedule?: Array<{ date?: string; round_label?: string; start_time?: string | null }>
    // Real shape from /api/cron/process-factsheets (Claude extractor):
    // `round_label` is the PDF's own label ("winner", "finalist",
    // "round_16", "q1", …). `per_player_eur` is what each player
    // wins, `total_pair_eur` is actually the total round payout
    // across all teams (despite the name). Either money field can be
    // null when the PDF lists a round but doesn't publish a payout
    // for it (qualifying rounds, typically).
    prize_money?: Array<{
      round_label?: string
      per_player_eur?: number | null
      total_pair_eur?: number | null
    }>
  } | null
  factsheet_processed_at: string | null
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
  phases: Array<{ round: string; category: string | null; firstStartsAt: string; matchCount: number }>
  // Most-recent captured_at per padelgod source (null = no snapshot yet).
  entryListCapturedAt: string | null
  oopCapturedAt: string | null
  resultsCapturedAt: string | null
  drawCapturedAt: string | null
  // Crionet widget linkage. `widgetId` is the matchscorerlive code that
  // gates the entire static-fetcher chain (entry-list, OOP, draws, results)
  // — without it, padelgod can't pull anything for the tournament.
  // `widgetLookupAttempts7d` counts how many times widget-code-lookup has
  // tried to resolve this tournament in the last 7 days, and
  // `widgetLookupLastAttemptAt` is the most recent of those attempts. The
  // RPC has a 12-attempt circuit breaker (see migration
  // 20260427000001_widget_lookup_circuit_breaker.sql), so 12 here means
  // "padelgod has stopped trying — Crionet probably doesn't host it."
  widgetId: string | null
  widgetLookupAttempts7d: number
  widgetLookupLastAttemptAt: string | null
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
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()

  const url = new URL(request.url)
  const levelFilter = parseCsvParam(url.searchParams.get('level'))
  const sourceFilter = parseCsvParam(url.searchParams.get('source'))
  const NOW = Date.now()
  const DAY = 24 * 60 * 60 * 1000
  const fromDate = parseDateParam(url.searchParams.get('from'), new Date(NOW - 90 * DAY))
  const toDate = parseDateParam(url.searchParams.get('to'), new Date(NOW + 90 * DAY))
  // Deep-link escape hatch: when the ⌘K palette (or any caller) wants a
  // specific tournament that may fall outside the date window, it passes
  // ?id=<uuid>. We union that row into the base query so the drill-down
  // always resolves, regardless of the from/to filter.
  const idParam = url.searchParams.get('id')?.trim() || null

  // ── Tournament base query ─────────────────────────────────────────────
  // Match the window if EITHER starts_at falls inside it OR ends_at does.
  // PostgREST `or()` syntax: comma-separated nested predicates.
  let query = supabase
    .from('tournaments')
    .select(
      // fip_slug was deprecated in favor of fip_id (per migration
      // 20260407_canonical_source_ids — both columns held the same slug,
      // fip_slug got dropped). Use fip_id alone for URL construction.
      'id, name, name_source, source, padelapi_id, fip_id, slug, matchscorer_url, ' +
      'starts_at, ends_at, timezone, ' +
      'country, location, venue, venue_address, venue_type, n_courts, surface, ' +
      'level, prize_money, prize_money_fip, prize_money_eur, prize_money_eur_source, prize_breakdown, signup_fee_eur, ' +
      'registration_status, schedule_notes, draw_size_md, draw_size_qd, ' +
      'factsheet_url, factsheet_data, factsheet_processed_at, ' +
      'status, entry_list_status, logo_url',
    )
    .or(
      `and(starts_at.gte.${fromDate},starts_at.lte.${toDate}),` +
      `and(ends_at.gte.${fromDate},ends_at.lte.${toDate})` +
      (idParam ? `,id.eq.${idParam}` : ''),
    )
    .order('starts_at', { ascending: false, nullsFirst: false })
    .limit(500)

  if (levelFilter) {
    query = query.in('level', levelFilter)
  }
  if (sourceFilter) {
    query = query.in('source', sourceFilter)
  }

  const { data, error: tourErr } = await query
  if (tourErr) {
    return Response.json(
      { error: `tournaments read failed: ${tourErr.message}` },
      { status: 500 },
    )
  }

  // PostgREST's inferred type for the destructured `data` includes
  // GenericStringError when the column projection is partial; we already
  // checked `tourErr` above so a runtime row is guaranteed to be a row.
  // Round-trip through unknown to peel off the error variant for TS.
  const tournaments = (data ?? []) as unknown as Array<Record<string, unknown> & { id: string }>

  const ids = tournaments.map(t => t.id)
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
  // Widget-lookup history is scoped to the last 7 days, matching the
  // circuit-breaker window in padelgod_tournaments_needing_widget_code.
  // Old attempts are uninteresting for ops triage — operators only care
  // about "is the worker still trying or has it given up?"
  const widgetLookupSinceISO = new Date(Date.now() - 7 * 86400000).toISOString()

  const [entryListRes, oopRes, resultsRes, drawRes, widgetCacheRes, widgetJobsRes] = await Promise.all([
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
    supabase.schema('padelgod')
      .from('widget_id_cache')
      .select('tournament_id, widget_id, is_active')
      .in('tournament_id', ids)
      .eq('is_active', true),
    supabase.schema('padelgod')
      .from('scrape_jobs')
      .select('tournament_id, started_at')
      .in('tournament_id', ids)
      .eq('job_type', 'widget_id')
      .gte('started_at', widgetLookupSinceISO)
      .order('started_at', { ascending: false }),
  ])

  for (const [label, res] of [
    ['entry_list_snapshots', entryListRes],
    ['oop_snapshots', oopRes],
    ['results_snapshots', resultsRes],
    ['draw_snapshots', drawRes],
    ['widget_id_cache', widgetCacheRes],
    ['scrape_jobs (widget_id)', widgetJobsRes],
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

  // Widget cache → tournament_id → widget_id (only is_active=true rows
  // were selected upstream, so any presence here means "resolved").
  const widgetIdByTournament = new Map<string, string>()
  for (const r of (widgetCacheRes.data ?? []) as Array<{ tournament_id: string; widget_id: string }>) {
    widgetIdByTournament.set(r.tournament_id, r.widget_id)
  }

  // Widget-lookup attempts in the last 7 days. Two derived values per
  // tournament: count + latest started_at. Order on the source query is
  // DESC so the first row we see for a given tournament is the latest.
  const widgetAttemptsByTournament = new Map<string, number>()
  const widgetLatestAttemptByTournament = new Map<string, string>()
  for (const r of (widgetJobsRes.data ?? []) as Array<{ tournament_id: string; started_at: string }>) {
    widgetAttemptsByTournament.set(
      r.tournament_id,
      (widgetAttemptsByTournament.get(r.tournament_id) ?? 0) + 1,
    )
    if (!widgetLatestAttemptByTournament.has(r.tournament_id)) {
      widgetLatestAttemptByTournament.set(r.tournament_id, r.started_at)
    }
  }

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
    .select('tournament_id, round, winner_pair, scheduled_at, category')
    .in('tournament_id', ids)

  if (matchErr) {
    return Response.json(
      { error: `matches read failed: ${matchErr.message}` },
      { status: 500 },
    )
  }

  const matchCountByTournament = new Map<string, number>()
  const finalPlayedByTournament = new Set<string>()
  // tournamentId → ("round|category" key → { earliestStart, count })
  // We collect per-(round, category) earliest scheduled_at + match count,
  // then flatten to a sorted array per tournament at stitch time. Splitting
  // by category lets the UI show "Round of 32 · Men · 16 matches" vs
  // "Round of 32 · Women · 16 matches" separately, which is more useful
  // for operators because the two draws often have different schedules.
  const phasesByTournament = new Map<string, Map<string, { round: string; category: string | null; firstStartsAt: string; matchCount: number }>>()

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
    category: string | null
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
    // scheduled_at. Group key is "round|category" so men's and women's
    // draws don't get conflated. Category may be null on legacy data;
    // we keep those in their own bucket so the UI can decide what to
    // show.
    const roundKey = normalizeRoundForPhase(r.round)
    if (roundKey && r.scheduled_at) {
      const cat = r.category ?? null
      const groupKey = `${roundKey}|${cat ?? '_none'}`
      let perTournament = phasesByTournament.get(r.tournament_id)
      if (!perTournament) {
        perTournament = new Map()
        phasesByTournament.set(r.tournament_id, perTournament)
      }
      const existing = perTournament.get(groupKey)
      if (!existing) {
        perTournament.set(groupKey, {
          round: roundKey,
          category: cat,
          firstStartsAt: r.scheduled_at,
          matchCount: 1,
        })
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
  const enriched: TournamentWithSources[] = tournaments.map(t => {
    const row = t as Partial<TournamentWithSources>
    // Fallback: when FIP hasn't published a per-round breakdown table on
    // the event page (the norm for Premier Majors — 0/7 recent Majors had
    // one), synthesize it from the Premier rulebook. compute-earnings
    // already uses this table directly for Premier, so this just brings
    // the ops "Prize breakdown" card in line with that ground truth. We
    // tag `source: 'rulebook'` so the UI shows provenance. We never write
    // this back to the DB — `dedupe-tournaments` uses `prize_breakdown !=
    // null` as a quality signal, and synthetic data shouldn't tilt that.
    const synth = row.prize_breakdown == null
      ? buildPremierBreakdownFromRulebook(row.level ?? null)
      : null
    const prize_breakdown = (row.prize_breakdown ?? synth) as TournamentWithSources['prize_breakdown']
    // Per-gender split for synthesized P1/P2 only. Men's and women's P1/P2
    // rulebooks diverge enough that surfacing only men's silently (current
    // default) misleads ops staff reading the women's bracket. Major skips
    // this because men=women at that tier; FIP-tier and scraped breakdowns
    // skip because we don't have per-gender data for them.
    const isP1P2 = row.level === 'p1' || row.level === 'p2'
    const prize_breakdown_by_category: TournamentWithSources['prize_breakdown_by_category'] =
      synth && isP1P2
        ? {
            men: buildPremierBreakdownFromRulebook(row.level ?? null, 'men'),
            women: buildPremierBreakdownFromRulebook(row.level ?? null, 'women'),
          }
        : null
    return {
      ...(row as TournamentWithSources),
      prize_breakdown,
      prize_breakdown_by_category,
      matchCount: matchCountByTournament.get(t.id) ?? 0,
      finalPlayed: finalPlayedByTournament.has(t.id),
      phases: Array.from(phasesByTournament.get(t.id)?.values() ?? [])
        .map(p => ({
          round: p.round,
          category: p.category,
          firstStartsAt: p.firstStartsAt,
          matchCount: p.matchCount,
        }))
        // Sort: earliest start first, with category as tiebreaker so
        // (Round of 32 · Men) and (Round of 32 · Women) sit next to
        // each other when they share a start date.
        .sort((a, b) => {
          const cmp = a.firstStartsAt.localeCompare(b.firstStartsAt)
          if (cmp !== 0) return cmp
          return (a.category ?? '').localeCompare(b.category ?? '')
        }),
      entryListCapturedAt: entryListMap.get(t.id) ?? null,
      oopCapturedAt: oopMap.get(t.id) ?? null,
      resultsCapturedAt: resultsMap.get(t.id) ?? null,
      drawCapturedAt: drawMap.get(t.id) ?? null,
      widgetId: widgetIdByTournament.get(t.id) ?? null,
      widgetLookupAttempts7d: widgetAttemptsByTournament.get(t.id) ?? 0,
      widgetLookupLastAttemptAt: widgetLatestAttemptByTournament.get(t.id) ?? null,
    }
  })

  return Response.json({
    tournaments: enriched,
    filters: { level: levelFilter, source: sourceFilter, from: fromDate, to: toDate },
  })
}

// src/app/api/ops/tournament-matches/route.ts
//
// Tournament-scoped match list sourced from padelgod snapshots. Merges:
//
//   - padelgod.oop_snapshots       — what's scheduled/on-court today
//   - padelgod.results_snapshots   — what's been played (with scores)
//
// Results take precedence over OOP for the same `match_widget_id` (because
// a played match has more information than its scheduled placeholder).
// When a match appears in only one source, it's included as-is.
//
// For each row we resolve `match_widget_id` against
//   entity_external_ids (source='crionet_widget', external_id='{tournamentWidgetId}:{matchWidgetId}')
// to surface whether the padelgod-seen match is linked to a canonical row
// in `public.matches`. This is the core question for the migration: how
// many of padelgod's matches are already tracked on our side?
//
// Auth: reads ops_token cookie via `checkOpsAuth`.

import { createClient } from '@supabase/supabase-js'
import { checkOpsAuth } from '@/lib/ops-auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

// ── Types ────────────────────────────────────────────────────────────────

type Category = 'men' | 'women'
type Status = 'scheduled' | 'on_court' | 'live' | 'finished' | 'retired' | 'walkover' | string

interface ExplorerMatch {
  // Identity
  source: 'results' | 'oop' | 'both'
  matchWidgetId: string | null
  // Schedule
  dayNumber: number | null
  court: string | null
  courtPosition: number | null
  scheduledLabel: string | null
  // Classification
  category: Category
  roundLabel: string | null
  // Teams (raw names as captured by padelgod)
  team1Player1Name: string | null
  team1Player2Name: string | null
  team2Player1Name: string | null
  team2Player2Name: string | null
  // Result (if played)
  setScores: unknown | null
  winnerTeam: number | null
  status: Status | null
  // Public DB linkage
  linkedMatchId: string | null
  linkedMatchExternalId: string | null
  // Freshness
  capturedAt: string | null
}

interface Stats {
  total: number
  played: number
  scheduled: number
  linked: number
  unlinked: number
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
  matches: ExplorerMatch[]
  stats: Stats
  capturedAt: {
    oop: string | null
    results: string | null
  }
  /**
   * Map of `day_number` → ISO date string (YYYY-MM-DD) derived from the
   * scheduled_at of linked public.matches. Used by the ops UI to label
   * day pills with their real calendar date rather than inferring from
   * the tournament's starts_at — Crionet's `oopbyday/{id}/{day}` URL
   * numbers qualifier days before the main-draw starts_at, so a naive
   * `starts_at + (day - 1)` offset is off by however many qualifier days
   * precede the main draw (observed: Brussels P2 2026 QF was day 6 but
   * starts_at + 5 days = Apr 25 instead of the real Apr 24).
   *
   * Populated only for days that have at least one LINKED match with a
   * scheduled_at. Unlinked days and days with all-null scheduled_at
   * fall back to the starts_at-offset path on the client.
   */
  dayDates: Record<number, string>
}

// ── Handler ──────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const url = new URL(request.url)
  const tournamentId = url.searchParams.get('tournament_id')
  if (!tournamentId) {
    return Response.json({ error: 'tournament_id is required' }, { status: 400 })
  }

  // Fetch tournament header (nice-to-have for the UI breadcrumb; the
  // explorer list endpoint supplies this too, but re-fetching keeps the
  // detail endpoint self-contained).
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

  // Widget id for building the entity_external_ids lookup key
  // (`{tournamentWidgetId}:{matchWidgetId}`). Without a tournament widget
  // id we can't resolve the composite — we still return padelgod rows, but
  // linkedMatchId will be null for every row.
  const { data: widgetIdRow } = await supabase
    .from('entity_external_ids')
    .select('external_id')
    .eq('entity_type', 'tournament')
    .eq('entity_id', tournamentId)
    .eq('source', 'crionet_widget')
    .maybeSingle()
  const tournamentWidgetId = (widgetIdRow?.external_id as string | undefined) ?? null

  // Fetch OOP and results snapshots in parallel. We want every row — we'll
  // pick the newest scrape_job per (day, court_position) on the client side
  // below so we don't double-count past snapshots.
  const [oopRes, resultsRes] = await Promise.all([
    supabase
      .schema('padelgod')
      .from('oop_snapshots')
      .select(
        'scrape_job_id, tournament_id, day_number, category, round_label, court, court_position, ' +
          'scheduled_label, team1_player1_name, team1_player2_name, team2_player1_name, ' +
          'team2_player2_name, match_widget_id, status, captured_at',
      )
      .eq('tournament_id', tournamentId)
      .order('captured_at', { ascending: false }),
    supabase
      .schema('padelgod')
      .from('results_snapshots')
      .select(
        'scrape_job_id, tournament_id, day_number, category, round_label, court, match_widget_id, ' +
          'team1_player1_name, team1_player2_name, team2_player1_name, team2_player2_name, ' +
          'set_scores, winner_team, status, captured_at',
      )
      .eq('tournament_id', tournamentId)
      .order('captured_at', { ascending: false }),
  ])

  if (oopRes.error) {
    return Response.json(
      { error: `oop_snapshots read failed: ${oopRes.error.message}` },
      { status: 500 },
    )
  }
  if (resultsRes.error) {
    return Response.json(
      { error: `results_snapshots read failed: ${resultsRes.error.message}` },
      { status: 500 },
    )
  }

  type OopRow = {
    scrape_job_id: string
    day_number: number
    category: Category
    round_label: string | null
    court: string | null
    court_position: number | null
    scheduled_label: string | null
    team1_player1_name: string | null
    team1_player2_name: string | null
    team2_player1_name: string | null
    team2_player2_name: string | null
    match_widget_id: string | null
    status: Status | null
    captured_at: string
  }
  type ResultsRow = {
    scrape_job_id: string
    day_number: number
    category: Category
    round_label: string | null
    court: string | null
    match_widget_id: string | null
    team1_player1_name: string | null
    team1_player2_name: string | null
    team2_player1_name: string | null
    team2_player2_name: string | null
    set_scores: unknown | null
    winner_team: number | null
    status: Status | null
    captured_at: string
  }

  const oopRows = (oopRes.data ?? []) as unknown as OopRow[]
  const resultsRows = (resultsRes.data ?? []) as unknown as ResultsRow[]

  // Keep only rows from the LATEST scrape_job per day (per source). Earlier
  // snapshots are dead weight — the newest scrape tells us today's truth.
  const latestOopJobPerDay = new Map<number, string>()
  for (const r of oopRows) {
    if (!latestOopJobPerDay.has(r.day_number)) {
      latestOopJobPerDay.set(r.day_number, r.scrape_job_id)
    }
  }
  const latestOop = oopRows.filter(
    (r) => latestOopJobPerDay.get(r.day_number) === r.scrape_job_id,
  )

  const latestResultsJobPerDay = new Map<number, string>()
  for (const r of resultsRows) {
    if (!latestResultsJobPerDay.has(r.day_number)) {
      latestResultsJobPerDay.set(r.day_number, r.scrape_job_id)
    }
  }
  const latestResults = resultsRows.filter(
    (r) => latestResultsJobPerDay.get(r.day_number) === r.scrape_job_id,
  )

  // Merge by match_widget_id. Results win over OOP (played > scheduled).
  // When a row has no match_widget_id (rare, malformed parse), fall back to
  // a composite key of (day, court, names) to dedup best-effort.
  const keyFor = (
    r:
      | { match_widget_id: string | null; day_number: number; court: string | null; team1_player1_name: string | null; team2_player1_name: string | null }
  ): string =>
    r.match_widget_id
      ? `wid::${r.match_widget_id}`
      : `fb::${r.day_number}::${r.court ?? ''}::${r.team1_player1_name ?? ''}::${r.team2_player1_name ?? ''}`

  const oopByKey = new Map<string, OopRow>()
  for (const r of latestOop) oopByKey.set(keyFor(r), r)
  const resultsByKey = new Map<string, ResultsRow>()
  for (const r of latestResults) resultsByKey.set(keyFor(r), r)

  const allKeys = new Set([...oopByKey.keys(), ...resultsByKey.keys()])

  // Pre-compute the set of match_widget_id → public.matches linkage via
  // entity_external_ids. We only look this up when we have a
  // tournamentWidgetId (otherwise the composite external_id doesn't exist).
  const widgetIdsForLookup: string[] = []
  for (const key of allKeys) {
    const ro = resultsByKey.get(key) ?? oopByKey.get(key)
    if (ro?.match_widget_id) widgetIdsForLookup.push(ro.match_widget_id)
  }

  const linkedMatchByWidgetId = new Map<
    string,
    { id: string; external_id: string | null; scheduled_at: string | null }
  >()
  if (tournamentWidgetId && widgetIdsForLookup.length > 0) {
    const compositeIds = widgetIdsForLookup.map((w) => `${tournamentWidgetId}:${w}`)
    const { data: linkRows, error: linkErr } = await supabase
      .from('entity_external_ids')
      .select('external_id, entity_id')
      .eq('entity_type', 'match')
      .eq('source', 'crionet_widget')
      .in('external_id', compositeIds)

    if (linkErr) {
      return Response.json(
        { error: `entity_external_ids read failed: ${linkErr.message}` },
        { status: 500 },
      )
    }

    const matchIdToWidget = new Map<string, string>()
    for (const row of (linkRows ?? []) as Array<{ external_id: string; entity_id: string }>) {
      // external_id shape: `{tournamentWidgetId}:{matchWidgetId}`
      const idx = row.external_id.indexOf(':')
      const widget = idx >= 0 ? row.external_id.slice(idx + 1) : row.external_id
      matchIdToWidget.set(row.entity_id, widget)
    }

    // Enrich with padelapi_id + scheduled_at from public.matches. padelapi_id
    // lets the UI deep-link (it's the legacy mirror of external_id); scheduled_at
    // lets us derive the REAL calendar date per day_number further below.
    const matchIds = [...matchIdToWidget.keys()]
    if (matchIds.length > 0) {
      const { data: matchRows, error: matchErr } = await supabase
        .from('matches')
        .select('id, external_id, scheduled_at')
        .in('id', matchIds)
      if (matchErr) {
        return Response.json(
          { error: `matches read failed: ${matchErr.message}` },
          { status: 500 },
        )
      }
      for (const m of (matchRows ?? []) as Array<{ id: string; external_id: string | null; scheduled_at: string | null }>) {
        const widget = matchIdToWidget.get(m.id)
        if (widget) {
          linkedMatchByWidgetId.set(widget, {
            id: m.id,
            external_id: m.external_id,
            scheduled_at: m.scheduled_at,
          })
        }
      }
    }
  }

  // Build the merged match list.
  const matches: ExplorerMatch[] = []
  for (const key of allKeys) {
    const res = resultsByKey.get(key)
    const oop = oopByKey.get(key)
    const widget = res?.match_widget_id ?? oop?.match_widget_id ?? null
    const linked = widget ? linkedMatchByWidgetId.get(widget) ?? null : null

    // Prefer results fields where available (played > scheduled).
    matches.push({
      source: res && oop ? 'both' : res ? 'results' : 'oop',
      matchWidgetId: widget,
      dayNumber: res?.day_number ?? oop?.day_number ?? null,
      court: res?.court ?? oop?.court ?? null,
      courtPosition: oop?.court_position ?? null,
      scheduledLabel: oop?.scheduled_label ?? null,
      category: (res?.category ?? oop?.category) as Category,
      roundLabel: res?.round_label ?? oop?.round_label ?? null,
      team1Player1Name: res?.team1_player1_name ?? oop?.team1_player1_name ?? null,
      team1Player2Name: res?.team1_player2_name ?? oop?.team1_player2_name ?? null,
      team2Player1Name: res?.team2_player1_name ?? oop?.team2_player1_name ?? null,
      team2Player2Name: res?.team2_player2_name ?? oop?.team2_player2_name ?? null,
      setScores: res?.set_scores ?? null,
      winnerTeam: res?.winner_team ?? null,
      status: res?.status ?? oop?.status ?? null,
      linkedMatchId: linked?.id ?? null,
      linkedMatchExternalId: linked?.external_id ?? null,
      capturedAt: res?.captured_at ?? oop?.captured_at ?? null,
    })
  }

  // Stable sort: day → court_position → court name.
  matches.sort((a, b) => {
    const da = a.dayNumber ?? Number.MAX_SAFE_INTEGER
    const db = b.dayNumber ?? Number.MAX_SAFE_INTEGER
    if (da !== db) return da - db
    const ca = a.courtPosition ?? Number.MAX_SAFE_INTEGER
    const cb = b.courtPosition ?? Number.MAX_SAFE_INTEGER
    if (ca !== cb) return ca - cb
    return (a.court ?? '').localeCompare(b.court ?? '')
  })

  const stats: Stats = {
    total: matches.length,
    played: matches.filter((m) => m.source === 'results' || m.source === 'both').length,
    scheduled: matches.filter((m) => m.source === 'oop').length,
    linked: matches.filter((m) => m.linkedMatchId !== null).length,
    unlinked: matches.filter((m) => m.linkedMatchId === null).length,
  }

  const capturedAt = {
    oop: latestOop.length > 0 ? latestOop[0]!.captured_at : null,
    results: latestResults.length > 0 ? latestResults[0]!.captured_at : null,
  }

  // Build day_number → calendar date map from linked matches' scheduled_at.
  // See the DetailResponse.dayDates doc for why we can't infer from starts_at.
  // Picks the MIN scheduled_at per day_number so ambiguous cases (two linked
  // matches under the same day_number with slightly different dates — shouldn't
  // happen but defensive) converge deterministically. Date-only substring
  // (the first 10 chars) drops the time + timezone, giving us YYYY-MM-DD.
  const dayDates: Record<number, string> = {}
  for (const m of matches) {
    if (m.dayNumber == null) continue
    if (!m.matchWidgetId) continue
    const link = linkedMatchByWidgetId.get(m.matchWidgetId)
    if (!link?.scheduled_at) continue
    const datePart = link.scheduled_at.slice(0, 10)
    const existing = dayDates[m.dayNumber]
    if (!existing || datePart < existing) {
      dayDates[m.dayNumber] = datePart
    }
  }

  const response: DetailResponse = {
    tournament,
    matches,
    stats,
    capturedAt,
    dayDates,
  }

  return Response.json(response)
}

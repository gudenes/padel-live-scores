// apps/ops/src/app/api/internal/tournament-matches/route.ts
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
// Auth: NextAuth session, isOperator required.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

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
  /**
   * The simplified-pipeline marker. NULL when the linked
   * `public.matches` row was created by the legacy static-reconciler
   * (synthetic widget id stored only in `entity_external_ids`); set
   * to `{tournamentWidget}:{matchWidget}` when fip-draw-populator
   * created the row using the canonical composite key. Drives the
   * NEW vs LEGACY badge in the ops dashboard during the migration
   * soak phase. Always null when `linkedMatchId` is null.
   */
  linkedComposite: string | null
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
  /**
   * Crionet tournament widget code (e.g. "FIP-2026-1701") — the
   * `entity_external_ids(source='crionet_widget', entity_type='tournament')`
   * row's external_id. Null when no such row exists.
   *
   * Surfaced so the Tournament Explorer's Matches subtab can embed the
   * Schedule Review Apply panel without an extra lookup round-trip.
   * When null, the embedded panel is hidden because the schedule-review
   * API keys on this code to match OOP entries back to public.matches.
   */
  matchscorerCode: string | null
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

  // Widget id for building the composite key
  // (`{tournamentWidgetId}:{matchWidgetId}`). Without it we can't
  // resolve the composite — we still return padelgod rows, but
  // linkedMatchId will be null for every row.
  //
  // Two sources, in priority order:
  //   1. entity_external_ids (legacy reconciler path) — populated by
  //      the old static-reconciler when it stamped widget IDs.
  //   2. padelgod.widget_id_cache — canonical source for the new
  //      pipeline. Populated by widget-code-lookup; the new
  //      tournament-discovery + fip-draw-populator workers read from
  //      it. This is where B3 Singapore-style amateur-tier tournaments
  //      live, since they were discovered after the reconciler retired
  //      and never got an entity_external_ids row stamped.
  //
  // Falling back from #1 to #2 means any tournament with a widget known
  // to padelgod gets its OOP rows linked, regardless of which writer
  // discovered it.
  const { data: legacyWidgetRow } = await supabase
    .from('entity_external_ids')
    .select('external_id')
    .eq('entity_type', 'tournament')
    .eq('entity_id', tournamentId)
    .eq('source', 'crionet_widget')
    .maybeSingle()
  let tournamentWidgetId =
    (legacyWidgetRow?.external_id as string | undefined) ?? null

  if (!tournamentWidgetId) {
    const { data: cacheRow } = await supabase
      .schema('padelgod')
      .from('widget_id_cache')
      .select('widget_id')
      .eq('tournament_id', tournamentId)
      .eq('is_active', true)
      .maybeSingle()
    tournamentWidgetId =
      (cacheRow?.widget_id as string | undefined) ?? null
  }

  // Fetch OOP and results snapshots in parallel. We want every row — we'll
  // pick the newest scrape_job per (day, court_position) on the client side
  // below so we don't double-count past snapshots.
  const [oopRes, resultsRes] = await Promise.all([
    supabase
      .schema('padelgod')
      .from('oop_snapshots')
      .select(
        'scrape_job_id, tournament_id, day_number, day_date, category, round_label, court, court_position, ' +
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
    /** Calendar date parsed from the Crionet day-pill (YYYY-MM-DD).
     *  Authoritative source for "Day N → date" — supersedes the
     *  starts_at offset fallback. NULL on rows captured before the
     *  day_date column was introduced (2026-04-29 migration); UI falls
     *  back to other dayDates paths in that case. */
    day_date: string | null
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
    {
      id: string
      external_id: string | null
      scheduled_at: string | null
      // The simplified-pipeline marker. NULL when the row was created
      // by the legacy static-reconciler (synthetic widget id stored in
      // entity_external_ids only); set when fip-draw-populator wrote
      // the row using the canonical composite key. Used by the ops
      // dashboard to show NEW vs LEGACY badges per match during the
      // migration soak phase.
      widget_id_composite: string | null
    }
  >()
  if (tournamentWidgetId && widgetIdsForLookup.length > 0) {
    const compositeIds = widgetIdsForLookup.map((w) => `${tournamentWidgetId}:${w}`)

    // Path A — simplified pipeline. Match rows created by
    // fip-draw-populator have `widget_id_composite` set directly on
    // public.matches. Single round-trip, no sidecar table.
    const { data: directRows, error: directErr } = await supabase
      .from('matches')
      .select('id, external_id, scheduled_at, widget_id_composite')
      .in('widget_id_composite', compositeIds)
    if (directErr) {
      return Response.json(
        { error: `matches direct lookup failed: ${directErr.message}` },
        { status: 500 },
      )
    }
    for (const m of (directRows ?? []) as Array<{
      id: string
      external_id: string | null
      scheduled_at: string | null
      widget_id_composite: string | null
    }>) {
      if (!m.widget_id_composite) continue
      const idx = m.widget_id_composite.indexOf(':')
      const widget =
        idx >= 0 ? m.widget_id_composite.slice(idx + 1) : m.widget_id_composite
      linkedMatchByWidgetId.set(widget, {
        id: m.id,
        external_id: m.external_id,
        scheduled_at: m.scheduled_at,
        widget_id_composite: m.widget_id_composite,
      })
    }

    // Path B — legacy reconciler. Rows reach public.matches via the
    // entity_external_ids sidecar (synthetic composite stored only in
    // the sidecar, NOT on public.matches.widget_id_composite). For
    // widgets we already resolved via Path A, the new pipeline wins
    // — we don't overwrite. For everything else, this is the only
    // way to find the link until PR 8 retires the reconciler.
    const unresolvedComposites = compositeIds.filter((c) => {
      const idx = c.indexOf(':')
      const widget = idx >= 0 ? c.slice(idx + 1) : c
      return !linkedMatchByWidgetId.has(widget)
    })

    if (unresolvedComposites.length > 0) {
      const { data: linkRows, error: linkErr } = await supabase
        .from('entity_external_ids')
        .select('external_id, entity_id')
        .eq('entity_type', 'match')
        .eq('source', 'crionet_widget')
        .in('external_id', unresolvedComposites)

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
      // lets the UI deep-link (it's the legacy mirror of external_id);
      // scheduled_at lets us derive the REAL calendar date per day_number
      // further below. widget_id_composite is read but expected to be NULL on
      // these rows (legacy reconciler doesn't write it) — that's the very
      // signal the UI uses to render the LEGACY badge.
      const matchIds = [...matchIdToWidget.keys()]
      if (matchIds.length > 0) {
        const { data: matchRows, error: matchErr } = await supabase
          .from('matches')
          .select('id, external_id, scheduled_at, widget_id_composite')
          .in('id', matchIds)
        if (matchErr) {
          return Response.json(
            { error: `matches read failed: ${matchErr.message}` },
            { status: 500 },
          )
        }
        for (const m of (matchRows ?? []) as Array<{
          id: string
          external_id: string | null
          scheduled_at: string | null
          widget_id_composite: string | null
        }>) {
          const widget = matchIdToWidget.get(m.id)
          if (widget) {
            linkedMatchByWidgetId.set(widget, {
              id: m.id,
              external_id: m.external_id,
              scheduled_at: m.scheduled_at,
              widget_id_composite: m.widget_id_composite,
            })
          }
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
      linkedComposite: linked?.widget_id_composite ?? null,
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

  // Build day_number → calendar date map. See DetailResponse.dayDates docs
  // for the broader rationale. Three paths, tried in order:
  //
  // 0. OOP day-pill path — `oop_snapshots.day_date`, written from the
  //    Crionet widget's day-selector strip ("APR 29" → 2026-04-29).
  //    Authoritative when present: it's literally what the widget itself
  //    renders. Independent of `tournaments.starts_at`, so it survives
  //    drift in that field (FIP edits the page mid-tournament, padelapi
  //    differs, ops manual nudges a duplicate row, …). Populated by
  //    padelgod's oop-fetcher starting 2026-04-29; older snapshot rows
  //    have day_date=NULL and fall through to the next paths.
  //
  // 1. Linked path — match has a crionet_widget mapping → public.matches
  //    row → scheduled_at. Cheap and exact. But linking relies on the
  //    tournament having an entity_external_ids row of source='crionet_widget'
  //    (set by padelgod's match-identifier), and for some tournaments that
  //    hasn't happened (e.g. Premier tournaments whose only sidecar entry is
  //    source='premierpadel'). In those cases linkedMatchByWidgetId is empty
  //    and path 1 contributes nothing.
  //
  // 2. Round-label path — for each day, collect the round_labels that appear
  //    in its OOP/results snapshots, then look up public.matches by
  //    (tournament, round) to get scheduled_at. Assigned greedily in
  //    day_number order so a round that spans two days (e.g. R32 on day 3
  //    AND day 4 of a Brussels-size draw) gets distinct calendar dates.
  //    Qualifier-only days (Q1/Q2/Q3 have no corresponding public.matches
  //    rows in our DB) stay empty and fall back to starts_at offset on the
  //    client.
  const dayDates: Record<number, string> = {}

  // Path 0: OOP day-pill date. Iterate latestOop (already deduped to the
  // most recent scrape job per day) — every row in a given day's batch
  // carries the same day_date, but reading from any one is enough.
  for (const r of latestOop) {
    if (!r.day_date) continue
    if (dayDates[r.day_number]) continue
    dayDates[r.day_number] = r.day_date
  }

  // Path 1: direct from linked matches.
  for (const m of matches) {
    if (m.dayNumber == null) continue
    if (!m.matchWidgetId) continue
    if (dayDates[m.dayNumber]) continue // path 0 already resolved this day
    const link = linkedMatchByWidgetId.get(m.matchWidgetId)
    if (!link?.scheduled_at) continue
    const datePart = link.scheduled_at.slice(0, 10)
    const existing = dayDates[m.dayNumber]
    if (!existing || datePart < existing) {
      dayDates[m.dayNumber] = datePart
    }
  }

  // Path 2: round-label fallback for days we couldn't resolve via linking.
  // Only bother querying public.matches when there's at least one gap.
  const dayToRounds = new Map<number, Set<string>>()
  for (const m of matches) {
    if (m.dayNumber == null) continue
    if (!m.roundLabel) continue
    if (dayDates[m.dayNumber]) continue // already resolved via path 1
    const set = dayToRounds.get(m.dayNumber) ?? new Set<string>()
    set.add(m.roundLabel)
    dayToRounds.set(m.dayNumber, set)
  }

  if (dayToRounds.size > 0) {
    // OOP and public.matches sometimes spell the same round differently
    // — e.g. OOP says "Quarterfinals" while public says "Quarter". Canonicalize
    // to a single lowercase key so the lookup doesn't miss. Add aliases here
    // if more variants show up (observed 2026-04-24 for Brussels P2; SF / F
    // happen to match exactly between both sources).
    const canonicalRound = (r: string): string => {
      const s = r.toLowerCase().trim()
      if (s === 'quarterfinals' || s === 'quarter' || s === 'quarterfinal') return 'quarter'
      if (s === 'semifinals' || s === 'semi' || s === 'semifinal') return 'semi'
      if (s === 'finals' || s === 'final') return 'final'
      return s
    }

    const allRounds = [...new Set([...dayToRounds.values()].flatMap((s) => [...s]))]
    // Query a superset: the raw OOP strings AND their canonical aliases that
    // public.matches might use. Gets "Quarter" into the result set when OOP
    // only said "Quarterfinals".
    const canonicalToRaw = new Map<string, string[]>() // canonical → public-side variants
    const queryRounds = new Set<string>(allRounds)
    for (const r of allRounds) {
      const canon = canonicalRound(r)
      if (!canonicalToRaw.has(canon)) canonicalToRaw.set(canon, [])
      canonicalToRaw.get(canon)!.push(r)
      // Add known public-side spellings for this canonical key.
      if (canon === 'quarter') { queryRounds.add('Quarter'); queryRounds.add('Quarterfinals') }
      if (canon === 'semi') { queryRounds.add('Semi'); queryRounds.add('Semifinals') }
      if (canon === 'final') { queryRounds.add('Final'); queryRounds.add('Finals') }
    }

    const { data: publicMatches } = await supabase
      .from('matches')
      .select('round, scheduled_at')
      .eq('tournament_id', tournamentId)
      .in('round', [...queryRounds])
      .not('scheduled_at', 'is', null)

    // canonical round → sorted-ASC distinct calendar dates. Merges variants
    // so "Quarter" rows and "Quarterfinals" rows land in the same bucket.
    const datesByCanonical = new Map<string, string[]>()
    for (const r of (publicMatches ?? []) as Array<{ round: string; scheduled_at: string }>) {
      const canon = canonicalRound(r.round)
      const date = r.scheduled_at.slice(0, 10)
      const arr = datesByCanonical.get(canon) ?? []
      if (!arr.includes(date)) arr.push(date)
      datesByCanonical.set(canon, arr)
    }
    for (const arr of datesByCanonical.values()) arr.sort()

    // Greedy walk: for each day_number (ascending), pick the earliest date
    // across its rounds that hasn't already been claimed by an earlier day.
    // This handles rounds that span multiple days — R32 on day 3 gets
    // Apr 21, R32 on day 4 gets Apr 22.
    const claimedDates = new Set(Object.values(dayDates))
    const sortedDays = [...dayToRounds.keys()].sort((a, b) => a - b)
    for (const day of sortedDays) {
      const rounds = dayToRounds.get(day)!
      const candidates: string[] = []
      for (const round of rounds) {
        const dates = datesByCanonical.get(canonicalRound(round)) ?? []
        for (const d of dates) {
          if (!claimedDates.has(d)) candidates.push(d)
        }
      }
      if (candidates.length === 0) continue
      candidates.sort()
      dayDates[day] = candidates[0]!
      claimedDates.add(candidates[0]!)
    }
  }

  const response: DetailResponse = {
    tournament,
    matches,
    stats,
    capturedAt,
    dayDates,
    // Expose the Crionet tournament widget code (e.g. "FIP-2026-1701") so
    // the embedded Schedule Review panel in TournamentMatchesSubtab can
    // call /api/internal/schedule-review without a separate lookup. Null when
    // no entity_external_ids row exists for this tournament — in that
    // case the Apply-changes panel is hidden client-side.
    matchscorerCode: tournamentWidgetId,
  }

  return Response.json(response)
}

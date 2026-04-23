import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import { createHash } from 'node:crypto';
import { parseCrionetOop } from '../parsers/crionet-oop.js';
import { runScrapeJob } from '../lib/scrape-job.js';
import { CRIONET_OOP_VERSION } from '../lib/parser-versions.js';

export interface OopFetcherDeps {
  supabase: SupabaseClient;
  httpClient: AxiosInstance;
}

export interface OopFetcherResult {
  tournamentsProcessed: number;
  totalMatchesInserted: number;
}

interface ActiveTournament {
  tournament_id: string;
  widget_id: string;
  expected_days: number;
}

const URL_FOR = (code: string, day: number) =>
  `https://widget.matchscorerlive.com/screen/oopbyday/${code}/${day}?t=tol`;

async function getLatestScrapeJobId(
  supabase: SupabaseClient,
  tournamentId: string,
  targetUrl: string
): Promise<string | null> {
  const { data } = await supabase
    .schema('padelgod')
    .from('scrape_jobs')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('target_url', targetUrl)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

async function fetchOneDay(
  deps: OopFetcherDeps,
  t: ActiveTournament,
  day: number
): Promise<number> {
  const targetUrl = URL_FOR(t.widget_id, day);
  let parsed: ReturnType<typeof parseCrionetOop> = [];

  await runScrapeJob(
    deps.supabase,
    {
      jobType: 'oop',
      tournamentId: t.tournament_id,
      targetUrl,
      parserVersion: CRIONET_OOP_VERSION,
      captureBody: true,
    },
    async () => {
      const response = await deps.httpClient.get(targetUrl);
      const body = String(response.data);
      const contentHash = `sha256:${createHash('sha256').update(body).digest('hex')}`;
      parsed = parseCrionetOop(body, day);
      return { body, contentHash };
    }
  );

  if (parsed.length === 0) return 0;

  const scrapeJobId = await getLatestScrapeJobId(deps.supabase, t.tournament_id, targetUrl);
  if (!scrapeJobId) return 0;

  const rows = parsed.map((m) => ({
    scrape_job_id: scrapeJobId,
    tournament_id: t.tournament_id,
    day_number: m.dayNumber,
    category: m.category,
    round_label: m.roundLabel,
    court: m.court,
    court_position: m.courtPosition,
    scheduled_label: m.scheduledLabel,
    team1_player1_name: m.team1Player1Name,
    team1_player2_name: m.team1Player2Name,
    team2_player1_name: m.team2Player1Name,
    team2_player2_name: m.team2Player2Name,
    match_widget_id: m.matchWidgetId,
    status: m.status,
  }));

  const { error } = await deps.supabase
    .schema('padelgod')
    .from('oop_snapshots')
    .insert(rows);

  if (error) throw new Error(`oop_snapshots insert failed: ${error.message}`);

  // Upsert distinct courts into public.tournament_courts. Lets fan-visible
  // UIs (match lists on /matches, /home, /matches/[date]) sort matches in
  // the same left-to-right court order as the official OOP page. Skipped
  // for matches with courtDisplayOrder === -1 (legacy fallback path — no
  // column wrapper in the HTML, can't know order). See the table's
  // comment in supabase/migrations/20260423000005_tournament_courts.sql
  // for the full rationale.
  await upsertTournamentCourts(deps.supabase, t.tournament_id, parsed);

  return rows.length;
}

async function upsertTournamentCourts(
  supabase: SupabaseClient,
  tournamentId: string,
  parsed: ReturnType<typeof parseCrionetOop>,
): Promise<void> {
  // Deduplicate by court name — in a single OOP page, every match on the
  // same court shares the same courtDisplayOrder. We only want one row per
  // (tournament_id, court) in tournament_courts.
  const byCourt = new Map<string, number>();
  for (const m of parsed) {
    if (m.courtDisplayOrder < 0) continue; // legacy fallback — skip
    if (!m.court) continue;
    if (!byCourt.has(m.court)) {
      byCourt.set(m.court, m.courtDisplayOrder);
    }
  }
  if (byCourt.size === 0) return;

  const nowIso = new Date().toISOString();
  const rows = Array.from(byCourt.entries()).map(([court_name, display_order]) => ({
    tournament_id: tournamentId,
    court_name,
    display_order,
    updated_at: nowIso,
  }));

  // Upsert with onConflict on the composite PK — each day's OOP parse
  // overwrites the previous value. If court order shifts mid-tournament
  // (rare, but e.g. a final gets moved to Show Court), we converge to the
  // latest day's order, which is what the user sees on the official page.
  const { error } = await supabase
    .from('tournament_courts')
    .upsert(rows, { onConflict: 'tournament_id,court_name' });

  if (error) {
    // Non-fatal: oop_snapshots insert already succeeded and that's the
    // authoritative data. Log the failure but don't throw — next run retries.
    console.warn(
      `[oop-fetcher] tournament_courts upsert failed for ${tournamentId}:`,
      error.message,
    );
  }
}

export async function runOopFetcher(deps: OopFetcherDeps): Promise<OopFetcherResult> {
  const { data: tournaments, error } = await deps.supabase.rpc(
    'padelgod_active_tournaments_for_static_workers'
  );
  if (error) throw new Error(`Active tournaments RPC failed: ${error.message}`);
  const list = (tournaments ?? []) as ActiveTournament[];

  let totalMatchesInserted = 0;
  for (const t of list) {
    // Iterate ALL expected days. The previous "bail after 2 consecutive
    // empty" optimisation broke qualifier coverage: past days often return
    // zero rows from the widget, so a tournament on day 3 would bail after
    // days 1 and 2 and never reach today's live day. Cost of iterating the
    // full range is bounded (~7 HTTP calls/tournament/hour).
    const maxDay = Math.max(t.expected_days ?? 7, 7);
    for (let day = 1; day <= maxDay; day++) {
      const inserted = await fetchOneDay(deps, t, day);
      totalMatchesInserted += inserted;
    }
  }

  return {
    tournamentsProcessed: list.length,
    totalMatchesInserted,
  };
}

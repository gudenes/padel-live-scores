import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import { createHash } from 'node:crypto';
import { parseCrionetResults } from '../parsers/crionet-results.js';
import { runScrapeJob } from '../lib/scrape-job.js';
import { CRIONET_RESULTS_VERSION } from '../lib/parser-versions.js';

export interface ResultsFetcherDeps {
  supabase: SupabaseClient;
  httpClient: AxiosInstance;
  /** When set, only tournaments whose UUID is in the allowlist are
   *  processed. Used by the on-demand refresh endpoint. */
  onlyTournamentIds?: Set<string>;
}

export interface ResultsFetcherResult {
  tournamentsProcessed: number;
  totalMatchesInserted: number;
}

interface ActiveTournament {
  tournament_id: string;
  widget_id: string;
  expected_days: number;
}

const URL_FOR = (code: string, day: number) =>
  `https://widget.matchscorerlive.com/screen/resultsbyday/${code}/${day}?t=tol`;

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
  deps: ResultsFetcherDeps,
  t: ActiveTournament,
  day: number
): Promise<number> {
  const targetUrl = URL_FOR(t.widget_id, day);
  let parsed: ReturnType<typeof parseCrionetResults> = [];

  await runScrapeJob(
    deps.supabase,
    {
      jobType: 'oop',  // re-use OOP type for now
      tournamentId: t.tournament_id,
      targetUrl,
      parserVersion: CRIONET_RESULTS_VERSION,
      captureBody: true,
    },
    async () => {
      const response = await deps.httpClient.get(targetUrl);
      const body = String(response.data);
      const contentHash = `sha256:${createHash('sha256').update(body).digest('hex')}`;
      parsed = parseCrionetResults(body, day);
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
    match_widget_id: m.matchWidgetId,
    team1_player1_name: m.team1Player1Name,
    team1_player2_name: m.team1Player2Name,
    team2_player1_name: m.team2Player1Name,
    team2_player2_name: m.team2Player2Name,
    set_scores: m.setScores,
    winner_team: m.winnerTeam,
    status: m.status,
  }));

  const { error } = await deps.supabase
    .schema('padelgod')
    .from('results_snapshots')
    .insert(rows);

  if (error) throw new Error(`results_snapshots insert failed: ${error.message}`);
  return rows.length;
}

export async function runResultsFetcher(deps: ResultsFetcherDeps): Promise<ResultsFetcherResult> {
  const { data: tournaments, error } = await deps.supabase.rpc(
    'padelgod_active_tournaments_for_static_workers'
  );
  if (error) throw new Error(`Active tournaments RPC failed: ${error.message}`);
  const allList = (tournaments ?? []) as ActiveTournament[];
  const list = deps.onlyTournamentIds && deps.onlyTournamentIds.size > 0
    ? allList.filter((t) => deps.onlyTournamentIds!.has(t.tournament_id))
    : allList;

  let totalMatchesInserted = 0;
  for (const t of list) {
    // Iterate ALL expected days. The previous "bail after 2 consecutive
    // empty" optimisation broke qualifier / mid-tournament coverage: past
    // days often return zero rows from the widget, so a tournament on day 3
    // would bail after days 1 and 2 and never reach today's day. Mirrors
    // the same fix applied to oop-fetcher.
    //
    // Floor bumped to 8 (2026-04-25): Premier P2 events have 8 days on
    // Crionet (pre-quals + 7-day main schedule). The RPC's
    // (ends_at - starts_at) + 1 calc gives 7 because our stored starts_at
    // doesn't include the pre-qual day Crionet calls Day 1. Brussels P2
    // 2026's Final (day 8) wasn't being fetched until we bumped this. See
    // oop-fetcher.ts for the full context — same change there.
    const maxDay = Math.max(t.expected_days ?? 8, 8);
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

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
  return rows.length;
}

export async function runOopFetcher(deps: OopFetcherDeps): Promise<OopFetcherResult> {
  const { data: tournaments, error } = await deps.supabase.rpc(
    'padelgod_active_tournaments_for_static_workers'
  );
  if (error) throw new Error(`Active tournaments RPC failed: ${error.message}`);
  const list = (tournaments ?? []) as ActiveTournament[];

  let totalMatchesInserted = 0;
  for (const t of list) {
    let consecutiveEmpty = 0;
    const maxDay = Math.max(t.expected_days ?? 7, 7);
    for (let day = 1; day <= maxDay; day++) {
      const inserted = await fetchOneDay(deps, t, day);
      totalMatchesInserted += inserted;
      if (inserted === 0) {
        consecutiveEmpty++;
        if (consecutiveEmpty >= 2) break;
      } else {
        consecutiveEmpty = 0;
      }
    }
  }

  return {
    tournamentsProcessed: list.length,
    totalMatchesInserted,
  };
}

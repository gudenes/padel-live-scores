import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import { createHash } from 'node:crypto';
import { parseCrionetEntryList, type Category } from '../parsers/crionet-entry-list.js';
import { runScrapeJob } from '../lib/scrape-job.js';
import { CRIONET_ENTRY_LIST_VERSION } from '../lib/parser-versions.js';

export interface EntryListFetcherDeps {
  supabase: SupabaseClient;
  httpClient: AxiosInstance;
}

export interface EntryListFetcherResult {
  tournamentsProcessed: number;
  totalPlayersInserted: number;
}

interface ActiveTournament {
  tournament_id: string;
  tournament_name: string;
  widget_id: string;
  starts_at: string | null;
  ends_at: string | null;
  expected_days: number;
}

const URL_FOR = (code: string, gender: 'ms' | 'ws') =>
  `https://widget.matchscorerlive.com/screen/entrylist/${code}/${gender}?t=tol`;

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

async function fetchAndStore(
  deps: EntryListFetcherDeps,
  t: ActiveTournament,
  category: Category
): Promise<number> {
  const code = t.widget_id;
  const targetUrl = URL_FOR(code, category === 'men' ? 'ms' : 'ws');
  let parsed: ReturnType<typeof parseCrionetEntryList> = [];

  await runScrapeJob(
    deps.supabase,
    {
      jobType: 'discover',  // entry list reuses discover type for now
      tournamentId: t.tournament_id,
      targetUrl,
      parserVersion: CRIONET_ENTRY_LIST_VERSION,
      captureBody: true,
    },
    async () => {
      const response = await deps.httpClient.get(targetUrl);
      const body = String(response.data);
      const contentHash = `sha256:${createHash('sha256').update(body).digest('hex')}`;
      parsed = parseCrionetEntryList(body, category);
      return { body, contentHash };
    }
  );

  if (parsed.length === 0) return 0;

  const scrapeJobId = await getLatestScrapeJobId(deps.supabase, t.tournament_id, targetUrl);
  if (!scrapeJobId) return 0;

  const rows = parsed.map((p) => ({
    scrape_job_id: scrapeJobId,
    tournament_id: t.tournament_id,
    category,
    fip_id: p.fipId,
    name: p.name,
    country: p.country,
    seed: p.seed,
    partner_fip_id: p.partnerFipId,
    partner_name: p.partnerName,
  }));

  const { error } = await deps.supabase
    .schema('padelgod')
    .from('entry_list_snapshots')
    .insert(rows);

  if (error) throw new Error(`entry_list_snapshots insert failed: ${error.message}`);
  return rows.length;
}

export async function runEntryListFetcher(
  deps: EntryListFetcherDeps
): Promise<EntryListFetcherResult> {
  const { data: tournaments, error } = await deps.supabase.rpc(
    'padelgod_active_tournaments_for_static_workers'
  );
  if (error) throw new Error(`Active tournaments RPC failed: ${error.message}`);
  const list = (tournaments ?? []) as ActiveTournament[];

  let totalPlayersInserted = 0;
  for (const t of list) {
    const menCount = await fetchAndStore(deps, t, 'men');
    const womenCount = await fetchAndStore(deps, t, 'women');
    totalPlayersInserted += menCount + womenCount;
  }

  return {
    tournamentsProcessed: list.length,
    totalPlayersInserted,
  };
}

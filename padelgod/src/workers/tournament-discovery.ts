import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import { createHash } from 'node:crypto';
import { parseFipWpEvents } from '../parsers/fip-wp-events.js';
import { runScrapeJob } from '../lib/scrape-job.js';
import { FIP_WP_EVENTS_VERSION } from '../lib/parser-versions.js';

export interface TournamentDiscoveryDeps {
  supabase: SupabaseClient;
  httpClient: AxiosInstance;
}

export interface TournamentDiscoveryResult {
  discovered: number;
  scrapeJobId: string;
}

const WP_API_BASE = 'https://www.padelfip.com/wp-json/wp/v2/events';

export async function runTournamentDiscovery(
  deps: TournamentDiscoveryDeps
): Promise<TournamentDiscoveryResult> {
  // 1. Look up max updated_at across tournaments (incremental sync key)
  const { data: latest } = await deps.supabase
    .from('tournaments')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const params = new URLSearchParams({ per_page: '100', orderby: 'modified', order: 'asc' });
  if (latest?.updated_at) {
    params.set('modified_after', latest.updated_at);
  }
  const targetUrl = `${WP_API_BASE}?${params.toString()}`;

  // 2. Scrape (with job tracking)
  let parsed: ReturnType<typeof parseFipWpEvents> = [];
  const jobResult = await runScrapeJob(
    deps.supabase,
    {
      jobType: 'discover',
      tournamentId: null,
      targetUrl,
      parserVersion: FIP_WP_EVENTS_VERSION,
      captureBody: false,
    },
    async () => {
      const response = await deps.httpClient.get(targetUrl);
      const body = JSON.stringify(response.data);
      const contentHash = `sha256:${createHash('sha256').update(body).digest('hex')}`;
      parsed = parseFipWpEvents(response.data);
      return { body, contentHash };
    }
  );

  if (parsed.length === 0) {
    return { discovered: 0, scrapeJobId: jobResult.scrapeJobId };
  }

  // 3. Upsert (conflict on slug, which is the canonical FIP id post-Plan-1 rename)
  const rows = parsed.map((p) => ({
    name: p.name,
    slug: p.slug,
    source: 'fip',
    last_updated_by: 'padelgod',
  }));

  const { error: upsertErr } = await deps.supabase
    .from('tournaments')
    .upsert(rows, { onConflict: 'slug', ignoreDuplicates: false });

  if (upsertErr) {
    throw new Error(`Tournament upsert failed: ${upsertErr.message}`);
  }

  return { discovered: parsed.length, scrapeJobId: jobResult.scrapeJobId };
}

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import { createHash } from 'node:crypto';
import { parseCrionetSearchResults } from '../parsers/crionet-search.js';
import { runScrapeJob } from '../lib/scrape-job.js';
import { CRIONET_SEARCH_VERSION } from '../lib/parser-versions.js';

export interface WidgetCodeLookupDeps {
  supabase: SupabaseClient;
  httpClient: AxiosInstance;
}

export interface WidgetCodeLookupResult {
  attempted: number;
  resolved: number;
  skipped: number;
}

const SEARCH_URL = 'https://widget.matchscorerlive.com/ft';

interface NeedingResolution {
  tournament_id: string;
  tournament_name: string;
  year: number;
}

function simplifyQuery(name: string): string {
  // Strip FIP prefix and year/category noise; keep the distinctive city/event word.
  // Example: "FIP Gold Iconico Sevilla 2026" → "iconico sevilla"
  return name
    .toLowerCase()
    .replace(/\bfip\b/g, '')
    .replace(/\b(gold|silver|bronze|beyond|promises|premier|p1|p2|major|b1|b2|b3)\b/g, '')
    .replace(/\b20\d{2}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchTournamentsNeedingResolution(
  supabase: SupabaseClient
): Promise<NeedingResolution[]> {
  const { data, error } = await supabase.rpc('padelgod_tournaments_needing_widget_code');
  if (error) throw new Error(`Lookup query failed: ${error.message}`);
  return (data ?? []) as NeedingResolution[];
}

export async function runWidgetCodeLookup(
  deps: WidgetCodeLookupDeps
): Promise<WidgetCodeLookupResult> {
  const todo = await fetchTournamentsNeedingResolution(deps.supabase);
  let resolved = 0;
  let skipped = 0;

  for (const t of todo) {
    const query = simplifyQuery(t.tournament_name);
    if (!query) {
      skipped++;
      continue;
    }

    const targetUrl = `${SEARCH_URL}?connector=tol&year=${t.year}&query=${encodeURIComponent(query)}`;
    let candidates: ReturnType<typeof parseCrionetSearchResults> = [];

    await runScrapeJob(
      deps.supabase,
      {
        jobType: 'widget_id',
        tournamentId: t.tournament_id,
        targetUrl,
        parserVersion: CRIONET_SEARCH_VERSION,
        captureBody: true,
      },
      async () => {
        const response = await deps.httpClient.post(
          SEARCH_URL,
          new URLSearchParams({ connector: 'tol', year: String(t.year), query }).toString(),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          }
        );
        const body = String(response.data);
        const contentHash = `sha256:${createHash('sha256').update(body).digest('hex')}`;
        candidates = parseCrionetSearchResults(body, t.year);
        return { body, contentHash };
      }
    );

    if (candidates.length !== 1) {
      // Zero matches OR ambiguous — skip; Playwright fallback comes in a later task.
      skipped++;
      continue;
    }

    const { code } = candidates[0]!;
    const { error: insertErr } = await deps.supabase
      .schema('padelgod')
      .from('widget_id_cache')
      .insert({
        tournament_id: t.tournament_id,
        widget_id: code,
        extraction_method: 'search',
      });

    if (insertErr) {
      // Unique constraint conflict means another worker beat us to it — count as resolved
      if (insertErr.message.includes('duplicate key')) {
        resolved++;
        continue;
      }
      throw new Error(`Insert widget_id_cache failed: ${insertErr.message}`);
    }
    resolved++;
  }

  return { attempted: todo.length, resolved, skipped };
}

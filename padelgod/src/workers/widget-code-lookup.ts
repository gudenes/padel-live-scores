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
        // Even on duplicate, try syncing to entity_external_ids — a prior
        // run may have cached the widget id without writing the sidecar
        // row (pre-2026-04-24 behavior). Non-fatal.
        await syncWidgetIdToEntityExternalIds(deps, t.tournament_id, code);
        continue;
      }
      throw new Error(`Insert widget_id_cache failed: ${insertErr.message}`);
    }
    await syncWidgetIdToEntityExternalIds(deps, t.tournament_id, code);
    resolved++;
  }

  return { attempted: todo.length, resolved, skipped };
}

/**
 * Mirror a discovered widget_id into `public.entity_external_ids` so the
 * rest of the stack (ops Tournament Explorer, future cross-source linking)
 * can resolve `tournament_id → widget_id` without reaching into the
 * padelgod schema.
 *
 * Why the dual write: the historical design kept widget_id in padelgod
 * only (it's an implementation detail of the Crionet widget pipeline),
 * but the ops API and future consumers need the same info to build the
 * composite `{tournamentWidgetId}:{matchWidgetId}` external id when
 * resolving matches to public.matches rows. Without this sync the ops
 * page shows `Linked 0 (0%)` for every tournament that only padelgod
 * discovered (observed for Brussels P2 2026 — 72 match-level rows
 * existed but the tournament-level row was missing, so the lookup
 * never resolved).
 *
 * Non-fatal on error: padelgod.widget_id_cache is the authoritative
 * store and still has the data; a failed sidecar write just means the
 * next lookup-worker run will retry. Logged at warn level.
 */
async function syncWidgetIdToEntityExternalIds(
  deps: WidgetCodeLookupDeps,
  tournamentId: string,
  widgetId: string,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const { error } = await deps.supabase
    .from('entity_external_ids')
    .upsert(
      {
        entity_type: 'tournament',
        entity_id: tournamentId,
        source: 'crionet_widget',
        external_id: widgetId,
        first_seen_at: nowIso,
        last_seen_at: nowIso,
      },
      { onConflict: 'source,entity_type,external_id', ignoreDuplicates: true },
    );
  if (error) {
    console.warn(
      `[widget-code-lookup] entity_external_ids sync failed for tournament ${tournamentId}: ${error.message}`,
    );
  }
}

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import { createHash } from 'node:crypto';
import { parseCrionetSearchResults, type ParsedSearchResult } from '../parsers/crionet-search.js';
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

// Normalise a tournament name for equality comparison. Lowercase, strip
// HTML entities + accent diacritics, collapse whitespace. Used to find
// the exact match when Crionet returns multiple candidates for a single
// simplified query.
function normaliseName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .toLowerCase()
    .replace(/&[a-z0-9#]+;/gi, ' ') // strip HTML entities (&#8211; etc.)
    .replace(/[^a-z0-9 ]+/g, ' ') // collapse punctuation to spaces
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pick a single candidate from the Crionet search results, or null if
 * we shouldn't auto-resolve.
 *
 * Why not just `length === 1`: matchscorerlive's text search is loose
 * (matches the simplified query against multiple tournament types). For
 * cities that host more than one FIP-tier event in a year, a search for
 * "asuncion" returns ASUNCION P2 *and* FIP PROMISES ASUNCION I. Without
 * disambiguation, the worker bails forever — the audit on 2026-04-27
 * found ~100 unresolved tournaments stuck in this state, including
 * Premier-tour P1/P2 events that absolutely are on Crionet.
 *
 * Disambiguation rule: prefer the candidate whose normalised name
 * EXACTLY matches the tournament's normalised name. The simplifier's
 * tier/year stripping already proves the original name is unique enough
 * — what we need here is to filter out the loose-matched siblings.
 *
 *   - 0 candidates    → null (skip)
 *   - 1 candidate     → take it
 *   - N candidates, exactly 1 with normalised-name === tournament
 *                     → take it
 *   - else            → null (skip; truly ambiguous)
 *
 * This intentionally does NOT do fuzzy/token-overlap scoring. If the
 * source-of-truth name and the Crionet name disagree even slightly,
 * we'd rather skip and surface in the ops "Needs widget" view than
 * risk linking the wrong tournament. False linkage is much harder to
 * unwind than a missed resolution.
 */
export function chooseCandidate(
  candidates: ParsedSearchResult[],
  tournamentName: string,
): ParsedSearchResult | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;
  const target = normaliseName(tournamentName);
  const exact = candidates.filter(c => normaliseName(c.name) === target);
  if (exact.length === 1) return exact[0]!;
  return null;
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

    const chosen = chooseCandidate(candidates, t.tournament_name);
    if (!chosen) {
      // Zero matches, or ambiguous with no clear exact-name winner.
      // Playwright fallback comes in a later task.
      skipped++;
      continue;
    }

    const { code } = chosen;
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

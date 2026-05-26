import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import type { Logger } from 'pino';

/**
 * fip-cms-orphan-prune
 *
 * Stamps + sweeps orphan FIP-source tournament rows whose slugs are no
 * longer published in the FIP WP /events response. Counterpart to the
 * `tournament-discovery` worker which CREATES rows; this one cleans up
 * when FIP renames or removes an event without telling us.
 *
 * Why this exists
 * ---------------
 * The 2026-05-25 audit found 8 orphan rows accumulated in prod
 * (FIP BRONZE MATOSINHOS, FIP BEYOND B3 CASTELLÓN, six more). The
 * pattern: FIP publishes an event at slug A, padelgod discovers it,
 * later FIP renames it to slug B; discovery creates a row for B but
 * never touches A again. Row A lingers indefinitely with stale data
 * (no country, no logo refresh), bloats the user-facing tournament
 * list, and trips downstream workers that iterate "active" tournaments.
 *
 * Algorithm
 * ---------
 * 1. Fetch every published FIP event slug (full snapshot, not the
 *    `modified_after` incremental pull discovery uses).
 * 2. For each FIP-source DB row:
 *      - present in CMS → clear `last_missing_from_cms_at` (no-op if
 *        already null; keeps the row in steady state).
 *      - absent from CMS → stamp `last_missing_from_cms_at = NOW()` if
 *        currently null; otherwise leave alone (we want the ORIGINAL
 *        miss timestamp so the age-based prune below is monotonic).
 * 3. Delete rows that are:
 *      - source = 'fip'
 *      - padelapi_id IS NULL (never touch padelapi-linked rows)
 *      - last_missing_from_cms_at older than `missingThresholdMs`
 *        (default 7 days — survives a CMS hiccup, kills genuine
 *        orphans within a week)
 *      - zero matches in public.matches
 *      - zero rows in padelgod.widget_id_cache
 *
 * Deletion relies on the post-2026-05-25 ON DELETE CASCADE FK from
 * padelgod.scrape_jobs.tournament_id → public.tournaments(id). Without
 * that migration, the DELETE bounces on the FK; the worker logs the
 * count and proceeds.
 */

export interface FipCmsOrphanPruneDeps {
  supabase: SupabaseClient;
  httpClient: AxiosInstance;
  logger?: Logger;
  /** How long a row must have been missing before deletion. Default
   *  7 days. Tests pass small values to make the age gate trivial. */
  missingThresholdMs?: number;
  /** When true, log proposed writes/deletes but don't execute. */
  dryRun: boolean;
}

export interface FipCmsOrphanPruneResult {
  cmsSlugsChecked: number;
  candidateRows: number;
  rowsStamped: number;
  rowsCleared: number;
  rowsDeleted: number;
  rowsSkippedHasMatches: number;
  rowsSkippedHasWidget: number;
  rowsSkippedTooRecent: number;
  rowsSkippedHasPadelapiId: number;
  dryRun: boolean;
}

const WP_API_BASE = 'https://www.padelfip.com/wp-json/wp/v2/events';
const DEFAULT_MISSING_THRESHOLD_MS = 7 * 24 * 3600 * 1000;

interface CandidateRow {
  id: string;
  slug: string;
  name: string;
  padelapi_id: string | null;
  last_missing_from_cms_at: string | null;
}

export async function runFipCmsOrphanPrune(
  deps: FipCmsOrphanPruneDeps,
): Promise<FipCmsOrphanPruneResult> {
  const { supabase, httpClient, logger, dryRun } = deps;
  const threshold = deps.missingThresholdMs ?? DEFAULT_MISSING_THRESHOLD_MS;

  const result: FipCmsOrphanPruneResult = {
    cmsSlugsChecked: 0,
    candidateRows: 0,
    rowsStamped: 0,
    rowsCleared: 0,
    rowsDeleted: 0,
    rowsSkippedHasMatches: 0,
    rowsSkippedHasWidget: 0,
    rowsSkippedTooRecent: 0,
    rowsSkippedHasPadelapiId: 0,
    dryRun,
  };

  // 1. Full snapshot of slugs currently published by the FIP CMS.
  const cmsSlugs = await fetchAllFipEventSlugs(httpClient);
  result.cmsSlugsChecked = cmsSlugs.size;

  if (cmsSlugs.size === 0) {
    logger?.warn(
      {},
      'fip-cms-orphan-prune: FIP CMS returned zero slugs — refusing to stamp/prune',
    );
    return result;
  }

  // 2. Load FIP-source candidates. We pull padelapi_id too so the
  //    skip-count for padelapi-linked rows is observable.
  const candidates = await loadFipCandidates(supabase);
  result.candidateRows = candidates.length;

  const nowIso = new Date().toISOString();

  for (const row of candidates) {
    const inCms = cmsSlugs.has(row.slug);
    if (inCms) {
      if (row.last_missing_from_cms_at !== null) {
        if (!dryRun) {
          const { error } = await supabase
            .from('tournaments')
            .update({ last_missing_from_cms_at: null })
            .eq('id', row.id);
          if (error) {
            throw new Error(
              `clear last_missing_from_cms_at (id=${row.id}): ${error.message}`,
            );
          }
        }
        result.rowsCleared += 1;
      }
      continue;
    }

    // Absent from CMS → stamp if not stamped.
    if (row.last_missing_from_cms_at === null) {
      if (!dryRun) {
        const { error } = await supabase
          .from('tournaments')
          .update({ last_missing_from_cms_at: nowIso })
          .eq('id', row.id);
        if (error) {
          throw new Error(
            `stamp last_missing_from_cms_at (id=${row.id}): ${error.message}`,
          );
        }
      }
      result.rowsStamped += 1;
    }
  }

  // 3. Prune eligible rows. We re-read the candidate set after the
  //    stamping pass so newly-stamped rows include their fresh
  //    timestamp; but we only DELETE rows whose stamp is OLDER than
  //    threshold, so a row stamped THIS run never gets deleted same-run.
  const stampedCandidates = await loadFipCandidates(supabase);
  const eligible = stampedCandidates.filter((r) => {
    if (r.padelapi_id != null) {
      result.rowsSkippedHasPadelapiId += 1;
      return false;
    }
    if (r.last_missing_from_cms_at == null) return false;
    const stampedAt = Date.parse(r.last_missing_from_cms_at);
    if (!Number.isFinite(stampedAt)) return false;
    if (Date.now() - stampedAt < threshold) {
      result.rowsSkippedTooRecent += 1;
      return false;
    }
    return true;
  });

  if (eligible.length === 0) {
    logger?.info(result, 'fip-cms-orphan-prune: no rows eligible for deletion');
    return result;
  }

  // Filter out rows that have matches or widgets. PostgREST doesn't
  // expose `NOT EXISTS` cleanly so we do two batched lookups and exclude.
  const eligibleIds = eligible.map((r) => r.id);
  const matchTids = await loadTournamentsWithMatches(supabase, eligibleIds);
  const widgetTids = await loadTournamentsWithWidgets(supabase, eligibleIds);

  const toDelete: CandidateRow[] = [];
  for (const r of eligible) {
    if (matchTids.has(r.id)) {
      result.rowsSkippedHasMatches += 1;
      continue;
    }
    if (widgetTids.has(r.id)) {
      result.rowsSkippedHasWidget += 1;
      continue;
    }
    toDelete.push(r);
  }

  if (toDelete.length === 0) {
    logger?.info(result, 'fip-cms-orphan-prune: nothing left after match/widget guards');
    return result;
  }

  if (dryRun) {
    logger?.info(
      { toDelete: toDelete.map((r) => ({ id: r.id, slug: r.slug, name: r.name })) },
      'fip-cms-orphan-prune [dry-run]: would DELETE',
    );
    result.rowsDeleted += toDelete.length;
    return result;
  }

  // Cascade-relying DELETE — requires the
  // 20260525_scrape_jobs_cascade_tournament_id migration applied.
  // Without it the DELETE bounces on the FK; we log and continue.
  const { error: delErr, count } = await supabase
    .from('tournaments')
    .delete({ count: 'exact' })
    .in('id', toDelete.map((r) => r.id));
  if (delErr) {
    logger?.warn(
      { err: delErr.message, attempted: toDelete.length },
      'fip-cms-orphan-prune: DELETE failed (likely missing scrape_jobs CASCADE migration)',
    );
    return result;
  }
  result.rowsDeleted += count ?? toDelete.length;
  logger?.info(
    { deleted: result.rowsDeleted, slugs: toDelete.map((r) => r.slug) },
    'fip-cms-orphan-prune: deleted orphans',
  );
  return result;
}

// ── Helpers (exported for tests) ───────────────────────────────────────

export async function fetchAllFipEventSlugs(
  httpClient: AxiosInstance,
): Promise<Set<string>> {
  const out = new Set<string>();
  // Hard ceiling so a CMS pagination bug can't run away. FIP currently
  // publishes ~200 events; per_page=100 means ≤5 pages is generous.
  for (let page = 1; page <= 10; page++) {
    let data: unknown;
    try {
      const res = await httpClient.get(`${WP_API_BASE}?per_page=100&page=${page}&_fields=slug`);
      data = res.data;
    } catch {
      // Best-effort — return whatever we have. The caller short-circuits
      // when the slug set ends up empty.
      break;
    }
    if (!Array.isArray(data) || data.length === 0) break;
    for (const e of data as Array<{ slug?: string }>) {
      if (typeof e.slug === 'string' && e.slug.length > 0) out.add(e.slug);
    }
    if ((data as unknown[]).length < 100) break;
  }
  return out;
}

async function loadFipCandidates(
  supabase: SupabaseClient,
): Promise<CandidateRow[]> {
  const { data, error } = await supabase
    .from('tournaments')
    .select('id, slug, name, padelapi_id, last_missing_from_cms_at')
    .eq('source', 'fip')
    .not('slug', 'is', null);
  if (error) {
    throw new Error(`fip candidates load: ${error.message}`);
  }
  return (data ?? []) as CandidateRow[];
}

async function loadTournamentsWithMatches(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await supabase
    .from('matches')
    .select('tournament_id')
    .in('tournament_id', ids);
  if (error) throw new Error(`matches lookup: ${error.message}`);
  return new Set((data ?? []).map((r: { tournament_id: string }) => r.tournament_id));
}

async function loadTournamentsWithWidgets(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await supabase
    .schema('padelgod')
    .from('widget_id_cache')
    .select('tournament_id')
    .in('tournament_id', ids);
  if (error) throw new Error(`widget_id_cache lookup: ${error.message}`);
  return new Set((data ?? []).map((r: { tournament_id: string }) => r.tournament_id));
}

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';

/**
 * fip-oop-writer — simplified-pipeline writer #2.
 *
 * Reads `padelgod.oop_snapshots` (populated by `oop-fetcher` every hour
 * at :50) and UPDATEs the `court`, `court_order`, and (NULL-only) `round`
 * fields on `public.matches` rows that are already keyed by the real
 * widget composite (created by `fip-draw-populator`).
 *
 * One job only
 * ------------
 * - Looks up matches by `widget_id_composite` via a batched prefix query
 * - If not found → SKIP (never creates matches; that's the populator's job)
 * - UPDATEs court + court_order; UPDATEs round ONLY if currently null
 *   (keeps the populator's canonical "R32" format from being clobbered
 *   with OOP's "Round of 32" during the parallel migration period)
 *
 * What this writer does NOT touch
 * -------------------------------
 * - `status`, `winner_pair`, `sets` — results-writer owns these
 * - `scheduled_at` — padelapi narrow sync owns it (see design doc §11.1);
 *   OOP Schedule Review panel is the operator override for overrides
 * - `widget_id_composite` — populator sets this on INSERT, immutable
 * - Any row where `widget_id_composite IS NULL` — legacy reconciler rows
 *   are invisible to this writer
 *
 * Parallel-safety during migration
 * --------------------------------
 *   - ENABLE_FIP_OOP_WRITER defaults false
 *   - FIP_OOP_WRITER_DRY_RUN defaults true
 *   - Cron :52 — no overlap with oop-fetcher (:50) or results-fetcher (:55)
 *   - Legacy static-reconciler keeps running on :05/:35 and writing to
 *     legacy synthetic-composite rows (which this writer ignores)
 *
 * Known data issue (out of scope — separate parser PR)
 * ----------------------------------------------------
 * Some oop_snapshots rows have `court` and `scheduled_label` SWAPPED due
 * to a bug in `crionet-oop.ts` (observed 2026-04-24 on Brussels). When
 * this writer runs against bad snapshot data, it will faithfully copy
 * the bad value into `public.matches.court`. Fix is in the parser, not
 * here. Adding court-string validation here would mask the upstream bug
 * and is deliberately not done.
 */

export interface FipOopWriterDeps {
  supabase: SupabaseClient;
  logger?: Logger;
  /** When true (default), log proposed updates but don't write. Lets
   *  operators review output before committing. */
  dryRun: boolean;
}

export interface FipOopWriterResult {
  tournamentsProcessed: number;
  tournamentsSkippedNoWidget: number;
  oopRowsConsidered: number;
  updated: number;
  skippedNoMatch: number;
  skippedNoWidgetId: number;
  skippedNothingToChange: number;
  dryRun: boolean;
}

interface TournamentRow {
  tournament_id: string;
  tournament_name: string;
  slug: string;
}

interface OopRow {
  tournament_id: string;
  match_widget_id: string | null;
  category: 'men' | 'women';
  round_label: string | null;
  court: string | null;
  court_position: number | null;
  scheduled_label: string | null;
  captured_at: string;
}

interface ExistingMatch {
  id: string;
  widget_id_composite: string;
  round: string | null;
  court: string | null;
  court_order: number | null;
}

// ── Main entry ─────────────────────────────────────────────────────────

export async function runFipOopWriter(
  deps: FipOopWriterDeps
): Promise<FipOopWriterResult> {
  const { supabase, logger, dryRun } = deps;

  const result: FipOopWriterResult = {
    tournamentsProcessed: 0,
    tournamentsSkippedNoWidget: 0,
    oopRowsConsidered: 0,
    updated: 0,
    skippedNoMatch: 0,
    skippedNoWidgetId: 0,
    skippedNothingToChange: 0,
    dryRun,
  };

  // 1. Active tournaments
  const { data: tours, error: toursErr } = await supabase.rpc(
    'padelgod_active_tournaments_with_slug'
  );
  if (toursErr) {
    throw new Error(
      `padelgod_active_tournaments_with_slug RPC failed: ${toursErr.message}`
    );
  }
  const tournaments = (tours ?? []) as TournamentRow[];

  for (const t of tournaments) {
    const tournamentWidgetId = await getActiveWidgetIdCode(
      supabase,
      t.tournament_id
    );
    if (!tournamentWidgetId) {
      result.tournamentsSkippedNoWidget += 1;
      continue;
    }

    // 2. Latest OOP snapshot per (tournament, match_widget_id)
    const latestOop = await loadLatestOopRows(supabase, t.tournament_id);
    if (latestOop.length === 0) continue;

    result.tournamentsProcessed += 1;

    // 3. Pre-load composite-keyed matches for this tournament
    const compositePrefix = `${tournamentWidgetId}:`;
    const matchByComposite = await loadExistingMatchesByPrefix(
      supabase,
      compositePrefix
    );

    // 4. Process each OOP row
    for (const r of latestOop) {
      result.oopRowsConsidered += 1;

      if (!r.match_widget_id) {
        result.skippedNoWidgetId += 1;
        continue;
      }

      const composite = `${tournamentWidgetId}:${r.match_widget_id}`;
      const existing = matchByComposite.get(composite);

      if (!existing) {
        // Populator hasn't created this match yet (or never will, e.g.
        // widget-code-lookup + populator haven't caught up). Skip silently.
        result.skippedNoMatch += 1;
        continue;
      }

      // Build the UPDATE patch with only-changed + only-safe fields
      const patch = buildOopPatch(r, existing);
      if (!patch) {
        result.skippedNothingToChange += 1;
        continue;
      }

      if (dryRun) {
        logger?.info(
          { composite, matchId: existing.id, patch },
          'fip-oop-writer [dry-run]: would UPDATE match'
        );
      } else {
        const { error: updErr } = await supabase
          .from('matches')
          .update(patch)
          .eq('id', existing.id);
        if (updErr) {
          throw new Error(
            `matches update failed (id=${existing.id}, composite=${composite}): ${updErr.message}`
          );
        }
      }
      result.updated += 1;
    }
  }

  logger?.info(result, 'fip-oop-writer run complete');
  return result;
}

// ── Patch builder (exported for testing) ───────────────────────────────

/**
 * Compute the narrow UPDATE patch for one match given the latest OOP
 * snapshot. Returns null when nothing would change (caller skips the
 * write).
 *
 * Policy:
 *   - court: overwrite if differs (OOP is authoritative for court moves).
 *   - court_order: 0-based → 1-based; overwrite only when snapshot has
 *     a non-null court_position (preserve whatever was there on
 *     historical rows without positions).
 *   - round: NULL-only write. Populator sets "R32"; OOP emits
 *     "Round of 32". Leaving the populator's value intact during
 *     migration avoids round-label churn in the UI. Once we're fully
 *     off the legacy reconciler, we can revisit whether OOP's round
 *     should take priority.
 */
export function buildOopPatch(
  snapshot: OopRow,
  existing: ExistingMatch
): Record<string, string | number> | null {
  const patch: Record<string, string | number> = {};

  if (snapshot.court && snapshot.court !== existing.court) {
    patch.court = snapshot.court;
  }

  if (
    snapshot.court_position != null &&
    existing.court_order !== snapshot.court_position + 1
  ) {
    patch.court_order = snapshot.court_position + 1;
  }

  if (
    existing.round === null &&
    snapshot.round_label != null &&
    snapshot.round_label.length > 0
  ) {
    patch.round = snapshot.round_label;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

// ── DB helpers ─────────────────────────────────────────────────────────

async function getActiveWidgetIdCode(
  supabase: SupabaseClient,
  tournamentId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .schema('padelgod')
    .from('widget_id_cache')
    .select('widget_id')
    .eq('tournament_id', tournamentId)
    .eq('is_active', true)
    .maybeSingle();
  if (error) {
    throw new Error(
      `widget_id_cache read failed (tournament=${tournamentId}): ${error.message}`
    );
  }
  return (data?.widget_id as string | undefined) ?? null;
}

async function loadLatestOopRows(
  supabase: SupabaseClient,
  tournamentId: string
): Promise<OopRow[]> {
  const { data, error } = await supabase
    .schema('padelgod')
    .from('oop_snapshots')
    .select(
      'tournament_id, match_widget_id, category, round_label, court, court_position, scheduled_label, captured_at'
    )
    .eq('tournament_id', tournamentId);
  if (error) {
    throw new Error(
      `oop_snapshots read failed (tournament=${tournamentId}): ${error.message}`
    );
  }
  const rows = (data ?? []) as unknown as OopRow[];

  const latest = new Map<string, OopRow>();
  for (const r of rows) {
    if (!r.match_widget_id) continue;
    const key = r.match_widget_id;
    const prev = latest.get(key);
    if (!prev || r.captured_at > prev.captured_at) latest.set(key, r);
  }
  return Array.from(latest.values());
}

async function loadExistingMatchesByPrefix(
  supabase: SupabaseClient,
  compositePrefix: string
): Promise<Map<string, ExistingMatch>> {
  const { data, error } = await supabase
    .from('matches')
    .select('id, widget_id_composite, round, court, court_order')
    .like('widget_id_composite', `${compositePrefix}%`);
  if (error) {
    throw new Error(
      `matches read failed (prefix=${compositePrefix}): ${error.message}`
    );
  }
  const map = new Map<string, ExistingMatch>();
  for (const row of (data ?? []) as ExistingMatch[]) {
    if (row.widget_id_composite) map.set(row.widget_id_composite, row);
  }
  return map;
}

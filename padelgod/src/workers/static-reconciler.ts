import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';

export interface StaticReconcilerDeps {
  supabase: SupabaseClient;
  logger?: Logger;
}

export interface StaticReconcilerResult {
  tournamentsProcessed: number;
  playersUpserted: number;
  playersSkipped: number;
}

const SNAPSHOT_LOOKBACK_DAYS = 14;

interface EntryListSnapshotRow {
  tournament_id: string;
  category: 'men' | 'women';
  fip_id: string | null;
  name: string | null;
  country: string | null;
  captured_at: string;
}

interface ExistingPlayerRow {
  id: string;
  fip_id: string;
  name: string | null;
  country: string | null;
  category: string | null;
}

/**
 * Phase 1 of the static reconciler: entry list → players.
 *
 * For each (tournament_id, category) with recent entry list snapshots, pick the
 * latest snapshot batch and upsert `public.players` by `fip_id` (hot column —
 * no sidecar write needed).
 *
 * - Rows with a null fip_id are skipped (can't safely create thin records).
 * - Rows duplicated within the same snapshot (same fip_id) are deduplicated
 *   before writing.
 * - Every write records `last_updated_by='padelgod'` so the source-of-truth
 *   audit trail is maintained.
 *
 * Tasks 6 (draw) and 7 (OOP + results) will extend this file. Keep the exported
 * shape (`runStaticReconciler` + `StaticReconcilerDeps` + `StaticReconcilerResult`)
 * stable.
 */
export async function runStaticReconciler(
  deps: StaticReconcilerDeps
): Promise<StaticReconcilerResult> {
  const { supabase, logger } = deps;

  const cutoff = new Date(Date.now() - SNAPSHOT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: snapshotRows, error: snapErr } = await supabase
    .schema('padelgod')
    .from('entry_list_snapshots')
    .select('tournament_id, category, fip_id, name, country, captured_at')
    .gte('captured_at', cutoff);

  if (snapErr) {
    throw new Error(`entry_list_snapshots read failed: ${snapErr.message}`);
  }

  const rows = (snapshotRows ?? []) as EntryListSnapshotRow[];

  // Group by (tournament_id, category) and keep only rows from the latest
  // captured_at per group.
  const groups = new Map<string, EntryListSnapshotRow[]>();
  for (const row of rows) {
    const key = `${row.tournament_id}::${row.category}`;
    const arr = groups.get(key);
    if (arr) arr.push(row);
    else groups.set(key, [row]);
  }

  const latestRows: EntryListSnapshotRow[] = [];
  const processedKeys = new Set<string>();
  for (const [key, groupRows] of groups.entries()) {
    let maxCapturedAt = '';
    for (const r of groupRows) {
      if (r.captured_at > maxCapturedAt) maxCapturedAt = r.captured_at;
    }
    for (const r of groupRows) {
      if (r.captured_at === maxCapturedAt) latestRows.push(r);
    }
    processedKeys.add(key);
  }

  const tournamentsProcessed = new Set(latestRows.map((r) => r.tournament_id)).size;

  // Dedup by fip_id within the latest-snapshot rows. Keep the first occurrence.
  // Skip rows with null fip_id entirely.
  const byFipId = new Map<string, EntryListSnapshotRow>();
  let playersSkipped = 0;
  for (const r of latestRows) {
    if (!r.fip_id) {
      playersSkipped += 1;
      continue;
    }
    if (byFipId.has(r.fip_id)) continue;
    byFipId.set(r.fip_id, r);
  }

  if (byFipId.size === 0) {
    return { tournamentsProcessed, playersUpserted: 0, playersSkipped };
  }

  const fipIds = Array.from(byFipId.keys());

  // Fetch existing player rows so we can decide insert vs update and diff-check.
  const { data: existing, error: existErr } = await supabase
    .from('players')
    .select('id, fip_id, name, country, category')
    .in('fip_id', fipIds);

  if (existErr) {
    throw new Error(`players read failed: ${existErr.message}`);
  }

  const existingByFipId = new Map<string, ExistingPlayerRow>();
  for (const row of (existing ?? []) as ExistingPlayerRow[]) {
    if (row.fip_id) existingByFipId.set(row.fip_id, row);
  }

  const now = new Date().toISOString();
  let playersUpserted = 0;

  for (const [fipId, snap] of byFipId.entries()) {
    const match = existingByFipId.get(fipId);

    if (match) {
      const nameDiffers = snap.name != null && snap.name !== match.name;
      const countryDiffers = snap.country != null && snap.country !== match.country;
      const categoryDiffers = snap.category !== match.category;

      if (!nameDiffers && !countryDiffers && !categoryDiffers) {
        continue; // nothing to update
      }

      const update: Record<string, unknown> = {
        last_updated_by: 'padelgod',
        updated_at: now,
      };
      if (nameDiffers) update.name = snap.name;
      if (countryDiffers) update.country = snap.country;
      if (categoryDiffers) update.category = snap.category;

      const { error: updErr } = await supabase
        .from('players')
        .update(update)
        .eq('id', match.id);

      if (updErr) {
        throw new Error(`players update failed (fip_id=${fipId}): ${updErr.message}`);
      }
      playersUpserted += 1;
    } else {
      // New player — insert with name + country + category + fip_id + source='fip'.
      if (!snap.name) {
        // Guard: we shouldn't create a thin record with no name. Skip.
        playersSkipped += 1;
        continue;
      }

      const insert: Record<string, unknown> = {
        fip_id: fipId,
        name: snap.name,
        category: snap.category,
        source: 'fip',
        last_updated_by: 'padelgod',
        updated_at: now,
      };
      if (snap.country != null) insert.country = snap.country;

      const { error: insErr } = await supabase.from('players').insert(insert);

      if (insErr) {
        throw new Error(`players insert failed (fip_id=${fipId}): ${insErr.message}`);
      }
      playersUpserted += 1;
    }
  }

  logger?.info(
    {
      tournamentsProcessed,
      playersUpserted,
      playersSkipped,
    },
    'static-reconciler entry-list phase complete'
  );

  return { tournamentsProcessed, playersUpserted, playersSkipped };
}

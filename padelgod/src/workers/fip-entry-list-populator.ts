// padelgod/src/workers/fip-entry-list-populator.ts
//
// Simplified-pipeline writer #5 (PR 3 in the migration plan).
//
// Reads `padelgod.entry_list_snapshots` and UPSERTs `public.players`
// keyed on `fip_id`. Replaces the entry-list phase of the legacy
// static-reconciler (`reconcileEntryLists`). Same shape, same writes,
// same battle-tested production behaviour — but as an independent
// worker on its own cron slot, with dry-run support, so we can flip
// it on/off without touching the legacy reconciler.
//
// Design lessons baked in (paid for by 4+ weeks of production runs):
//
//   1. `fip_id` is the canonical identity. Never INSERT without one;
//      thin records are worthless and pollute search.
//
//   2. Latest snapshot wins. Within a (tournament_id, category) group,
//      we keep only rows from the most recent captured_at. Earlier
//      captures get dropped — they're stale relative to the freshest
//      one for that bucket.
//
//   3. NULL-only updates. For an existing players row, we only patch
//      fields that genuinely differ. We never write a value already
//      held by another higher-priority source (per
//      src/lib/source-priority.ts: name → padelapi primary, country →
//      mixed, etc.). The "compare-then-update" guard is what makes
//      this writer safely run anywhere.
//
//   4. `public.players` has NO `source` column. Only `last_updated_by`.
//      The original Vercel-side persist tried to write `source: 'fip'`
//      and blew up the Ijuí pilot on 2026-04-21 with PostgREST
//      "Could not find the 'source' column" — the comment in
//      src/lib/fip-entry-list-persist.ts is the canonical record.
//
// Deliberate omissions vs. reconcileEntryLists:
//
//   - No name resolution / fuzzy matching anywhere. Composite-only
//     identity for the simplified pipeline (spec §4).
//   - No tournament-scope filters (allowlist / exclude-levels). The
//     player set is universal — there's no Brussels-equivalent risk
//     in writing a real player to public.players, regardless of which
//     match-pipeline they're going through. NULL-only updates protect
//     against clobbering existing source-priority data.
//
// Cron slot: :46 (between entry-list-fetcher :45 and fip-draw-populator
// :47). The populator's draw-time fip_id → player.id resolution sees
// freshly-upserted rows from this worker on the same hour.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';

const SNAPSHOT_LOOKBACK_DAYS = 14;

export interface FipEntryListPopulatorDeps {
  supabase: SupabaseClient;
  logger?: Logger;
  /**
   * When true (default), log proposed writes but make no DB changes.
   * Lets operators review before committing the worker.
   */
  dryRun: boolean;
  /** When set, only snapshot rows whose tournament_id is in the
   *  allowlist are processed. Used by the on-demand refresh endpoint. */
  onlyTournamentIds?: Set<string>;
}

export interface FipEntryListPopulatorResult {
  /** Distinct (tournament_id) values that survived the latest-snapshot
   *  selection. NOT a count of all tournaments touched by the snapshot
   *  table — only those with at least one usable row. */
  tournamentsProcessed: number;
  /** Total snapshot rows considered after the latest-snapshot filter. */
  snapshotRowsConsidered: number;
  /** Rows we couldn't process because fip_id was null (legacy entries
   *  or parse failures upstream). Skipped silently — see lesson 1. */
  playersSkippedNoFipId: number;
  /** Existing rows we left untouched because every candidate field
   *  matched. Surfaces idempotency to operators on repeat runs. */
  playersSkippedNoChange: number;
  /** Inserts of new players (no existing row for that fip_id). */
  playersInserted: number;
  /** Updates of existing players where at least one field changed. */
  playersUpdated: number;
  dryRun: boolean;
}

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

export async function runFipEntryListPopulator(
  deps: FipEntryListPopulatorDeps,
): Promise<FipEntryListPopulatorResult> {
  const { supabase, logger, dryRun } = deps;

  const result: FipEntryListPopulatorResult = {
    tournamentsProcessed: 0,
    snapshotRowsConsidered: 0,
    playersSkippedNoFipId: 0,
    playersSkippedNoChange: 0,
    playersInserted: 0,
    playersUpdated: 0,
    dryRun,
  };

  // 1. Read recent entry-list snapshots. Lookback is 14 days — same as
  //    the legacy reconciler. Tournaments with no fresh snapshots in
  //    that window are silently dropped.
  const cutoff = new Date(
    Date.now() - SNAPSHOT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: snapshotRows, error: snapErr } = await supabase
    .schema('padelgod')
    .from('entry_list_snapshots')
    .select('tournament_id, category, fip_id, name, country, captured_at')
    .gte('captured_at', cutoff);

  if (snapErr) {
    throw new Error(
      `entry_list_snapshots read failed: ${snapErr.message}`,
    );
  }

  const allRows = (snapshotRows ?? []) as EntryListSnapshotRow[];
  const rows = deps.onlyTournamentIds && deps.onlyTournamentIds.size > 0
    ? allRows.filter((r) => deps.onlyTournamentIds!.has(r.tournament_id))
    : allRows;

  // 2. Group by (tournament_id, category) and keep only the latest
  //    captured_at within each group. Multiple snapshots accrue on the
  //    table over time (the fetcher inserts a fresh batch every hour).
  //    Without this filter we'd reprocess every old player row on every
  //    run. With it, only "latest known truth per bucket" wins.
  const groups = new Map<string, EntryListSnapshotRow[]>();
  for (const row of rows) {
    const key = `${row.tournament_id}::${row.category}`;
    const arr = groups.get(key);
    if (arr) arr.push(row);
    else groups.set(key, [row]);
  }

  const latestRows: EntryListSnapshotRow[] = [];
  for (const groupRows of groups.values()) {
    let maxCapturedAt = '';
    for (const r of groupRows) {
      if (r.captured_at > maxCapturedAt) maxCapturedAt = r.captured_at;
    }
    for (const r of groupRows) {
      if (r.captured_at === maxCapturedAt) latestRows.push(r);
    }
  }

  result.snapshotRowsConsidered = latestRows.length;
  result.tournamentsProcessed = new Set(
    latestRows.map((r) => r.tournament_id),
  ).size;

  // 3. Dedup by fip_id within the latest-snapshot rows. Skip null fip_id
  //    silently — see lesson 1. Within a single tournament (men's or
  //    women's), the same fip_id can appear twice (player listed once
  //    on their own row, once as someone else's partner) so dedup is
  //    real, not theoretical.
  const byFipId = new Map<string, EntryListSnapshotRow>();
  for (const r of latestRows) {
    if (!r.fip_id) {
      result.playersSkippedNoFipId += 1;
      continue;
    }
    if (byFipId.has(r.fip_id)) continue;
    byFipId.set(r.fip_id, r);
  }

  if (byFipId.size === 0) {
    logger?.info(result, 'fip-entry-list-populator: nothing to write');
    return result;
  }

  // 4. Fetch existing player rows in one round-trip. Drives the
  //    insert-vs-update branch.
  const fipIds = Array.from(byFipId.keys());
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

  // 5. Per-fip_id insert-or-update loop. Sequential by design — these
  //    runs are small (hundreds of rows max) and serial writes give us
  //    deterministic counters + clean error attribution.
  for (const [fipId, snap] of byFipId.entries()) {
    const match = existingByFipId.get(fipId);

    if (match) {
      // NULL-only update. Only patch fields that differ AND only when
      // the snapshot has a non-null value to write — never overwrite a
      // populated field with null. The category check is whole-row (no
      // null-skip) because category is required on every snapshot row.
      const nameDiffers = snap.name != null && snap.name !== match.name;
      const countryDiffers =
        snap.country != null && snap.country !== match.country;
      const categoryDiffers = snap.category !== match.category;

      if (!nameDiffers && !countryDiffers && !categoryDiffers) {
        result.playersSkippedNoChange += 1;
        continue;
      }

      const update: Record<string, unknown> = {
        last_updated_by: 'padelgod',
        updated_at: now,
      };
      if (nameDiffers) update.name = snap.name;
      if (countryDiffers) update.country = snap.country;
      if (categoryDiffers) update.category = snap.category;

      if (!dryRun) {
        const { error: updErr } = await supabase
          .from('players')
          .update(update)
          .eq('id', match.id);
        if (updErr) {
          throw new Error(
            `players update failed (fip_id=${fipId}): ${updErr.message}`,
          );
        }
      }
      result.playersUpdated += 1;
    } else {
      // INSERT path. Refuse if the snapshot lacks a name — a player row
      // with just a fip_id is useless to downstream consumers.
      if (!snap.name) {
        result.playersSkippedNoFipId += 1; // close enough; same outcome
        continue;
      }

      // No `source` column. external_id mirrors fip_id for legacy-column
      // continuity (the players-table sync trigger expects it populated
      // for FIP-sourced rows).
      const insert: Record<string, unknown> = {
        fip_id: fipId,
        external_id: fipId,
        name: snap.name,
        category: snap.category,
        last_updated_by: 'padelgod',
        updated_at: now,
        // Push hook — fresh players jump to the front of the player-profile
        // worker queue. Sentinel timestamp is older than any realistic
        // attempt, so the queue's `profile_attempt_at NULLS FIRST` ordering
        // picks these rows right after any NULL-attempt rows.
        profile_attempt_at: '1970-01-01T00:00:00Z',
        profile_status: null,
      };
      if (snap.country != null) insert.country = snap.country;

      if (!dryRun) {
        const { error: insErr } = await supabase
          .from('players')
          .insert(insert);
        if (insErr) {
          throw new Error(
            `players insert failed (fip_id=${fipId}): ${insErr.message}`,
          );
        }
      }
      result.playersInserted += 1;
    }
  }

  logger?.info(result, 'fip-entry-list-populator run complete');
  return result;
}

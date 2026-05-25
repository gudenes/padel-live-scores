#!/usr/bin/env -S npx tsx
/**
 * One-shot cleanup for orphan FIP-source tournament rows.
 *
 * An "orphan" here is a row that:
 *   - has source='fip' (padelgod-discovered)
 *   - has no padelapi_id (not linked to a padelapi-imported row)
 *   - has zero matches
 *   - has zero widget_id_cache rows (no scraping activity)
 *   - has its slug returning NO RESULT from the FIP WP /events API
 *
 * These accumulate when the FIP CMS renames or removes an event after
 * padelgod has already discovered it. The new slug gets a new row via
 * normal discovery; the old slug's row is never touched again and
 * remains forever with stale/incomplete data (no country, no logo
 * updates, …). FIP BRONZE MATOSINHOS + FIP BEYOND B3 CASTELLÓN were
 * the two that surfaced this in 2026-05-25; audit found 25 of them.
 *
 * Behaviour:
 *   - Default = dry-run. Prints the deletion candidates as a JSON
 *     array on stdout, plus a one-line summary on stderr.
 *   - --apply = actually DELETE. CASCADE handles related rows
 *     (entry_list_snapshots, etc.).
 *
 * Run:
 *   SUPABASE_URL=… SUPABASE_SERVICE_KEY=… npx tsx scripts/cleanup-orphan-tournaments.ts
 *   …                                       npx tsx scripts/cleanup-orphan-tournaments.ts --apply
 */

import 'dotenv/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');
const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const WP_EVENTS_BASE = 'https://www.padelfip.com/wp-json/wp/v2/events';

interface TournamentRow {
  id: string;
  slug: string;
  name: string;
  starts_at: string | null;
  country: string | null;
  padelapi_id: string | null;
}

async function fipSlugExists(slug: string): Promise<boolean> {
  // Returns true iff the FIP WP API returns at least one event for this
  // slug. A 200 with an empty array = orphan.
  const url = `${WP_EVENTS_BASE}?slug=${encodeURIComponent(slug)}`;
  const res = await fetch(url);
  if (!res.ok) {
    // Defensive: if the API is down or returning non-200, treat as
    // "exists" so we don't mass-delete on transient WP errors.
    throw new Error(`WP API non-200 for slug=${slug}: ${res.status}`);
  }
  const data = (await res.json()) as unknown[];
  return Array.isArray(data) && data.length > 0;
}

async function countMatches(tournamentId: string): Promise<number> {
  const { count, error } = await supabase
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId);
  if (error) throw new Error(`matches count for ${tournamentId}: ${error.message}`);
  return count ?? 0;
}

async function countWidgets(tournamentId: string): Promise<number> {
  const { count, error } = await supabase
    .schema('padelgod')
    .from('widget_id_cache')
    .select('tournament_id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId);
  if (error) throw new Error(`widget_id_cache count for ${tournamentId}: ${error.message}`);
  return count ?? 0;
}

async function main() {
  // Candidate pool: FIP-source rows without padelapi_id. Anything WITH
  // padelapi_id is a Premier event padelgod doesn't fully own; never
  // delete those.
  const { data, error } = await supabase
    .from('tournaments')
    .select('id, slug, name, starts_at, country, padelapi_id')
    .eq('source', 'fip')
    .is('padelapi_id', null)
    .not('slug', 'is', null);
  if (error) throw new Error(`tournaments fetch: ${error.message}`);
  const candidates = (data ?? []) as TournamentRow[];
  console.error(`Scanning ${candidates.length} FIP-source candidates…`);

  const toDelete: Array<TournamentRow & { matches: number; widgets: number }> = [];

  for (const t of candidates) {
    const matches = await countMatches(t.id);
    if (matches > 0) continue;
    const widgets = await countWidgets(t.id);
    if (widgets > 0) continue;
    // Cheap DB filters passed; spend an HTTP call to the WP API.
    const exists = await fipSlugExists(t.slug);
    if (exists) continue;
    toDelete.push({ ...t, matches, widgets });
  }

  console.log(JSON.stringify(toDelete, null, 2));
  console.error(
    `${APPLY ? 'Will delete' : 'Would delete'} ${toDelete.length} orphan rows.`,
  );

  if (APPLY && toDelete.length > 0) {
    const ids = toDelete.map((t) => t.id);

    // Deletion order matters. Two FKs point at each padelgod.*_snapshots row:
    //   - tournament_id → public.tournaments(id) ON DELETE CASCADE  (indexed)
    //   - scrape_job_id → padelgod.scrape_jobs(id) ON DELETE CASCADE (NOT indexed)
    //
    // Deleting scrape_jobs first triggers the un-indexed cascade and
    // does a full scan per snapshot table per scrape_job_id — blew the
    // statement timeout in prod even on per-id queries. Instead we
    // delete snapshots BY tournament_id first (uses
    // idx_*_snap_tournament). After that, scrape_jobs cascade finds
    // nothing and the DELETE finishes immediately.
    const SNAPSHOT_TABLES = [
      'entry_list_snapshots',
      'oop_snapshots',
      'results_snapshots',
      'draw_snapshots',
    ] as const;
    for (const tbl of SNAPSHOT_TABLES) {
      const { error, count } = await supabase
        .schema('padelgod')
        .from(tbl)
        .delete({ count: 'exact' })
        .in('tournament_id', ids);
      if (error) throw new Error(`DELETE padelgod.${tbl}: ${error.message}`);
      console.error(`  cleared ${count ?? 0} padelgod.${tbl} rows`);
    }

    // scrape_jobs has its own CASCADE to padelgod.raw_payloads (and to
    // the snapshot tables but those are empty now). raw_payloads has
    // idx_raw_payloads_job on scrape_job_id so the cascade is index-
    // eligible. Even so, the IN-clause DELETE has timed out on prod;
    // per-tournament DELETEs land cheaply. We loop one at a time, with
    // a fresh SELECT for the scrape_job ids so the planner has a small,
    // fully-bounded IN list rather than guessing at the tournament FK
    // scan.
    let totalJobs = 0;
    for (const id of ids) {
      const { data: jobRows, error: selErr } = await supabase
        .schema('padelgod')
        .from('scrape_jobs')
        .select('id')
        .eq('tournament_id', id);
      if (selErr) throw new Error(`SELECT scrape_jobs (tournament=${id}): ${selErr.message}`);
      const jobIds = (jobRows ?? []).map((r: { id: string }) => r.id);
      if (jobIds.length === 0) continue;
      // Clear raw_payloads first so the scrape_jobs DELETE has no
      // CASCADE work left to do.
      for (let i = 0; i < jobIds.length; i += 200) {
        const chunk = jobIds.slice(i, i + 200);
        const { error: rpErr } = await supabase
          .schema('padelgod')
          .from('raw_payloads')
          .delete()
          .in('scrape_job_id', chunk);
        if (rpErr) {
          throw new Error(`DELETE raw_payloads (chunk=${chunk.length}, tournament=${id}): ${rpErr.message}`);
        }
      }
      // Now delete the scrape_jobs themselves (PK-indexed).
      for (let i = 0; i < jobIds.length; i += 200) {
        const chunk = jobIds.slice(i, i + 200);
        const { error: sjErr, count } = await supabase
          .schema('padelgod')
          .from('scrape_jobs')
          .delete({ count: 'exact' })
          .in('id', chunk);
        if (sjErr) {
          throw new Error(`DELETE scrape_jobs by id (chunk=${chunk.length}): ${sjErr.message}`);
        }
        totalJobs += count ?? 0;
      }
    }
    console.error(`  cleared ${totalJobs} padelgod.scrape_jobs rows`);

    const { error: delErr, count } = await supabase
      .from('tournaments')
      .delete({ count: 'exact' })
      .in('id', ids);
    if (delErr) throw new Error(`DELETE failed: ${delErr.message}`);
    console.error(`Deleted ${count ?? 'unknown'} tournament rows.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

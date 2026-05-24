#!/usr/bin/env -S npx tsx
/**
 * One-shot hotfix for matches stuck on `scheduled` whose latest
 * `padelgod.results_snapshots` row carries a terminal status
 * (finished / retired / walkover). The blocker is the PostgREST 10k-cap
 * bug in `fip-results-writer.ts::loadLatestResultsRows`; this script
 * applies the same UPDATE + sets UPSERT the writer would have made, but
 * only for the explicit allowlist returned by the audit.
 *
 * Default is dry-run. Pass `--apply` to actually write.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_KEY=… npx tsx scripts/hotfix-stuck-results.ts
 *   SUPABASE_URL=… SUPABASE_SERVICE_KEY=… npx tsx scripts/hotfix-stuck-results.ts --apply
 */

import 'dotenv/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { parseSetScores } from '../padelgod/src/workers/static-reconciler.js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface ActiveTournament {
  tournament_id: string;
  tournament_name: string;
}

interface SnapshotRow {
  match_widget_id: string | null;
  set_scores: string | null;
  winner_team: 1 | 2 | null;
  status: 'finished' | 'walkover' | 'retired';
  captured_at: string;
}

interface MatchRow {
  id: string;
  widget_id_composite: string;
  status: string | null;
  finished_at: string | null;
  started_at: string | null;
  duration: string | null;
}

async function paginatedSelect<T>(
  build: (start: number, end: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  what: string,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  let start = 0;
  while (start < 100_000) {
    const { data, error } = await build(start, start + pageSize - 1);
    if (error) throw new Error(`${what} failed at ${start}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < pageSize) break;
    start += pageSize;
  }
  return out;
}

async function getWidgetIdCode(tournamentId: string): Promise<string | null> {
  const { data, error } = await supabase
    .schema('padelgod')
    .from('widget_id_cache')
    .select('widget_id')
    .eq('tournament_id', tournamentId)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw new Error(`widget_id_cache ${tournamentId}: ${error.message}`);
  return (data?.widget_id as string | undefined) ?? null;
}

async function loadLatestPerWidget(tournamentId: string): Promise<Map<string, SnapshotRow>> {
  const sinceIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const rows = await paginatedSelect<SnapshotRow>(
    (s, e) =>
      supabase
        .schema('padelgod')
        .from('results_snapshots')
        .select('match_widget_id, set_scores, winner_team, status, captured_at')
        .eq('tournament_id', tournamentId)
        .gte('captured_at', sinceIso)
        .order('captured_at', { ascending: false })
        .range(s, e),
    `results_snapshots (tournament=${tournamentId})`,
  );
  const latest = new Map<string, SnapshotRow>();
  for (const r of rows) {
    if (!r.match_widget_id) continue;
    if (!latest.has(r.match_widget_id)) latest.set(r.match_widget_id, r);
  }
  return latest;
}

async function loadMatchesByPrefix(prefix: string): Promise<Map<string, MatchRow>> {
  const { data, error } = await supabase
    .from('matches')
    .select('id, widget_id_composite, status, finished_at, started_at, duration')
    .like('widget_id_composite', `${prefix}%`);
  if (error) throw new Error(`matches like ${prefix}%: ${error.message}`);
  const out = new Map<string, MatchRow>();
  for (const row of (data ?? []) as MatchRow[]) {
    if (row.widget_id_composite) out.set(row.widget_id_composite, row);
  }
  return out;
}

/** Mirror of fip-results-writer's computeFinishedAt fallback chain.
 *  Simplest path: started_at + HH:MM duration → captured_at. */
function computeFinishedAtFallback(
  startedAt: string | null,
  duration: string | null,
  capturedAt: string,
): string {
  if (startedAt && duration) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(duration);
    if (m) {
      const hours = Number(m[1]);
      const mins = Number(m[2]);
      const ts = new Date(startedAt).getTime() + (hours * 60 + mins) * 60_000;
      if (Number.isFinite(ts)) return new Date(ts).toISOString();
    }
  }
  return capturedAt;
}

async function main() {
  const { data: tours, error: toursErr } = await supabase.rpc('padelgod_active_tournaments_with_slug');
  if (toursErr) throw new Error(`active tournaments RPC: ${toursErr.message}`);
  const tournaments = (tours ?? []) as ActiveTournament[];

  let totalMatchesPatched = 0;
  let totalSetsUpserted = 0;
  const skipped: string[] = [];

  for (const t of tournaments) {
    const widgetCode = await getWidgetIdCode(t.tournament_id);
    if (!widgetCode) continue;

    const latest = await loadLatestPerWidget(t.tournament_id);
    if (latest.size === 0) continue;

    const matches = await loadMatchesByPrefix(`${widgetCode}:`);

    for (const [matchWidgetId, snap] of latest) {
      const composite = `${widgetCode}:${matchWidgetId}`;
      const m = matches.get(composite);
      if (!m) continue;
      const currentStatus = m.status ?? 'scheduled';
      if (!['scheduled', 'on_court', 'live'].includes(currentStatus)) continue;
      if (!['finished', 'retired', 'walkover'].includes(snap.status)) continue;

      const retiredPair =
        snap.status === 'retired'
          ? snap.winner_team === 1
            ? 2
            : snap.winner_team === 2
              ? 1
              : null
          : null;

      const nowIso = new Date().toISOString();
      const finishedAt =
        m.finished_at ?? computeFinishedAtFallback(m.started_at, m.duration, snap.captured_at);

      const patch: Record<string, unknown> = {
        status: snap.status,
        winner_pair: snap.winner_team,
        retired_pair: retiredPair,
        finished_at: finishedAt,
        last_updated_by: 'manual-hotfix-10k-cap',
        updated_at: nowIso,
      };

      const parsedSets = snap.set_scores ? parseSetScores(snap.set_scores) : [];

      console.log(
        `[${APPLY ? 'APPLY' : 'DRY '}] ${t.tournament_name} ${composite} → status=${snap.status} winner=${snap.winner_team} retired=${retiredPair} sets=${parsedSets.length}`,
      );

      if (APPLY) {
        const { error: updErr } = await supabase
          .from('matches')
          .update(patch)
          .eq('id', m.id)
          .in('status', ['scheduled', 'on_court', 'live']);
        if (updErr) {
          console.error(`  match update FAILED: ${updErr.message}`);
          skipped.push(composite);
          continue;
        }
        for (const s of parsedSets) {
          const { error: sErr } = await supabase.from('sets').upsert(
            {
              match_id: m.id,
              set_number: s.set_number,
              set_score: s.set_score,
              pair1_games: s.pair1_games,
              pair2_games: s.pair2_games,
              is_current: false,
              score_source: 'api',
              updated_at: nowIso,
            },
            { onConflict: 'match_id,set_number' },
          );
          if (sErr) {
            console.error(`  set ${s.set_number} upsert FAILED: ${sErr.message}`);
            continue;
          }
          totalSetsUpserted += 1;
        }
      } else {
        totalSetsUpserted += parsedSets.length;
      }
      totalMatchesPatched += 1;
    }
  }

  console.log(
    `\n${APPLY ? 'Applied' : 'Would apply'}: ${totalMatchesPatched} match patches, ${totalSetsUpserted} sets upserts${skipped.length ? `, skipped ${skipped.length}: ${skipped.join(', ')}` : ''}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

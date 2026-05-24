#!/usr/bin/env -S npx tsx
/**
 * One-shot audit: find matches whose latest `padelgod.results_snapshots`
 * row says finished/retired/walkover, but `public.matches.status` is
 * still scheduled/live/on_court.
 *
 * This is the operational footprint of the PostgREST 10k-cap bug in
 * `fip-results-writer.ts::loadLatestResultsRows` — when a tournament
 * accumulates >10k snapshot rows, the unranged read silently drops the
 * latest snapshots, leaving today's Finals stuck in 'scheduled'.
 *
 * Run with:
 *   SUPABASE_URL=… SUPABASE_SERVICE_KEY=… npx tsx scripts/audit-stuck-results.ts
 *
 * Output: JSON array printed to stdout with one entry per stuck match.
 */

import 'dotenv/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface ActiveTournament {
  tournament_id: string;
  tournament_name: string;
  slug: string;
}

interface ResultsRow {
  match_widget_id: string | null;
  set_scores: string | null;
  winner_team: 1 | 2 | null;
  status: 'finished' | 'walkover' | 'retired';
  captured_at: string;
  team1_player1_name: string | null;
  team1_player2_name: string | null;
  team2_player1_name: string | null;
  team2_player2_name: string | null;
  round_label: string | null;
}

interface MatchRow {
  id: string;
  widget_id_composite: string;
  status: string | null;
  winner_pair: number | null;
  retired_pair: number | null;
  finished_at: string | null;
  started_at: string | null;
  duration: string | null;
  round: string | null;
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

async function loadLatestPerWidget(tournamentId: string): Promise<Map<string, ResultsRow>> {
  // Only need recent state to find stuck matches — any match that ended
  // more than 24h ago has had plenty of writer runs to catch it. This
  // sidesteps the statement-timeout when paginating very large tournaments.
  const sinceIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const rows = await paginatedSelect<ResultsRow>(
    (s, e) =>
      supabase
        .schema('padelgod')
        .from('results_snapshots')
        .select(
          'match_widget_id, set_scores, winner_team, status, captured_at, ' +
            'team1_player1_name, team1_player2_name, team2_player1_name, team2_player2_name, round_label',
        )
        .eq('tournament_id', tournamentId)
        .gte('captured_at', sinceIso)
        .order('captured_at', { ascending: false })
        .range(s, e),
    `results_snapshots (tournament=${tournamentId})`,
  );
  const latest = new Map<string, ResultsRow>();
  for (const r of rows) {
    if (!r.match_widget_id) continue;
    const key = r.match_widget_id;
    if (!latest.has(key)) latest.set(key, r); // order DESC ⇒ first seen is newest
  }
  return latest;
}

async function loadMatchesByPrefix(prefix: string): Promise<Map<string, MatchRow>> {
  const { data, error } = await supabase
    .from('matches')
    .select('id, widget_id_composite, status, winner_pair, retired_pair, finished_at, started_at, duration, round')
    .like('widget_id_composite', `${prefix}%`);
  if (error) throw new Error(`matches like ${prefix}%: ${error.message}`);
  const out = new Map<string, MatchRow>();
  for (const row of (data ?? []) as MatchRow[]) {
    if (row.widget_id_composite) out.set(row.widget_id_composite, row);
  }
  return out;
}

async function main() {
  const { data: tours, error: toursErr } = await supabase.rpc('padelgod_active_tournaments_with_slug');
  if (toursErr) throw new Error(`active tournaments RPC: ${toursErr.message}`);
  const tournaments = (tours ?? []) as ActiveTournament[];

  const stuck: Array<{
    tournament: string;
    composite: string;
    match_id: string;
    round: string | null;
    match_status: string | null;
    snapshot: ResultsRow;
  }> = [];

  for (const t of tournaments) {
    const widgetCode = await getWidgetIdCode(t.tournament_id);
    if (!widgetCode) continue;

    const latest = await loadLatestPerWidget(t.tournament_id);
    if (latest.size === 0) continue;

    const matches = await loadMatchesByPrefix(`${widgetCode}:`);

    for (const [matchWidgetId, snapshot] of latest) {
      const composite = `${widgetCode}:${matchWidgetId}`;
      const m = matches.get(composite);
      if (!m) continue;
      const isTerminal = ['finished', 'retired', 'walkover'].includes(snapshot.status);
      const matchTerminal = m.status && !['scheduled', 'on_court', 'live'].includes(m.status);
      if (isTerminal && !matchTerminal) {
        stuck.push({
          tournament: t.tournament_name,
          composite,
          match_id: m.id,
          round: m.round,
          match_status: m.status,
          snapshot,
        });
      }
    }
  }

  console.log(JSON.stringify(stuck, null, 2));
  console.error(`\nFound ${stuck.length} stuck matches across ${tournaments.length} active tournaments`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

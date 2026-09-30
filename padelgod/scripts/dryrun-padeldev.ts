/**
 * Read-only dry run for the padeldev live feed.
 *
 * Proves the resolver against a real event without writing anything: fetches
 * the live feed, reads our candidate matches, and reports resolved /
 * unresolved / ambiguous plus the adapted live state.
 *
 * Performs SELECTs only — no INSERT/UPDATE/UPSERT anywhere in this file.
 *
 *   npx tsx scripts/dryrun-padeldev.ts --key <uuid> [--tournament <uuid>]
 *                                      [--name "FIP Platinum Lyon"]
 */
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import { fetchMatchFeed, fetchTournamentFeed } from '../src/lib/padeldev-client.js';
import { flattenTournamentFeed, selectLiveEntries } from '../src/lib/padeldev-feed.js';
import { resolvePadeldevMatch, type CandidateMatch } from '../src/lib/padeldev-resolve.js';
import { padeldevToLiveState } from '../src/lib/padeldev-adapter.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const key = arg('key');
  if (!key) throw new Error('--key <uuid> is required');

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !serviceKey) throw new Error('SUPABASE_URL + SUPABASE_SERVICE_KEY required');
  const supabase = createClient(url, serviceKey);
  const http = axios.create({ timeout: 30_000 });

  // --- locate the tournament -------------------------------------------------
  let tournamentId = arg('tournament');
  if (!tournamentId) {
    const name = arg('name') ?? 'Lyon';
    const { data, error } = await supabase
      .from('tournaments')
      .select('id, name, level, starts_at, ends_at')
      .ilike('name', `%${name}%`)
      .gte('starts_at', '2026-01-01')
      .order('starts_at', { ascending: false })
      .limit(10);
    if (error) throw error;
    console.log('\nTournament candidates:');
    for (const t of data ?? []) {
      console.log(`  ${t.id}  ${t.name}  [${t.level}]  ${t.starts_at} → ${t.ends_at}`);
    }
    tournamentId = (data ?? [])[0]?.id;
    if (!tournamentId) throw new Error('no tournament matched; pass --tournament <uuid>');
    console.log(`\nUsing: ${tournamentId}`);
  }

  // --- our candidate matches -------------------------------------------------
  const { data: rows, error: mErr } = await supabase
    .from('matches')
    .select(
      'id, category, status, court, scheduled_at, ' +
        'pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id, ' +
        'pair1_player1_name, pair1_player2_name, pair2_player1_name, pair2_player2_name, ' +
        'p11:players!matches_pair1_player1_id_fkey(name), ' +
        'p12:players!matches_pair1_player2_id_fkey(name), ' +
        'p21:players!matches_pair2_player1_id_fkey(name), ' +
        'p22:players!matches_pair2_player2_id_fkey(name)',
    )
    .eq('tournament_id', tournamentId);
  if (mErr) throw mErr;

  const joinName = (p: any): string | null =>
    !p ? null : Array.isArray(p) ? (p[0]?.name ?? null) : (p.name ?? null);

  const candidates: CandidateMatch[] = (rows ?? []).map((m: any) => ({
    id: m.id,
    category: m.category,
    pair1Player1Id: m.pair1_player1_id,
    pair1Player2Id: m.pair1_player2_id,
    pair2Player1Id: m.pair2_player1_id,
    pair2Player2Id: m.pair2_player2_id,
    pair1Player1Name: joinName(m.p11) ?? m.pair1_player1_name,
    pair1Player2Name: joinName(m.p12) ?? m.pair1_player2_name,
    pair2Player1Name: joinName(m.p21) ?? m.pair2_player1_name,
    pair2Player2Name: joinName(m.p22) ?? m.pair2_player2_name,
  }));
  console.log(`DB candidate matches: ${candidates.length}`);

  // --- the live feed ---------------------------------------------------------
  const feed = await fetchTournamentFeed(http, key);
  if (!feed) throw new Error('empty tournament feed');
  const all = flattenTournamentFeed(feed);
  // `--all` scores every entry, not just the in-progress ones. The worker only
  // ever touches in-progress matches, but resolving the whole card is a much
  // stronger test of the matcher than the two matches live at this instant.
  const live = process.argv.includes('--all') ? all : selectLiveEntries(all);
  console.log(`feed entries: ${all.length}, selected: ${live.length}\n`);

  const byId = new Map(candidates.map((c) => [c.id, c]));
  let resolved = 0, unresolved = 0, ambiguous = 0, adapted = 0, adaptErrors = 0;

  for (const item of live) {
    const label = `${item.court.padEnd(16)} ${item.entry.category.padEnd(22)} ` +
      `${item.entry.playername1}/${item.entry.playername2} vs ` +
      `${item.entry.playername3}/${item.entry.playername4}`;
    const r = resolvePadeldevMatch(item.entry, candidates);
    if (r === null) { unresolved++; console.log(`  UNRESOLVED  ${label}`); continue; }
    if ('ambiguous' in r) { ambiguous++; console.log(`  AMBIGUOUS   ${label}`); continue; }
    resolved++;
    const c = byId.get(r.matchId);
    console.log(`  OK ${r.orientation}    ${label}`);
    console.log(`       → ${r.matchId}  our: ${c?.pair1Player1Name}/${c?.pair1Player2Name} ` +
      `vs ${c?.pair2Player1Name}/${c?.pair2Player2Name}`);

    try {
      const detail = await fetchMatchFeed(http, item.matchRef);
      if (!detail) { console.log('       ! empty match feed'); continue; }
      const state = padeldevToLiveState(detail, r.matchId, r.orientation);
      adapted++;
      console.log(`       state: ${JSON.stringify(state.pointState)} ` +
        `sets ${JSON.stringify(state.team1Sets.map((s) => s?.games))}-` +
        `${JSON.stringify(state.team2Sets.map((s) => s?.games))} ` +
        `serving=${state.servingTeam} status=${state.status}`);
    } catch (e: any) {
      adaptErrors++;
      console.log(`       ! adapt failed: ${e.message}`);
    }
  }

  console.log(`\n=== resolved=${resolved} unresolved=${unresolved} ambiguous=${ambiguous} ` +
    `adapted=${adapted} adaptErrors=${adaptErrors} ===`);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });

/** Read-only Melilla preflight. Run with tsx --env-file=../.env.local. */
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import { fetchResultsFeed } from '../src/lib/puntuate-client.js';
import { resolvePuntuateMatch } from '../src/lib/puntuate-resolve.js';
import { puntuateToLiveState } from '../src/lib/puntuate-adapter.js';
import { loadCandidates } from '../src/workers/puntuate-live-fetcher.js';
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Supabase URL and service key required');
const db = createClient(url, key, { auth: { persistSession: false } });
let tournamentId = process.argv[2];
if (!tournamentId) {
  const { data, error } = await db.from('tournaments').select('id,name,starts_at').ilike('name', '%melilla%').gte('starts_at', '2026-10-01').lt('starts_at', '2026-11-01');
  if (error) throw new Error(error.message);
  if (data?.length !== 1) throw new Error(`Expected one Melilla tournament; supply UUID explicitly. Candidates: ${JSON.stringify(data)}`);
  tournamentId = data[0]!.id;
}
const feed = await fetchResultsFeed(axios.create(), process.argv[3] ?? 'https://fipmelilla.puntuate.com/ordenJuegoFip.aspx?idTorneo=2310');
const candidates = await loadCandidates(db, tournamentId!);
let resolved = 0, unresolved = 0, ambiguous = 0, errors = 0;
for (const row of feed.filter(r => r.status === 'Live')) {
  const match = resolvePuntuateMatch(row, candidates);
  if (!match) { unresolved++; console.log('UNRESOLVED', row.teamA, row.teamB); continue; }
  if ('ambiguous' in match) { ambiguous++; console.log('AMBIGUOUS', row.teamA, row.teamB); continue; }
  try {
    const state = row.setsA.length === 0 && row.setsB.length === 0
      ? { matchId: match.matchId, status: 'live', scores: 'not yet published' }
      : puntuateToLiveState(row, match.matchId, match.orientation);
    resolved++;
    console.log('LIVE OK', row.teamA, 'vs', row.teamB, JSON.stringify(state));
  } catch (err) { errors++; console.log('ADAPT ERROR', String(err)); }
}
console.log(JSON.stringify({ tournamentId, feedRows: feed.length, candidates: candidates.length, resolved, unresolved, ambiguous, errors, readOnly: true }));
if (unresolved || ambiguous || errors) process.exitCode = 1;

// Read-only pre-flight of the webtuga pipeline against the LIVE feed + real DB.
// Writes NOTHING. Exercises the real modules (client → resolve → adapt → diff)
// so you can validate resolution + live adaptation before enabling the worker.
//
// Usage (from padelgod/):
//   set -a; source ../../../../.env.local; set +a    # or your own env
//   npx tsx scripts/dryrun-webtuga.mjs <tournamentId> <baseUrl>
// Defaults to the FIP Platinum Lusitania event if args are omitted.
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import { fetchResultsFeed } from '../src/lib/webtuga-client.ts';
import { resolveWebtugaMatch } from '../src/lib/webtuga-resolve.ts';
import { webtugaToLiveState } from '../src/lib/webtuga-adapter.ts';
import { diffLiveState } from '../src/lib/live-state.ts';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Set SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_KEY (source .env.local).');
  process.exit(1);
}

const TID = process.argv[2] ?? '8d5e9a69-f2d9-473d-bc2e-42334e2e8096'; // FIP Platinum Lusitania
const BASE = process.argv[3] ?? 'https://portugalmasterpadel.win.webtuga.net';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
const http = axios.create({ timeout: 15000, headers: { 'User-Agent': 'padelgod-webtuga-dryrun' } });

const feed = await fetchResultsFeed(http, BASE);
const { data: rows } = await supabase
  .from('matches')
  .select('id, category, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id, pair1_player1_name, pair1_player2_name, pair2_player1_name, pair2_player2_name, p11:players!matches_pair1_player1_id_fkey(name), p12:players!matches_pair1_player2_id_fkey(name), p21:players!matches_pair2_player1_id_fkey(name), p22:players!matches_pair2_player2_id_fkey(name)')
  .eq('tournament_id', TID);
const jn = (p) => !p ? null : Array.isArray(p) ? (p[0]?.name ?? null) : (p.name ?? null);
const candidates = (rows ?? []).map((m) => ({
  id: m.id, category: m.category,
  pair1Player1Id: m.pair1_player1_id, pair1Player2Id: m.pair1_player2_id,
  pair2Player1Id: m.pair2_player1_id, pair2Player2Id: m.pair2_player2_id,
  pair1Player1Name: jn(m.p11) ?? m.pair1_player1_name, pair1Player2Name: jn(m.p12) ?? m.pair1_player2_name,
  pair2Player1Name: jn(m.p21) ?? m.pair2_player1_name, pair2Player2Name: jn(m.p22) ?? m.pair2_player2_name,
}));

let resolved = 0, ambiguous = 0, unresolved = 0, live = 0, adaptOk = 0, adaptErr = 0;
console.log(`feed rows: ${feed.length} | DB candidates: ${candidates.length}\n`);
for (const r of feed) {
  const res = resolveWebtugaMatch(r, candidates);
  const tag = `#${r.id} [${r.status}] ${r.teamA} vs ${r.teamB}`;
  if (res === null) { unresolved++; console.log(`UNRESOLVED ${tag}`); continue; }
  if ('ambiguous' in res) { ambiguous++; console.log(`AMBIGUOUS  ${tag}`); continue; }
  resolved++;
  if (String(r.status).toLowerCase() === 'live') {
    live++;
    try {
      const curr = webtugaToLiveState(r, res.matchId, res.orientation);
      const diff = diffLiveState(null, curr); // prev=null first-tick
      adaptOk++;
      const cur = curr.team1Sets.at(-1);
      console.log(`LIVE→OK    ${tag}\n     match=${res.matchId} orient=${res.orientation} sets1=[${curr.team1Sets.map(s=>s?.games).join(',')}] pt=${JSON.stringify(curr.pointState)} diffPts=${diff.pointsAdded.length}`);
    } catch (e) { adaptErr++; console.log(`LIVE→ERR   ${tag}  (${e.message})`); }
  } else {
    console.log(`OK         ${tag} → ${res.matchId} (${res.orientation})`);
  }
}
console.log(`\nSUMMARY  resolved=${resolved} ambiguous=${ambiguous} unresolved=${unresolved} | liveSeen=${live} adaptOk=${adaptOk} adaptErr=${adaptErr}`);
console.log('(read-only — no DB writes)');

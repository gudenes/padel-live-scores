/** Read-only preflight. No aliases, player records, scores or notifications written.
 * node --env-file=../.env.local --import tsx scripts/dryrun-courtbit.ts <UUID> <URL> <event name>
 * Replay a captured read-only snapshot: --snapshot <path> (no credentials needed).
 */
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import { parseCourtbitFeed, CourtbitClient, courtbitPlayerKey } from '../src/lib/courtbit-client.js';
import { courtbitToSnapshot } from '../src/lib/courtbit-adapter.js';
import { loadCourtbitContext, resolveCourtbitMatch, resolveCourtbitPlayer, type CourtbitContext } from '../src/lib/courtbit-resolve.js';
import { normalizeIdentity } from '../src/lib/strict-player-resolver.js';

const args = process.argv.slice(2);
let ctx: CourtbitContext;
let feed;
if (args[0] === '--snapshot') {
  const input = JSON.parse(await readFile(args[1]!, 'utf8'));
  feed = parseCourtbitFeed(input.feed, input.feed.name);
  const aliases = new Map<string, string[]>();
  for (const a of input.aliases) {
    const key = normalizeIdentity(a.external_id);
    aliases.set(key, [...(aliases.get(key) ?? []), a.entity_id]);
  }
  ctx = { players: input.players.filter((p: any) => p.tier !== 'amateur').map((p: any) => ({ ...p, fipId: p.fip_id, externalId: p.external_id })), aliases,
    matches: input.matches, cache: new Map(), mappings: new Map((input.playerMappings ?? []).map((m: any) => [m.external_id, { id: m.entity_id, metadata: m.metadata }])) };
} else {
  const [tournamentId, url, name] = args;
  if (!tournamentId || !url || !name) throw new Error('Supply tournament UUID, CourtBit URL and exact event name, or --snapshot path');
  const dbUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!dbUrl || !key) throw new Error('Supabase configuration required');
  const db = createClient(dbUrl, key, { auth: { persistSession: false } });
  ctx = await loadCourtbitContext(db, tournamentId);
  feed = (await new CourtbitClient().fetch(axios.create(), url, name)).feed;
}
const playerIssues: unknown[] = [], matchIssues: unknown[] = [];
const seen = new Set<string>();
let resolvedPlayers = 0, resolvedMatches = 0, liveReady = 0, scoreErrors = 0;
for (const row of feed.matches) {
  const category = row.category === 'Femenino' ? 'women' : 'men';
  for (const p of [...row.a.players, ...row.b.players]) {
    const key = `${category}:${courtbitPlayerKey(p)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const result = resolveCourtbitPlayer(p, category, ctx);
    if (result.found) resolvedPlayers++;
    else playerIssues.push({ name: p.name, country: p.country, slug: p.slug, ...result });
  }
  const match = resolveCourtbitMatch(row, ctx);
  if (!match.ok) { matchIssues.push({ providerId: row.id, status: row.status, ...match }); continue; }
  resolvedMatches++;
  if (row.status !== 'live' && row.status !== 'done') continue;
  try {
    courtbitToSnapshot(row, match.matchId, match.orientation);
    if (row.status === 'live' && ['scheduled', 'live', 'on_court'].includes(match.status)) liveReady++;
  } catch (err) { scoreErrors++; matchIssues.push({ providerId: row.id, reason: String(err) }); }
}
console.log(JSON.stringify({ readOnly: true, event: feed.name, feedMatches: feed.matches.length,
  players: seen.size, resolvedPlayers, unresolvedPlayers: playerIssues.length,
  resolvedMatches, liveSeen: feed.matches.filter(r => r.status === 'live').length, liveReady,
  scoreErrors, rejectedRows: feed.rejected, playerIssues, matchIssues }, null, 2));
if (playerIssues.length || matchIssues.length || scoreErrors || feed.rejected) process.exitCode = 1;

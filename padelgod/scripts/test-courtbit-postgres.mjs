/** Isolated real-Postgres (WASM) transaction tests. Never connects to Supabase.
 * node scripts/test-courtbit-postgres.mjs [path-to-pglite-dist-index.js]
 * Optional test dependency: @electric-sql/pglite@0.3.14.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create table matches(id uuid primary key, tournament_id uuid, status text, updated_at timestamptz,
 pair1_player1_id uuid, pair1_player2_id uuid, pair2_player1_id uuid, pair2_player2_id uuid,
 category text default 'women', pair1_player1_name text, pair1_player2_name text, pair2_player1_name text, pair2_player2_name text,
 pair1_player1_country text, pair1_player2_country text, pair2_player1_country text, pair2_player2_country text);
create table sets(id uuid primary key default gen_random_uuid(), match_id uuid references matches(id),
 set_number int, pair1_games int, pair2_games int, set_score text, is_current boolean, score_source text, updated_at timestamptz,
 unique(match_id,set_number));
create table games(id uuid primary key default gen_random_uuid(), match_id uuid references matches(id), set_id uuid references sets(id),
 game_number int, game_score text, is_current boolean, is_tiebreak boolean, server_player_id uuid, points text[], updated_at timestamptz,
 unique(set_id,game_number));
create table match_points(id uuid primary key default gen_random_uuid(), match_id uuid, set_id uuid, game_id uuid,
 point_number int, winner_pair int, score_after text, source text, unique(game_id,point_number));
create table entity_external_ids(id uuid primary key default gen_random_uuid(), entity_type text, entity_id uuid, source text,
 external_id text, metadata jsonb, last_seen_at timestamptz, unique(source,entity_type,external_id));
create unique index entity_external_ids_entity_source_nonalias_uk on entity_external_ids(entity_type,entity_id,source) where source <> 'alias';
`);
await db.exec(await readFile(new URL('../../supabase/migrations/20261117180000_courtbit_live_snapshots.sql', import.meta.url), 'utf8'));
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const players = [1, 2, 3, 4].map(uid), tournament = uid(10), match = uid(20);
await db.query('insert into matches(id,tournament_id,status,updated_at,pair1_player1_id,pair1_player2_id,pair2_player1_id,pair2_player2_id) values ($1,$2,\'scheduled\',now(),$3,$4,$5,$6)', [match,tournament,...players]);
const links = players.map((playerId, i) => ({ playerId, slug: `player-${i}`, name: `Player ${i}`, country: 'ESP', category: 'women' }));
const initial = { participants: links, status: 'live', orientation: 'AB', providerPlayers: links.map(p => p.slug),
  sets: [{ number: 1, a: 4, b: 6, score: '4-6', current: false }, { number: 2, a: 1, b: 5, score: null, current: true }],
  game: { set: 2, number: 7, score: '15-40', tiebreak: false, servingPair: 1 }, liveState: null };
const apply = async (prev, snapshot, winner = null, other = {}) => {
  const names = (await db.query('select pair1_player1_name as a,pair1_player2_name as b,pair2_player1_name as c,pair2_player2_name as d from matches where id=$1',[match])).rows[0];
  return (await db.query(
    'select apply_courtbit_snapshot($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as result',
    [tournament,match,'oj_test',other.players ?? players,prev,snapshot,other.links ?? links,other.names ?? Object.values(names),other.observedAt ?? new Date().toISOString(),winner])).rows[0].result;
};
try {
  assert.deepEqual(await apply(null, initial), { applied: true, notify: true });
  assert.equal((await db.query('select count(*)::int as n from sets')).rows[0].n, 2);
  assert.equal((await db.query('select count(*)::int as n from match_points')).rows[0].n, 0);
  assert.equal((await db.query('select game_score from games')).rows[0].game_score, '15-40');
  assert.equal((await db.query('select server_player_id from games')).rows[0].server_player_id, null);
  assert.equal((await db.query('select serving_pair from games')).rows[0].serving_pair, 1);
  assert.equal((await apply(initial, initial)).reason, 'unchanged');
  assert.equal((await apply(initial, { ...initial, sets: [], game: null })).reason, 'scores_unpublished');
  const next = { ...initial, game: { ...initial.game, score: '30-40' } };
  assert.deepEqual(await apply(initial, next, 1), { applied: true, notify: false });
  assert.equal((await apply(initial, next, 1)).reason, 'state_changed');
  assert.equal((await db.query('select count(*)::int as n from match_points')).rows[0].n, 1);
  assert.equal((await apply(next, initial, null, { players: [...players].reverse() })).reason, 'players_changed');
  assert.equal((await apply(next, initial, null, { observedAt: '2000-01-01T00:00:00Z' })).reason, 'stale_snapshot');
  // Failure late in the transaction rolls back BOTH scores and cache.
  await db.exec("create function fail_points() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end $$; create trigger fail_point before insert on match_points for each row execute function fail_points();");
  const failed = { ...next, game: { ...next.game, score: '40-40' } };
  const failedThin = { ...failed, participants: links.map((p,i) => i===0 ? {...p,playerId:null} : p) };
  await assert.rejects(apply(next, failedThin, 1, {links:links.slice(1)}), /injected failure/);
  assert.equal((await db.query('select pair1_player1_id from matches')).rows[0].pair1_player1_id, players[0]);
  await assert.rejects(apply(next, failed, 1), /injected failure/);
  assert.equal((await db.query('select game_score from games')).rows[0].game_score, '30-40');
  assert.deepEqual((await db.query("select metadata->'snapshot' as s from entity_external_ids where source='courtbit'")).rows[0].s, next);
  await db.exec('drop trigger fail_point on match_points');
  assert.deepEqual(await apply(next, failed, 1), { applied: true, notify: false });
  assert.equal((await db.query('select count(*)::int as n from match_points')).rows[0].n, 2);
  const done = { ...failed, status: 'done', sets: [{ number: 1,a:4,b:6,score:'4-6',current:false },{ number:2,a:1,b:6,score:'1-6',current:false }], game: null };
  assert.deepEqual(await apply(failed, done), { applied: true, notify: false });
  assert.equal((await db.query('select status from matches')).rows[0].status, 'live');
  assert.equal((await db.query('select count(*)::int as n from games where is_current')).rows[0].n, 0);
  assert.equal((await apply(done, initial)).reason, 'provider_completed');
  await db.exec("update matches set status='finished'; update sets set score_source='api'");
  assert.equal((await apply(done, initial)).reason, 'terminal');
  assert.equal((await db.query('select set_score from sets where set_number=2')).rows[0].set_score, '1-6');
  // Thin identities still commit scores; unresolved slots get no provider mapping.
  await db.exec("delete from entity_external_ids; delete from match_points; delete from games; delete from sets; update matches set status='scheduled'");
  const thin = { ...initial, participants: links.map((p,i) => i===0 ? {...p,playerId:null} : p) };
  const thinLinks = links.slice(1), thinIds = [null,...players.slice(1)];
  assert.deepEqual(await apply(null, thin, null, {links:thinLinks}), {applied:true,notify:true});
  const stored = (await db.query('select pair1_player1_id,pair1_player1_name from matches')).rows[0];
  assert.deepEqual(stored,{pair1_player1_id:null,pair1_player1_name:'Player 0'});
  assert.equal((await db.query("select count(*)::int n from entity_external_ids where entity_type='player'")).rows[0].n,3);
  assert.equal((await db.query("select metadata->'identityBefore'->'ids' as ids from entity_external_ids where source='courtbit'")).rows[0].ids[0],players[0]);
  assert.equal((await apply(thin, thin, null, {players:thinIds,links:thinLinks})).reason,'unchanged');
  assert.equal((await apply(thin, initial, null, {players:thinIds,names:['Someone else',null,null,null]})).reason,'players_changed');
  // A subsequent confirmed resolution fills the profile without resending start.
  assert.deepEqual(await apply(thin, initial, null, {players:thinIds}),{applied:true,notify:false});
  assert.equal((await db.query('select pair1_player1_id from matches')).rows[0].pair1_player1_id,players[0]);
  await db.exec("delete from entity_external_ids; update matches set status='scheduled'");
  const allThin={...initial,participants:links.map(p=>({...p,playerId:null}))};
  assert.deepEqual(await apply(null,allThin,null,{links:[]}),{applied:true,notify:true});
  assert.equal((await db.query("select count(*)::int n from entity_external_ids where entity_type='player'")).rows[0].n,0);
  assert.equal((await db.query('select pair1_player1_id from matches')).rows[0].pair1_player1_id,null);
  const perms = await db.query("select has_function_privilege('anon','apply_courtbit_snapshot(uuid,uuid,text,uuid[],jsonb,jsonb,jsonb,text[],timestamptz,integer)','EXECUTE') as anon, has_function_privilege('authenticated','apply_courtbit_snapshot(uuid,uuid,text,uuid[],jsonb,jsonb,jsonb,text[],timestamptz,integer)','EXECUTE') as authenticated");
  assert.deepEqual(perms.rows[0], { anon: false, authenticated: false });
  console.log('CourtBit PostgreSQL assertions passed: bootstrap, retry, CAS, identity, thin profiles, late resolution, stale snapshots, rollback, final precedence, access control.');
} finally { await db.close(); }

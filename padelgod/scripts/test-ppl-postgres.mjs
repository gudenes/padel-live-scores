/** Isolated PostgreSQL/WASM. Never connects to Supabase.
 * node scripts/test-ppl-postgres.mjs <path-to-pglite/dist/index.js>
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : '@electric-sql/pglite');
const db = new PGlite();
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const ids = [1, 2, 3, 4].map(uid), tour = uid(10), tie = uid(11), match = uid(12), home = uid(20), away = uid(21);
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table tournaments(id uuid primary key default gen_random_uuid(), source text,external_id text unique,level text,name text,starts_at timestamptz,ends_at timestamptz);
    create table players(id uuid primary key,category text);
    create table teams(id uuid primary key,source text,external_id text);
    create table team_seasons(id uuid primary key,team_id uuid,league text,season_year int,ties_played int,ties_won int,courts_won int,courts_lost int);
    create table team_memberships(team_season_id uuid,player_id uuid,games_played int,wins int,losses int,unique(team_season_id,player_id));
    create table league_ties(id uuid primary key default gen_random_uuid(),tournament_id uuid,tie_key text,home_team_season_id uuid,away_team_season_id uuid,
      stage text,session_number int,scheduled_at timestamptz,unique(tournament_id,tie_key));
    create table matches(id uuid primary key default gen_random_uuid(),tournament_id uuid,tie_id uuid,category text,status text,winner_pair int,round text,scheduled_at timestamptz,
      pair1_player1_id uuid,pair1_player2_id uuid,pair2_player1_id uuid,pair2_player2_id uuid,
      started_at timestamptz,finished_at timestamptz,updated_at timestamptz);
    create table sets(id uuid primary key default gen_random_uuid(),match_id uuid references matches(id),set_number int,
      pair1_games int,pair2_games int,set_score text,is_current boolean,score_source text,updated_at timestamptz,unique(match_id,set_number));
    create table games(id uuid primary key default gen_random_uuid(),match_id uuid,set_id uuid references sets(id),game_number int,
      game_score text,is_current boolean,is_tiebreak boolean,serving_pair int,updated_at timestamptz,unique(set_id,game_number));
    create table entity_external_ids(id uuid primary key default gen_random_uuid(),entity_type text,entity_id uuid,source text,
      external_id text,metadata jsonb,last_seen_at timestamptz,unique(source,entity_type,external_id));
    create unique index entity_source_unique on entity_external_ids(entity_type,entity_id,source) where source<>'alias';
  `);
  await db.exec(await readFile(new URL('../../supabase/migrations/20261118120000_ppl_live_snapshots.sql', import.meta.url), 'utf8'));
  await db.query("insert into tournaments(id,source,external_id,level) values($1,'ppl','playa-del-carmen','ppl')", [tour]);
  for (const id of ids) await db.query("insert into players values($1,'women')", [id]);
  for (const [id,slug] of [[home,'home'],[away,'away']]) {
    await db.query("insert into teams values($1,'ppl',$2)",[id,slug]);
    await db.query("insert into team_seasons(id,team_id,league,season_year) values($1,$1,'ppl',2026)", [id]);
  }
  const key = 'Group Stage|1|home|away';
  await db.query('insert into league_ties(id,tournament_id,tie_key,home_team_season_id,away_team_season_id) values($1,$2,$3,$4,$5)', [tie, tour, key, home, away]);
  await db.query("insert into matches(id,tournament_id,tie_id,category,status) values($1,$2,$3,'women','scheduled')", [match,tour,tie]);
  const event={slug:'playa-del-carmen',name:'Playa del Carmen',league:'ppl',startsAt:'2026-09-24',endsAt:'2026-09-27'};
  const fixtures=[{id:'match-1',home:'home',away:'away',stage:'Group Stage',session:1,category:'women',scheduledAt:'2026-09-26T14:00:00Z'}];
  const reconcile = async (e=event,f=fixtures)=>(await db.query('select reconcile_ppl_event($1,$2) id',[e,f])).rows[0].id;
  assert.equal(await reconcile(),tour); assert.equal(await reconcile(),tour);
  assert.equal((await db.query('select count(*) n from matches')).rows[0].n,1);
  await assert.rejects(reconcile(event,[{...fixtures[0],home:'unknown'}]),/no rows/);
  const initial = { providerId: 'match-1', tournamentSlug: 'playa-del-carmen', league: 'ppl', category: 'women',status:'live',
    revision:'2026-09-26T15:00:00Z',startedAt:'2026-09-26T14:00:00Z',finishedAt:null,winner:null,
    players: ids.map((_,i)=>({slug:`player-${i}`,name:`Player ${i}`,category:'women'})),
    sets:[{number:1,a:2,b:3,current:true,matchTiebreak:false}],game:{set:1,number:6,score:'30-40',tiebreak:false,servingPair:1} };
  const apply = async (s, oldPlayers = ids, extra={}) => (await db.query(
    'select apply_ppl_snapshot($1,$2,$3,$4,$5,$6) result',[tour,match,extra.key??key,oldPlayers,ids,s])).rows[0].result;
  assert.equal((await apply(initial,[null,null,null,null])).applied,true);
  assert.equal((await apply(initial)).reason,'unchanged');
  assert.equal((await apply({...initial,revision:'2026-09-26T14:59:00Z'})).reason,'stale_snapshot');
  assert.equal((await db.query('select game_score from games')).rows[0].game_score,'30-40');
  assert.equal((await db.query('select status from matches')).rows[0].status,'live');
  await assert.rejects(apply({...initial,revision:'2026-09-26T15:01:00Z'},ids,{key:'wrong'}),/identity conflict/);
  const finished={...initial,status:'finished',revision:'2026-09-26T16:00:00Z',finishedAt:'2026-09-26T15:59:00Z',winner:1,game:null,
    sets:[{number:1,a:6,b:4,current:false,matchTiebreak:false},{number:2,a:6,b:4,current:false,matchTiebreak:false}]};
  // Deliberately fail the final derived-statistics write. EVERYTHING must roll back.
  await db.exec("create function fail_stats() returns trigger language plpgsql as $$ begin raise exception 'test rollback'; end $$; create trigger fail_stats before insert on team_memberships for each row execute function fail_stats();");
  await assert.rejects(apply(finished),/test rollback/);
  assert.equal((await db.query('select status from matches')).rows[0].status,'live');
  assert.equal((await db.query('select count(*) n from sets')).rows[0].n,1);
  await db.exec('drop trigger fail_stats on team_memberships');
  assert.equal((await apply(finished)).applied,true);
  assert.equal((await apply(finished)).reason,'unchanged');
  assert.deepEqual((await db.query('select status,winner_pair from matches')).rows[0],{status:'finished',winner_pair:1});
  assert.equal((await db.query('select count(*) n from team_memberships')).rows[0].n,4);
  assert.equal((await db.query('select wins from team_memberships where player_id=$1',[ids[0]])).rows[0].wins,1);
  assert.equal((await db.query('select ties_won from team_seasons where id=$1',[home])).rows[0].ties_won,1);
  assert.equal((await db.query('select count(*) n from games where is_current')).rows[0].n,0);
  assert.equal((await apply({...initial,revision:'2026-09-26T17:00:00Z'})).reason,'terminal');
  assert.equal((await db.query("select count(*) n from entity_external_ids where entity_type='match'")).rows[0].n,2);
  const next={...event,slug:'las-vegas-2026',name:'Las Vegas',startsAt:'2026-11-18',endsAt:'2026-11-21'};
  const nextFixtures=[{...fixtures[0],id:'vegas-match',scheduledAt:'2026-11-19T01:00:00Z'}];
  const newId=await reconcile(next,nextFixtures); assert.notEqual(newId,tour); assert.equal(await reconcile(next,nextFixtures),newId);
  assert.equal((await db.query('select count(*) n from matches')).rows[0].n,2);
  console.log('PASS PPL local PostgreSQL: onboarding/relink without duplicates, live/final, identity guards, stale/retry, atomic rollback, player/team history');
} finally { await db.close(); }

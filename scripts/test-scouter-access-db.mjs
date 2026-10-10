// Run with PGLITE_MODULE pointing to an isolated @electric-sql/pglite installation.
import {readFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite')
const db=new PGlite()
const admin='11111111-1111-4111-8111-111111111111', a='22222222-2222-4222-8222-222222222222',b='33333333-3333-4333-8333-333333333333',match='44444444-4444-4444-8444-444444444444'
await db.exec(`create role anon;create role authenticated;create role service_role;
create table public.users(id uuid primary key,email text,"emailVerified" timestamptz);
create table public.operators(user_id uuid primary key references public.users);
create table public.matches(id uuid primary key);
insert into public.users values('${admin}','owner@test',now()),('${a}','a@test',now()),('${b}','b@test',now());
insert into public.operators values('${admin}');
insert into public.matches values('${match}');`)
for(const file of ['20261004130000_operator_scouting.sql','20261006120000_video_scouting_sessions.sql','20261008120000_private_scouting_matches.sql','20261009120000_scouter_access.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'))
await db.query("insert into scouting_staff_grants(email,user_id,granted_by) values('a@test',$1,$2),('b@test',$3,$2)",[a,admin,b])
const values={match_id:match,revision:1,write_id:match,document:{rallies:[]},score:{},stats:[],players:[],updated_by:'a@test',updated_by_user_id:a,creator_user_id:a,assigned_scouter_user_id:a}
const insert=async(table,row)=>{const keys=Object.keys(row);return db.query('insert into '+table+' ('+keys.join(',')+') values('+keys.map((_,i)=>'$'+(i+1)).join(',')+')',Object.values(row))}
await insert('operator_video_scouting_sessions',values)
await assert.rejects(()=>db.query('update operator_video_scouting_sessions set updated_by_user_id=$1,revision=2 where match_id=$2',[b,match]),/assigned/)
await assert.rejects(()=>db.query('update operator_video_scouting_sessions set creator_user_id=$1 where match_id=$2',[b,match]),/immutable/)
await db.query('update operator_video_scouting_sessions set revision=2 where match_id=$1',[match])
await db.query("update scouting_staff_grants set status='suspended' where user_id=$1",[a])
await assert.rejects(()=>db.query('update operator_video_scouting_sessions set revision=3 where match_id=$1',[match]),/revoked/)
await db.query('update operator_video_scouting_sessions set assigned_scouter_user_id=$1,updated_by_user_id=$2,revision=3 where match_id=$3',[b,admin,match])
await db.query("update scouting_staff_grants set status='active' where user_id=$1",[a])
await assert.rejects(()=>db.query('update operator_video_scouting_sessions set updated_by_user_id=$1,revision=4 where match_id=$2',[a,match]),/assigned/)
await db.query('update operator_video_scouting_sessions set updated_by_user_id=$1,revision=4 where match_id=$2',[b,match])
await assert.rejects(()=>db.query('update operator_video_scouting_sessions set updated_by_user_id=null where match_id=$1',[match]),/actor/)
const final=(await db.query('select * from operator_video_scouting_sessions')).rows[0]
assert.equal(final.creator_user_id,a);assert.equal(final.assigned_scouter_user_id,b);assert.equal(final.revision,4)
assert.deepEqual(final.document,values.document)
assert.equal((await db.query("select count(*)::int as n from scouting_access_audit where action='session.reassigned'")).rows[0].n,1)
await db.query("insert into operator_manual_scouting_matches(id,players,request_hash,created_by) values($1,'[{},{},{},{}]','hash','owner')",[match])
await insert('operator_manual_video_scouting_sessions',{...values,updated_by_user_id:b,creator_user_id:b,assigned_scouter_user_id:b})
await assert.rejects(()=>db.query('update operator_manual_video_scouting_sessions set updated_by_user_id=$1',[a]),/assigned/)
assert.equal((await db.query('select count(*)::int as n from operators')).rows[0].n,1)
await db.exec("create table public.tournaments(id uuid primary key,name text); alter table public.matches add column scheduled_at timestamptz, add column tournament_id uuid;")
const library=await readFile(new URL('../apps/ops/src/app/(scouting)/scouting/page.tsx',import.meta.url),'utf8')
const libraryQuery=library.match(/const result=await pgPool\(\).query\(`([\s\S]*?)`,\[q/)[1]
assert.equal((await db.query(libraryQuery,['','','','','',0])).rows.length,2)
assert.equal((await db.query(libraryQuery,['','','private','','',0])).rows.length,1)
assert.equal((await db.query(libraryQuery,['','','','b@test','',0])).rows.length,2)
assert.equal((await db.query(libraryQuery,['no-such-player','','','','',0])).rows.length,0)
console.log('PASS: migrations, canonical/private ownership, corrections, revocation, reassignment, immutable creator, audit and preserved documents')

// Role transitions must take effect at the database write, even for an existing session.
for(const table of ['operator_video_scouting_sessions','operator_manual_video_scouting_sessions']){
 await db.query("update scouting_staff_grants set role='viewer' where user_id=$1",[b])
 await assert.rejects(()=>db.query('update '+table+' set updated_by_user_id=$1',[b]),/revoked/)
 await db.query("update scouting_staff_grants set role='admin' where user_id=$1",[a])
 await db.query('update '+table+' set updated_by_user_id=$1',[a])
 await db.query("update scouting_staff_grants set role='scouter' where user_id=$1",[a])
 await assert.rejects(()=>db.query('update '+table+' set updated_by_user_id=$1',[a]),/assigned/)
}
console.log('PASS: Viewer write denial, delegated Administrator writes and immediate demotion enforcement')
await db.close()

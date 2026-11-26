import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { beforeAll, afterAll, it, expect } from 'vitest'
const db=new PGlite()
const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
beforeAll(async()=>{
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO anon,authenticated;
 CREATE FUNCTION public.claim_match_stats_candidates(uuid[] DEFAULT NULL) RETURNS void LANGUAGE sql AS 'SELECT NULL::void';
 CREATE TABLE matches(id uuid PRIMARY KEY,widget_id_composite text UNIQUE,status text,finished_at timestamptz);
 CREATE TABLE entity_external_ids(entity_type text,entity_id uuid,source text,external_id text,first_seen_at timestamptz DEFAULT now(),last_seen_at timestamptz DEFAULT now(),UNIQUE(source,entity_type,external_id),UNIQUE(entity_type,entity_id,source));
 CREATE TABLE match_stats_fetch_state(match_id uuid PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,next_attempt_at timestamptz NOT NULL);`)
 await db.query(`INSERT INTO entity_external_ids(entity_type,entity_id,source,external_id) VALUES('match',$1,'crionet_widget','FIP-2026-4801:MD003')`,[id(999)])
 await db.exec(readFileSync('supabase/migrations/20261126150000_match_stats_ingestion_guardrails.sql','utf8'))
 await db.exec(readFileSync('supabase/migrations/20261126151500_restrict_stats_maintenance_rpcs.sql','utf8'))
},30000)
afterAll(()=>db.close())
it('links draw-only inserts atomically, skips synthetic IDs, and preserves existing identity',async()=>{
 await db.query(`INSERT INTO matches VALUES($1,'FIP-2026-4801:MD001','scheduled',null)`,[id(1)])
 expect((await db.query('SELECT entity_id FROM entity_external_ids WHERE entity_id=$1',[id(1)])).rows).toEqual([{entity_id:id(1)}])
 await db.query(`UPDATE matches SET widget_id_composite=widget_id_composite WHERE id=$1`,[id(1)])
 expect((await db.query('SELECT * FROM entity_external_ids')).rows).toHaveLength(2)
 await db.query(`INSERT INTO matches VALUES($1,'draw:men:main:F:1','scheduled',null)`,[id(2)])
 expect((await db.query('SELECT * FROM entity_external_ids')).rows).toHaveLength(2)
})
it('repairs a deleted-owner mapping but rejects stealing a living match identity',async()=>{
 await db.query(`INSERT INTO matches VALUES($1,'FIP-2026-4801:MD003','scheduled',null)`,[id(3)])
 expect((await db.query(`SELECT entity_id FROM entity_external_ids WHERE external_id='FIP-2026-4801:MD003'`)).rows).toEqual([{entity_id:id(3)}])
 await db.query(`INSERT INTO matches VALUES($1,null,'scheduled',null)`,[id(4)])
 await db.query(`INSERT INTO entity_external_ids(entity_type,entity_id,source,external_id) VALUES('match',$1,'crionet_widget','FIP-2026-4801:MD004')`,[id(4)])
 await expect(db.query(`INSERT INTO matches VALUES($1,'FIP-2026-4801:MD004','scheduled',null)`,[id(5)])).rejects.toThrow(/another match/)
 expect((await db.query('SELECT id FROM matches WHERE id=$1',[id(5)])).rows).toHaveLength(0)
})
it('deletion removes dangling match links without touching other entity types',async()=>{
 await db.query(`INSERT INTO entity_external_ids(entity_type,entity_id,source,external_id) VALUES('player',$1,'crionet_widget','player1')`,[id(1)])
 await db.query('DELETE FROM matches WHERE id=$1',[id(1)])
 expect((await db.query('SELECT entity_type FROM entity_external_ids WHERE entity_id=$1',[id(1)])).rows).toEqual([{entity_type:'player'}])
})
async function outcome(n:number,result:string){await db.query('SELECT record_match_stats_outcomes($1)',[JSON.stringify([{match_id:id(n),outcome:result}])])}
async function state(n:number){return (await db.query<{last_outcome:string;empty_attempts:number;seconds:number}>(`SELECT last_outcome,empty_attempts,extract(epoch FROM next_attempt_at-now())::int seconds FROM match_stats_fetch_state WHERE match_id=$1`,[id(n)])).rows[0]}
it('backs off repeated historical absence to seven days, distinguishes errors, and resets after recovery',async()=>{
 await db.query(`INSERT INTO matches VALUES($1,null,'finished',now()-interval '30 days')`,[id(10)])
 await db.query(`INSERT INTO match_stats_fetch_state(match_id,next_attempt_at) VALUES($1,now())`,[id(10)])
 await outcome(10,'empty');expect((await state(10)).seconds).toBeGreaterThan(21590)
 for(let i=0;i<6;i++)await outcome(10,'empty')
 expect(await state(10)).toMatchObject({last_outcome:'empty',empty_attempts:6})
 expect((await state(10)).seconds).toBeGreaterThan(604790)
 await outcome(10,'error');expect(await state(10)).toMatchObject({last_outcome:'error',empty_attempts:6})
 expect((await state(10)).seconds).toBeLessThanOrEqual(21600)
 await outcome(10,'success');expect((await state(10)).empty_attempts).toBe(0)
})
it('keeps live and newly finished retries short even after repeated empty responses',async()=>{
 for(const [n,status] of [[11,'live'],[12,'finished']] as const){
 await db.query('INSERT INTO matches VALUES($1,null,$2,now())',[id(n),status])
 await db.query('INSERT INTO match_stats_fetch_state(match_id,next_attempt_at) VALUES($1,now())',[id(n)])
 for(let i=0;i<7;i++)await outcome(n,'empty')
 expect((await state(n)).seconds).toBe(status==='live'?240:900)
 }
})
it('rejects unbounded/duplicate/invalid batches and anonymous writes',async()=>{
 await expect(db.query('SELECT record_match_stats_outcomes($1)',[JSON.stringify(Array(21).fill({match_id:id(10),outcome:'empty'}))])).rejects.toThrow(/at most 20/)
 await expect(db.query('SELECT record_match_stats_outcomes($1)',[JSON.stringify(Array(2).fill({match_id:id(10),outcome:'empty'}))])).rejects.toThrow(/Duplicate/)
 await expect(outcome(10,'other')).rejects.toThrow(/Invalid/)
 await db.exec('SET ROLE anon')
 await expect(outcome(10,'empty')).rejects.toThrow(/permission denied/)
 await db.exec('RESET ROLE')
})

it('rejects new dangling links and preserves an existing link when an invalid update fails',async()=>{
 await expect(db.query(`INSERT INTO entity_external_ids(entity_type,entity_id,source,external_id) VALUES('match',$1,'other','missing')`,[id(999)])).rejects.toThrow(/missing match/);
 await expect(db.query(`UPDATE entity_external_ids SET entity_id=$1 WHERE entity_type='match' AND entity_id=$2`,[id(999),id(3)])).rejects.toThrow(/missing match/);
 expect((await db.query(`SELECT entity_id FROM entity_external_ids WHERE external_id='FIP-2026-4801:MD003'`)).rows).toEqual([{entity_id:id(3)}]);
});

it('restricts both maintenance RPCs even under Supabase default role grants',async()=>{
 for(const role of ['anon','authenticated']){
  await db.exec(`SET ROLE ${role}`);
  await expect(db.query('SELECT claim_match_stats_candidates()')).rejects.toThrow(/permission denied/);
  await expect(outcome(10,'empty')).rejects.toThrow(/permission denied/);
  await db.exec('RESET ROLE');
 }
 const grants=(await db.query(`SELECT has_function_privilege('service_role','claim_match_stats_candidates(uuid[])','EXECUTE') claim,has_function_privilege('service_role','record_match_stats_outcomes(jsonb)','EXECUTE') record`)).rows[0];
 expect(grants).toEqual({claim:true,record:true});
});

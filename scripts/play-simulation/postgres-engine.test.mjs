import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
import {postgresTick} from './postgres-engine.mjs'
test('shared production simulation isolates trades, settles once, and excludes prizes',async()=>{
 const db=new PGlite()
 try {
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE market_templates(id uuid PRIMARY KEY,question_i18n jsonb);
 CREATE TABLE markets(id uuid PRIMARY KEY,template_id uuid,status text,outcome boolean,locks_at timestamptz,lmsr_b float8,q_yes float8,q_no float8,tokens jsonb);`)
 await db.exec(await readFile(new URL('../../supabase/migrations/20260928190000_production_play_simulation.sql',import.meta.url),'utf8'))
 await db.query('SELECT play_simulation_configure(150,120000)')
 assert.equal((await db.query('SELECT count(*)::int n FROM play_sim_bots')).rows[0].n,150)
 await assert.rejects(db.query('UPDATE play_sim_bots SET prize_eligible=1'))
 const now=Date.now(), id='00000000-0000-0000-0000-000000000001'
 await db.query("INSERT INTO markets VALUES($1,NULL,'open',NULL,to_timestamp($2/1000.0),1000,0,0,'{}')",[id,now+86400000])
 assert.equal((await postgresTick(db,now)).reason,'paused')
 await db.query('SELECT play_simulation_pause(false)')
 assert.equal((await postgresTick(db,now+5000,()=>.1)).accepted,true)
 assert.equal((await postgresTick(db,now+5000,()=>.1)).reason,'recent_sync')
 assert.equal((await postgresTick(db,now+10000,()=>.1)).reason,'not_due')
 assert.equal((await db.query('SELECT q_yes FROM markets')).rows[0].q_yes,0)
 await db.query("UPDATE markets SET status='held'")
 assert.equal((await postgresTick(db,now+200000,()=>.1)).reason,'no_candidates')
 await db.query("UPDATE markets SET status='settled',outcome=true")
 await postgresTick(db,now+400000,()=>.1)
 const first=(await db.query("SELECT sum(balance)::text n FROM play_sim_bots")).rows[0].n
 await postgresTick(db,now+600000,()=>.1)
 assert.equal((await db.query("SELECT sum(balance)::text n FROM play_sim_bots")).rows[0].n,first)
 assert.equal((await db.query('SELECT play_simulation_state() s')).rows[0].s.audit.ok,true)
 assert.equal((await db.query("SELECT count(*)::int n FROM play_simulation_leaders('season')")).rows[0].n,150)
 await db.exec('SET ROLE anon')
 await assert.rejects(db.query('SELECT * FROM play_sim_bots'))
 await assert.rejects(db.query('SELECT play_simulation_pause(false)'))
 }finally{await db.close()}
})

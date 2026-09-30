import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
test('private settings and shared daily quotas with lease ownership',async()=>{
 const db=new PGlite()
 try {
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE TABLE profiles(id uuid primary key);CREATE SCHEMA storage;CREATE TABLE storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`)
 await db.exec(await readFile(new URL('../supabase/migrations/20260928090000_production_avatar_settings.sql',import.meta.url),'utf8'))
 const user='00000000-0000-4000-8000-000000000001',lease='00000000-0000-4000-8000-000000000002',wrong='00000000-0000-4000-8000-000000000003'
 await db.query('INSERT INTO profiles VALUES($1)',[user])
 const reserve=async()=> (await db.query('SELECT reserve_avatar_generation($1,$2) AS result',[user,lease])).rows[0].result
 assert.equal(await reserve(),'ok');assert.equal(await reserve(),'generation_busy')
 await db.query('SELECT release_avatar_generation($1,$2)',[user,wrong]);assert.equal(await reserve(),'generation_busy')
 await db.query('SELECT release_avatar_generation($1,$2)',[user,lease])
 for(let i=1;i<5;i++){assert.equal(await reserve(),'ok');await db.query('SELECT release_avatar_generation($1,$2)',[user,lease])}
 assert.equal(await reserve(),'daily_limit')
 await db.exec("UPDATE avatar_generation_usage SET day=day-1")
 assert.equal(await reserve(),'ok')
 assert.equal((await db.query('SELECT public FROM storage.buckets')).rows[0].public,false)
 await db.exec('SET ROLE anon')
 await assert.rejects(db.query('SELECT * FROM avatar_provider_settings'))
 await assert.rejects(db.query('SELECT reserve_avatar_generation($1,$2)',[user,lease]))
 } finally { await db.close() }
})

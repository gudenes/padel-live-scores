import fs from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const require=createRequire(path.join(root,'apps/ops/package.json'))
require('@next/env').loadEnvConfig(path.join(root,'apps/ops'))
const {Client}=require('pg'),u=new URL(process.env.DATABASE_URL)
const db=new Client({host:u.hostname,port:Number(u.port||5432),database:u.pathname.slice(1),user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),ssl:{rejectUnauthorized:false}})
try{
 await db.connect();await db.query('BEGIN');await db.query("set local lock_timeout='5s'")
 await db.query(fs.readFileSync(path.join(root,'supabase/migrations/20261119160000_account_player_views.sql'),'utf8'))
 const r=await db.query("select relrowsecurity from pg_class where oid='public.scouting_player_views'::regclass")
 if(!r.rows[0]?.relrowsecurity)throw Error('RLS verification failed')
 for(const role of ['anon','authenticated']){
  const p=await db.query("select has_table_privilege($1,'public.scouting_player_views','SELECT,INSERT,UPDATE,DELETE') as allowed",[role])
  if(p.rows[0].allowed)throw Error('Unexpected public access')
 }
 const apply=process.argv.includes('--apply')
 await db.query(apply?'COMMIT':'ROLLBACK')
 console.log(apply?'Account player-view schema applied; RLS and restricted access verified.':'Schema dry run passed; transaction rolled back.')
}catch(e){await db.query('ROLLBACK').catch(()=>{});console.error(e.message);process.exitCode=1}finally{await db.end()}

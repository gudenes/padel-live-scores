// Default: full migration + parity/trigger checks, then rollback. --apply commits.
import fs from 'node:fs'
import path from 'node:path'
import Module, {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(path.join(root, 'apps/ops/package.json'))
const {loadEnvConfig} = require('@next/env')
loadEnvConfig(path.join(root, 'apps/ops'))
const {Client} = require('pg'), ts = require('typescript')
const sourcePath = path.join(root,'apps/ops/src/lib/scouting/intelligence/birthplace-preview.ts')
const compiled = new Module(sourcePath)
compiled.filename = sourcePath; compiled.paths = Module._nodeModulePaths(path.dirname(sourcePath))
compiled._compile(ts.transpileModule(fs.readFileSync(sourcePath,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText, sourcePath)
const {previewBirthplace} = compiled.exports
const apply = process.argv.includes('--apply')
const u = new URL(process.env.DATABASE_URL)
const client = new Client({host:u.hostname,port:Number(u.port||5432),database:u.pathname.slice(1),user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),ssl:{rejectUnauthorized:false}})
const fingerprint = async () => (await client.query(`select md5(string_agg(id::text || coalesce(birthplace,'<NULL>') || coalesce(updated_at::text,'<NULL>'), '|' order by id)) as value from public.players`)).rows[0].value
const assert = (condition, message) => {if (!condition) throw Error(message)}
try {
  await client.connect()
  await client.query('BEGIN')
  await client.query("set local lock_timeout='5s'")
  await client.query("set local statement_timeout='90s'")
  await client.query("select pg_advisory_xact_lock(hashtext('player-birthplace-normalization-v1'))")
  const before = await fingerprint()
  await client.query(fs.readFileSync(path.join(root,'supabase/migrations/20261119140000_normalize_player_birthplaces.sql'),'utf8'))
  const rows = (await client.query(`select p.id,p.name,p.country,p.birthplace,p.ranking,p.profile_status,n.status,n.candidate_ids,m.region_code from players p join player_birthplaces n on n.player_id=p.id left join birthplace_municipalities m on m.id=n.municipality_id`)).rows
  assert(rows.length === Number((await client.query('select count(*) n from players')).rows[0].n), 'Incomplete backfill')
  for (const row of rows) {
    const expected = previewBirthplace(row)
    const status = row.status === 'proposed' ? row.region_code === '09' ? 'catalunya' : 'other' : row.status === 'missing' ? 'missing' : 'review'
    assert(status === expected.status, `Preview parity mismatch for ${row.id}`)
    assert(JSON.stringify([...row.candidate_ids].sort()) === JSON.stringify(expected.candidates.map(m=>m.id).sort()), `Candidate parity mismatch for ${row.id}`)
  }
  // Roll back all fixture changes before any commit, including player timestamps.
  await client.query('SAVEPOINT trigger_checks')
  const id = rows[0].id
  for (const [birthplace,status,municipality] of [['Castellar del Vallès','proposed','08051'],['Gerona','proposed','17079'],['Barcelona, Spain','proposed','08019'],['Barcelona, Venezuela','unresolved',null],['-','missing',null]]) {
    await client.query('update players set birthplace=$2 where id=$1',[id,birthplace])
    const result=(await client.query('select status,municipality_id from player_birthplaces where player_id=$1',[id])).rows[0]
    assert(result.status===status && result.municipality_id===municipality, `Trigger mismatch for ${birthplace}`)
  }
  await client.query("update players set birthplace='Vic' where id=$1",[id])
  await client.query("update player_birthplaces set status='verified',verification_source='transaction-only test',verified_at=now() where player_id=$1",[id])
  await client.query("select refresh_player_birthplace($1,'Vic')",[id])
  assert((await client.query('select status from player_birthplaces where player_id=$1',[id])).rows[0].status==='verified','Unchanged verification was discarded')
  await client.query("update players set birthplace='Reus' where id=$1",[id])
  const changed=(await client.query('select status,verification_source from player_birthplaces where player_id=$1',[id])).rows[0]
  assert(changed.status==='proposed' && changed.verification_source===null,'Stale verification survived birthplace change')
  await client.query('ROLLBACK TO SAVEPOINT trigger_checks')
  assert(await fingerprint()===before,'Original player data or timestamps changed')
  const counts=(await client.query(`select status,count(*)::int players from player_birthplaces group by status order by status`)).rows
  const catalunya=(await client.query(`select count(*)::int n from player_birthplaces n join birthplace_municipalities m on m.id=n.municipality_id where m.region_code='09'`)).rows[0].n
  const permissions=(await client.query(`select has_table_privilege('anon','public.player_birthplaces','SELECT') as anon,has_table_privilege('authenticated','public.player_birthplaces','SELECT') as authenticated,has_function_privilege('anon','public.refresh_player_birthplace(uuid,text)','EXECUTE') as execute`)).rows[0]
  assert(!permissions.anon && !permissions.authenticated && !permissions.execute,'Unexpected public access')
  await client.query(apply?'COMMIT':'ROLLBACK')
  console.log(JSON.stringify({mode:apply?'APPLIED':'DRY RUN — ROLLED BACK',playersChecked:rows.length,counts,catalunya,checks:['All-player parity with reviewed preview','Birthplace update trigger','Verification preservation and invalidation','Original player fields and timestamps unchanged','Public access denied']},null,2))
} catch(error) {
  await client.query('ROLLBACK').catch(()=>{})
  console.error(error.message); process.exitCode=1
} finally { await client.end() }

import pg from 'pg'
import { randomUUID } from 'node:crypto'
import type { Breakdown, Gender, RaceSnapshot } from './types.ts'
import type { FetchAttempt } from './fip.ts'

let pool: pg.Pool | undefined
let lockPool: pg.Pool | undefined
function database() {
  if (!process.env.DATABASE_URL) throw new Error('Live Race database configuration missing')
  return pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 6, connectionTimeoutMillis: 8000, statement_timeout: 15000, idleTimeoutMillis: 30000 })
}
const region = () => process.env.RAILWAY_REPLICA_REGION ?? process.env.RAILWAY_REGION ?? 'local'
export interface ProfileCache { baselineDate: string; fetchedAt: string; attemptedAt: string; data: Breakdown | null; error?: string }
export async function readSharedRace(gender: Gender): Promise<RaceSnapshot | null> {
  const r = await database().query('SELECT snapshot FROM public.live_race_snapshots WHERE gender=$1', [gender])
  return r.rows[0]?.snapshot ?? null
}
export async function loadSharedProfiles(date: string):Promise<Map<string,ProfileCache>> {
  const r=await database().query('SELECT player_id,payload FROM public.live_race_profiles WHERE baseline_date=$1',[date])
  return new Map(r.rows.map(r=>[r.player_id,r.payload]))
}
export async function writeSharedProfile(playerId: string, date: string, value: ProfileCache) {
  await database().query(`INSERT INTO public.live_race_profiles(player_id,baseline_date,payload) VALUES($1,$2,$3)
    ON CONFLICT(player_id,baseline_date) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()`, [playerId,date,JSON.stringify(value)])
}
/** Supabase's transaction pool cannot own a session advisory lock. */
export function sessionConnectionString(connectionString:string) {
  const url=new URL(connectionString)
  if(url.hostname.endsWith('.pooler.supabase.com')&&url.port==='6543')url.port='5432'
  return url.toString()
}
function locks() {
  const connectionString=process.env.DATABASE_SESSION_URL??process.env.DATABASE_URL
  if(!connectionString)throw new Error('Live Race database configuration missing')
  return lockPool??=new pg.Pool({connectionString:sessionConnectionString(connectionString),max:2,connectionTimeoutMillis:8000,statement_timeout:15000,idleTimeoutMillis:30000})
}
/** Session advisory locks release automatically if the worker/container dies. */
export async function acquireSharedRace(gender: Gender) {
  const client = await locks().connect()
  let disconnected = false
  const onError = () => { disconnected = true }
  client.on('error', onError)
  try {
    const r = await client.query('SELECT pg_try_advisory_lock(731027, $1) AS locked', [gender === 'men' ? 1 : 2])
    if (!r.rows[0].locked) { client.removeListener('error',onError);client.release();return null }
  } catch (e) { client.removeListener('error',onError);client.release(true);throw e }
  return {
    async publish(snapshot: RaceSnapshot) {
      // Publish through the connection holding the lock; a lost lock cannot
      // publish over a newer instance's snapshot using a replacement connection.
      if (disconnected) throw new Error('Live Race lock connection lost')
      await client.query(`INSERT INTO public.live_race_snapshots(gender,snapshot,producer_region) VALUES($1,$2,$3)
        ON CONFLICT(gender) DO UPDATE SET snapshot=EXCLUDED.snapshot,producer_region=EXCLUDED.producer_region,updated_at=now()`, [gender,JSON.stringify(snapshot),region()])
    },
    async release() {
      try { if (!disconnected) await client.query('SELECT pg_advisory_unlock(731027,$1)',[gender==='men'?1:2]) }
      finally { client.removeListener('error',onError);client.release(true) }
    },
  }
}
export async function startRaceRun(gender: Gender):Promise<string> {
  const id=randomUUID()
  await database().query('INSERT INTO public.live_race_runs(id,gender,producer_region,status) VALUES($1,$2,$3,$4)',[id,gender,region(),'running'])
  return id
}
export async function finishRaceRun(id: string, snapshot: RaceSnapshot | null, errorCode?: string) {
  const {players: _players,...summary}=snapshot ?? {players:[]}
  await database().query('UPDATE public.live_race_runs SET status=$2,completed_at=now(),summary=$3,error_code=$4 WHERE id=$1',
    [id,errorCode?'error':snapshot?.status??'error',JSON.stringify(summary),errorCode??null])
}
export async function startProfileJob(url: string):Promise<string> {
  const id=randomUUID()
  await database().query(`INSERT INTO padelgod.scrape_jobs(id,job_type,target_url,status,parser_version)
    VALUES($1,'profile',$2,'running','live-race-profile-v2')`,[id,url])
  return id
}
export async function finishProfileJob(id: string, startedAt: number, errorCode?: string) {
  await database().query(`UPDATE padelgod.scrape_jobs SET status=$2,completed_at=now(),duration_ms=$3,error_message=$4 WHERE id=$1`,
    [id,errorCode?'failed':'success',Date.now()-startedAt,errorCode??null])
}
export async function recordFetchAttempt(runId: string, jobId: string, a: FetchAttempt) {
  await database().query(`INSERT INTO public.live_race_fetch_attempts(run_id,job_id,route,status,http_status,error_code,response_bytes,duration_ms)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[runId,jobId,a.route,a.errorCode?'failed':'success',a.httpStatus??null,a.errorCode??null,a.bytes,a.durationMs])
}

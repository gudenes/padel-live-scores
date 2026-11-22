import { acquireRaceLock } from './lock.ts'
import { createClient } from '@supabase/supabase-js'
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { applyAwards, identity, rankPlayers, supportedLevels, tournamentAwards } from './engine.ts'
import { fetchBreakdown } from './fip.ts'
import type { Award, Breakdown, Gender, MatchResult, RacePlayer, RaceSnapshot, Tournament } from './types.ts'

const directory=()=>path.join(process.cwd(),'.local/race')
const cachePath=(gender:Gender)=>path.join(directory(),`${gender}.json`)
export async function readRace(gender:Gender):Promise<RaceSnapshot|null> {
  try{return JSON.parse(await readFile(cachePath(gender),'utf8'))}catch{return null}
}
async function atomic(file:string,data:unknown) {
  await mkdir(path.dirname(file),{recursive:true})
  const temporary=`${file}.${process.pid}.${crypto.randomUUID()}.tmp`
  await writeFile(temporary,JSON.stringify(data),{mode:0o600});await rename(temporary,file)
}
function clients() {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,service=process.env.SUPABASE_SERVICE_KEY,anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if(!url||!service||!anon) throw new Error('Local Supabase read configuration missing')
  return {db:createClient(url,service,{auth:{persistSession:false}}),publicDb:createClient(url,anon,{auth:{persistSession:false}})}
}
/** Page every source query; PostgREST's default 1,000-row cap is not a complete list. */
async function pages<T>(query:(from:number,to:number)=>PromiseLike<{data:unknown[]|null;error:unknown}>):Promise<T[]> {
  const rows:T[]=[]
  for(let offset=0;;offset+=500) {
    const result=await query(offset,offset+499)
    if(result.error) throw new Error('Ranking source query failed')
    rows.push(...(result.data ?? []) as T[])
    if((result.data?.length ?? 0)<500) return rows
  }
}
export async function loadBaseline(gender:Gender) {
  const {db,publicDb}=clients()
  const latest=await db.from('player_ranking_snapshots').select('ranking_date').eq('type','race').eq('gender',gender).order('ranking_date',{ascending:false}).limit(1).maybeSingle()
  if(latest.error||!latest.data) throw new Error('Official FIP Race snapshot unavailable')
  const date=latest.data.ranking_date as string
  const snapshots=await pages<{player_id:string;ranking:number;points:number}>((a,b)=>db.from('player_ranking_snapshots').select('player_id,ranking,points').eq('type','race').eq('gender',gender).eq('ranking_date',date).order('ranking').order('player_id').range(a,b))
  if(!snapshots.length || snapshots.some(r=>!Number.isFinite(r.points)||r.points<0||r.ranking<1)) throw new Error('Invalid FIP Race publication')
  const profiles=new Map<string,Record<string,unknown>>()
  for(let i=0;i<snapshots.length;i+=100) {
    const {data,error}=await publicDb.from('players').select('id,name,display_name,country,avatar_url,profile_url,category').in('id',snapshots.slice(i,i+100).map(r=>r.player_id)).eq('hidden',false)
    if(error) throw new Error('Player profiles unavailable')
    for(const p of data ?? []) profiles.set(p.id,p)
  }
  const players:RacePlayer[]=snapshots.filter(r=>profiles.has(r.player_id)).map(r=>({
    ...profiles.get(r.player_id),id:r.player_id,race_ranking:r.ranking,race_points:r.points,
    officialRank:r.ranking,officialPoints:r.points,liveGain:0,pending:false,category:gender,
  } as RacePlayer))
  return {date,players}
}
interface ProfileCache {baselineDate:string; fetchedAt:string; attemptedAt:string; data:Breakdown|null;error?:string}
async function profile(player:RacePlayer,date:string,fetchAllowed:boolean):Promise<Breakdown|null> {
  const file=path.join(directory(),'profiles',`${player.id}.json`)
  let cached:ProfileCache|null=null
  try{cached=JSON.parse(await readFile(file,'utf8'))}catch{}
  if(cached?.baselineDate===date && cached.data?.date===date) return cached.data
  if(!fetchAllowed || !player.profile_url || (cached?.baselineDate===date && Date.now()-Date.parse(cached.attemptedAt)<15*60_000)) return null
  const now=new Date().toISOString()
  try {
    const data=await fetchBreakdown(player.profile_url)
    await atomic(file,{baselineDate:date,fetchedAt:now,attemptedAt:now,data})
    return data
  }catch {
    await atomic(file,{baselineDate:date,fetchedAt:cached?.fetchedAt??'',attemptedAt:now,data:null,error:'FIP profile unavailable'})
    return null
  }
}
async function canFetchProfile(player:RacePlayer,date:string) {
  if(!player.profile_url) return false
  try {
    const cached:ProfileCache=JSON.parse(await readFile(path.join(directory(),'profiles',`${player.id}.json`),'utf8'))
    return cached.baselineDate!==date || Date.now()-Date.parse(cached.attemptedAt)>=15*60_000
  } catch {return true}
}
/** All remote database operations are SELECTs; computed caches are per instance. */
export async function refreshRace(gender:Gender,profileBudget=24):Promise<RaceSnapshot|null> {
  if(process.env.NODE_ENV==='production' && process.env.LIVE_RACE_ENABLED!=='true') throw new Error('Live Race refresh disabled')
  await mkdir(directory(),{recursive:true})
  const lock=path.join(directory(),`${gender}.lock`)
  if(!await acquireRaceLock(lock)) return readRace(gender)
  const previous=await readRace(gender)
  try {
    const {date,players}=await loadBaseline(gender)
    if(previous && (date<previous.baselineDate || players.length<previous.totalPlayers*0.9)) throw new Error('Incomplete or older FIP publication rejected')
    const now=new Date().toISOString()
    // Persist official rows promptly so the local UI never waits for hundreds of profile reads.
    if(!previous) await atomic(cachePath(gender),{version:1,gender,baselineDate:date,checkedAt:now,computedAt:now,players,totalPlayers:players.length,appliedPlayers:0,pendingPlayers:0,resultCount:0,status:'official',reconciliation:null} satisfies RaceSnapshot)
    const {db}=clients()
    const tournaments=await pages<Tournament>((a,b)=>db.from('tournaments').select('id,name,level,starts_at,ends_at,fip_id').in('level',supportedLevels).gte('ends_at',date).lte('starts_at',now).order('id').range(a,b))
    const groups=new Map<string,Tournament[]>()
    for(const tournament of tournaments){const key=`${identity(tournament.name)}:${tournament.starts_at.slice(0,10)}`;groups.set(key,[...(groups.get(key)??[]),tournament])}
    const awards:Award[]=[];let resultCount=0
    for(const group of groups.values()) {
      const matches=await pages<MatchResult>((a,b)=>db.from('matches').select('id,tournament_id,category,round,round_canonical,status,winner_pair,finished_at,scheduled_at,pair1_player1_id,pair1_player2_id,pair2_player1_id,pair2_player2_id,pair1_seed,pair2_seed').in('tournament_id',group.map(t=>t.id)).eq('category',gender).order('id').range(a,b))
      resultCount+=matches.filter(m=>['finished','walkover','retired'].includes(m.status) && m.winner_pair!=null).length
      awards.push(...tournamentAwards(group[0],matches))
    }
    const byPlayer=new Map<string,Award[]>()
    for(const award of awards)byPlayer.set(award.playerId,[...(byPlayer.get(award.playerId)??[]),award])
    const updated:RacePlayer[]=new Array(players.length)
    let budget=profileBudget, cursor=0
    // Bound external requests while allowing independent player lookups to progress.
    async function consume() {
      while(cursor<players.length) {
        const index=cursor++,p=players[index]
        const own=byPlayer.get(p.id)??[]
        if(!own.length){updated[index]=p;continue}
        let data=await profile(p,date,false)
        if(!data && !own.some(a=>a.uncertain) && await canFetchProfile(p,date) && budget>0) {
          budget--;data=await profile(p,date,true)
        }
        updated[index]=applyAwards(p,data,own,date)
      }
    }
    await Promise.all([consume(),consume(),consume()])
    const latest=await db.from('player_ranking_snapshots').select('ranking_date').eq('type','race').eq('gender',gender).order('ranking_date',{ascending:false}).limit(1).maybeSingle()
    if(latest.error||latest.data?.ranking_date!==date) throw new Error('FIP publication changed during calculation; retrying')
    const appliedPlayers=updated.filter(p=>p.liveGain!==0).length,pendingPlayers=updated.filter(p=>p.pending).length
    const fingerprint=(rows:RacePlayer[])=>createHash('sha256').update(JSON.stringify(rows.map(p=>[p.id,p.officialRank,p.officialPoints]).sort())).digest('hex')
    const rebased=previous && (previous.baselineDate!==date || fingerprint(previous.players)!==fingerprint(players))
    const reconciliation=rebased?{previousDate:previous.baselineDate,at:now,changedPlayers:players.filter(p=>previous.players.find(old=>old.id===p.id)?.race_points!==p.officialPoints).length}:previous?.reconciliation??null
    const snapshot:RaceSnapshot={version:1,gender,baselineDate:date,checkedAt:now,computedAt:new Date().toISOString(),
      players:appliedPlayers?rankPlayers(updated):updated,totalPlayers:players.length,appliedPlayers,pendingPlayers,resultCount,
      status:pendingPlayers?'partial':appliedPlayers?'live':'official',reconciliation}
    if(rebased) await atomic(path.join(directory(),'reconciliations',`${gender}-${now.replace(/[:.]/g,'-')}.json`),{previousDate:previous.baselineDate,newDate:date,reconciliation,previous:previous.players.map(p=>({id:p.id,points:p.race_points})),official:players.map(p=>({id:p.id,points:p.officialPoints}))})
    await atomic(cachePath(gender),snapshot)
    return snapshot
  } catch(e) {
    if(previous){const stale={...previous,status:'stale' as const,error:e instanceof Error?e.message:'Local refresh failed'};await atomic(cachePath(gender),stale);return stale}
    throw e
  } finally {await rm(lock,{recursive:true,force:true})}
}

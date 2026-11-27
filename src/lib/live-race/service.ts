import { acquireSharedRace, readSharedRace, loadSharedProfiles, writeSharedProfile, startRaceRun, finishRaceRun, startProfileJob, finishProfileJob, recordFetchAttempt, type ProfileCache } from './store.ts'
import { createClient } from '@supabase/supabase-js'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { applyAwards, bestResults, identity, rankPlayers, supportedLevels, tournamentAwards } from './engine.ts'
import { fetchBreakdown, FipFetchError } from './fip.ts'
import type { Award, Breakdown, Gender, MatchResult, RacePlayer, RaceSnapshot, Tournament } from './types.ts'

export const readRace=readSharedRace
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
export function profileMatchesBaseline(data:Breakdown|null|undefined,date:string,points:number):boolean {
  const results=data?.results.filter(r=>r.date.startsWith(date.slice(0,4)))??[]
  return data?.date===date && !results.some(r=>r.points===0) && bestResults(results)===points
}
async function profile(player:RacePlayer,date:string,profiles:Map<string,ProfileCache>,fetchAllowed:boolean,runId:string):Promise<Breakdown|null> {
  let cached=profiles.get(player.id)
  // Migrate valid local history during rollout; retry old failures through failover.
  if(!cached) {
    try {
      const local:ProfileCache=JSON.parse(await readFile(path.join(process.cwd(),'.local/race/profiles',player.id+'.json'),'utf8'))
      if(local.baselineDate===date&&profileMatchesBaseline(local.data,date,player.officialPoints))cached=local
    } catch {}
    if(cached){await writeSharedProfile(player.id,date,cached);profiles.set(player.id,cached)}
  }
  if(profileMatchesBaseline(cached?.data,date,player.officialPoints))return cached!.data
  if(!fetchAllowed||!player.profile_url||(cached&&Date.now()-Date.parse(cached.attemptedAt)<15*60_000))return cached?.data??null
  const now=new Date().toISOString(),started=Date.now()
  const jobId=await startProfileJob(player.profile_url)
  let data:Breakdown|null=null,error:string|undefined
  try {data=await fetchBreakdown(player.profile_url,a=>recordFetchAttempt(runId,jobId,a))}
  catch(e) {
    if(!(e instanceof FipFetchError)) {await finishProfileJob(jobId,started,'LIVE_RACE_TELEMETRY_ERROR');throw e}
    error=e.code
  }
  await finishProfileJob(jobId,started,error)
  const next:ProfileCache={baselineDate:date,fetchedAt:data?now:cached?.fetchedAt??'',attemptedAt:now,data:data??cached?.data??null,...(error?{error}:{})}
  await writeSharedProfile(player.id,date,next);profiles.set(player.id,next)
  return data
}
/** Shared derived state and telemetry; official publications remain read-only. */
export async function refreshRace(gender:Gender,profileBudget=24):Promise<RaceSnapshot|null> {
  if(process.env.NODE_ENV==='production' && process.env.LIVE_RACE_ENABLED!=='true') throw new Error('Live Race refresh disabled')
  const lease=await acquireSharedRace(gender)
  if(!lease)return readRace(gender)
  let previous:RaceSnapshot|null=null,runId:string|null=null
  try {
    previous=await readRace(gender)
    if(previous&&Date.now()-Date.parse(previous.checkedAt)<45_000&&previous.status!=='stale')return previous
    runId=await startRaceRun(gender)
    const {date,players}=await loadBaseline(gender)
    if(previous && (date<previous.baselineDate || players.length<previous.totalPlayers*0.9)) throw new Error('Incomplete or older FIP publication rejected')
    const now=new Date().toISOString()
    // Persist official rows promptly so the public UI never waits for hundreds of profile reads.
    if(!previous) await lease.publish({version:1,gender,baselineDate:date,checkedAt:now,computedAt:now,players,totalPlayers:players.length,appliedPlayers:0,pendingPlayers:0,resultCount:0,status:'official',reconciliation:null} satisfies RaceSnapshot)
    const profiles=await loadSharedProfiles(date)
    const {db}=clients()
    const tournaments=await pages<Tournament>((a,b)=>db.from('tournaments').select('id,name,level,starts_at,ends_at,fip_id').in('level',supportedLevels).eq('source_suppressed',false).gte('ends_at',date).lte('starts_at',now).order('id').range(a,b))
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
        let data=await profile(p,date,profiles,false,runId!)
        if(!profileMatchesBaseline(data,date,p.officialPoints) && !own.some(a=>a.uncertain) && p.profile_url && (!profiles.has(p.id)||Date.now()-Date.parse(profiles.get(p.id)!.attemptedAt)>=15*60_000) && budget>0) {
          budget--;data=await profile(p,date,profiles,true,runId!)
        }
        updated[index]=applyAwards(p,data,own,date)
        if(updated[index].pendingReason==='profile_not_loaded'&&profiles.get(p.id)?.error)updated[index].pendingReason='profile_unavailable'
        if(own.some(a=>a.uncertain)&&updated[index].pending)updated[index].pendingReason='ambiguous_results'
      }
    }
    const consumers=await Promise.allSettled([consume(),consume(),consume()])
    const failed=consumers.find(r=>r.status==='rejected')
    if(failed?.status==='rejected')throw failed.reason
    const latest=await db.from('player_ranking_snapshots').select('ranking_date').eq('type','race').eq('gender',gender).order('ranking_date',{ascending:false}).limit(1).maybeSingle()
    if(latest.error||latest.data?.ranking_date!==date) throw new Error('FIP publication changed during calculation; retrying')
    const appliedPlayers=updated.filter(p=>p.liveGain!==0).length,pendingPlayers=updated.filter(p=>p.pending).length
    const fingerprint=(rows:RacePlayer[])=>createHash('sha256').update(JSON.stringify(rows.map(p=>[p.id,p.officialRank,p.officialPoints]).sort())).digest('hex')
    const rebased=previous && (previous.baselineDate!==date || fingerprint(previous.players)!==fingerprint(players))
    const prior=previous
    const reconciliation=prior && rebased?{previousDate:prior.baselineDate,at:now,changedPlayers:players.filter(p=>prior.players.find(old=>old.id===p.id)?.race_points!==p.officialPoints).length}:previous?.reconciliation??null
    const pendingReasons:NonNullable<RaceSnapshot['pendingReasons']>={}
    for(const p of updated)if(p.pending&&p.pendingReason)pendingReasons[p.pendingReason]=(pendingReasons[p.pendingReason]??0)+1
    const snapshot:RaceSnapshot={version:1,gender,baselineDate:date,checkedAt:now,computedAt:new Date().toISOString(),
      pendingReasons,players:appliedPlayers?rankPlayers(updated):updated,totalPlayers:players.length,appliedPlayers,pendingPlayers,resultCount,
      status:pendingPlayers?'partial':appliedPlayers?'live':'official',reconciliation}
    await lease.publish(snapshot)
    await finishRaceRun(runId!,snapshot)
    return snapshot
  } catch(e) {
    const code=e instanceof FipFetchError?e.code:'LIVE_RACE_REFRESH_FAILED'
    if(runId)await finishRaceRun(runId,previous,code)
    if(previous){const stale={...previous,status:'stale' as const,error:code};await lease.publish(stale);return stale}
    throw e
  } finally {await lease.release()}
}

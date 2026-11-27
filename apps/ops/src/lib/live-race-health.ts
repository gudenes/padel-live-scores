import type { Signal } from './integration-monitor'

export interface LiveRaceGenderHealth {
  gender: 'men' | 'women'; status: Signal; message: string
  baselineDate: string | null; computedAt: string | null
  applied: number; pending: number; total: number; region: string | null
  reasons: Record<string, number>
}
export interface LiveRaceHealth {
  available: boolean; genders: LiveRaceGenderHealth[]
  routes: { route: string; requests: number; failures: number; bytes: number }[]
  errors: { code: string; count: number }[]
}
const obj=(v:unknown):Record<string,any>=>v&&typeof v==='object'?v as Record<string,any>:{}
const list=(v:unknown):any[]=>Array.isArray(v)?v:[]
const count=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:0
const date=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))?v:null
const reasonKeys=['profile_unavailable','profile_not_loaded','baseline_mismatch','incomplete_history','ambiguous_results','overlapping_events']
export function liveRaceHealth(raw:unknown,now=Date.now()):LiveRaceHealth {
  const data=obj(raw),available=raw!=null&&Array.isArray(data.snapshots)&&Array.isArray(data.runs)
  return {
    available,
    genders:(['men','women'] as const).map(gender=>{
      const row=obj(list(data.snapshots).find(r=>r.gender===gender)),s=obj(row.snapshot)
      const run=obj(list(data.runs).find(r=>r.gender===gender))
      const computedAt=date(s.computedAt),baselineDate=date(s.baselineDate)
      const reasons=Object.fromEntries(reasonKeys.filter(k=>count(obj(s.pendingReasons)[k])>0).map(k=>[k,count(obj(s.pendingReasons)[k])]))
      let status:Signal='unknown',message='Live Race monitoring unavailable'
      if(available) {
        if(!computedAt) {status=run.status==='error'?'error':'unknown';message=run.status==='error'?'Live calculation failed before publishing':'Awaiting first shared calculation'}
        else if(now-Date.parse(computedAt)>5*60_000||s.status==='stale') {status='error';message='Live calculation is stale; official import health does not cover this'}
        else if(run.status==='error') {status='error';message='Latest live calculation failed'}
        else if(run.status==='running'&&date(run.started_at)&&now-Date.parse(run.started_at)>10*60_000) {status='error';message='Live calculation has stopped reporting completion'}
        else if(count(s.pendingPlayers)>0||s.status==='partial') {status='warning';message='Live points are incomplete; see pending reasons'}
        else {status='healthy';message='Live calculation is current with no pending players'}
      }
      return {gender,status,message,baselineDate,computedAt,applied:count(s.appliedPlayers),pending:count(s.pendingPlayers),total:count(s.totalPlayers),
        region:typeof row.region==='string'?row.region:null,reasons}
    }),
    routes:list(data.routes).filter(r=>/^(fixed_\d+|residential|direct)$/.test(r.route)).map(r=>({route:r.route,requests:count(r.requests),failures:count(r.failures),bytes:count(Number(r.bytes))})),
    errors:list(data.errors).filter(r=>typeof r.error_code==='string'&&/^[A-Z0-9_]+$/.test(r.error_code)).map(r=>({code:r.error_code,count:count(r.count)})),
  }
}

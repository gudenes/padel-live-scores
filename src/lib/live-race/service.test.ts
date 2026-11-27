import {beforeEach,describe,it,expect,vi} from 'vitest'
const state=vi.hoisted(()=>({from:vi.fn(),lease:{publish:vi.fn(),release:vi.fn()}}))
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({from:state.from})}))
vi.mock('./store.ts',()=>({
 acquireSharedRace:vi.fn(),readSharedRace:vi.fn(),loadSharedProfiles:vi.fn(),writeSharedProfile:vi.fn(),
 startRaceRun:vi.fn(),finishRaceRun:vi.fn(),startProfileJob:vi.fn(),finishProfileJob:vi.fn(),recordFetchAttempt:vi.fn(),
}))
vi.mock('./fip.ts',async importOriginal=>({...await importOriginal<typeof import('./fip.ts')>(),fetchBreakdown:vi.fn()}))
import * as store from './store'
import {fetchBreakdown,FipFetchError} from './fip'
import {refreshRace,profileMatchesBaseline} from './service'
const date='2026-11-23',id='p'
const data={date,results:[{key:'old',name:'Old',date:'2026-10-01',points:10}]}
const p={id,name:'Woman',category:'women',profile_url:'https://www.padelfip.com/player/woman/',officialPoints:10,race_points:10,race_ranking:1,officialRank:1,liveGain:0,pending:false,country:null,avatar_url:null}
beforeEach(()=>{
 vi.clearAllMocks()
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://example.com';process.env.SUPABASE_SERVICE_KEY='test';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='test'
 vi.mocked(store.acquireSharedRace).mockResolvedValue(state.lease)
 vi.mocked(store.readSharedRace).mockResolvedValue(null)
 vi.mocked(store.loadSharedProfiles).mockResolvedValue(new Map())
 vi.mocked(store.startRaceRun).mockResolvedValue('run')
 vi.mocked(store.startProfileJob).mockResolvedValue('job')
 vi.mocked(fetchBreakdown).mockResolvedValue(data)
 state.from.mockImplementation(table=>{
  const b:any={cols:'',select(cols:string){this.cols=cols;return this},eq(){return this},order(){return this},limit(){return this},in(){return this},gte(){return this},lte(){return this},range(){return this},
   maybeSingle:async()=>({data:{ranking_date:date},error:null}),
   then(resolve:any){const rows=table==='players'?[p]:table==='player_ranking_snapshots'?[{player_id:id,ranking:1,points:10}]:table==='tournaments'?[{id:'t',name:'Major Now',level:'major',starts_at:'2026-11-23',ends_at:'2026-11-29'}]:[
    {id:'m',category:'women',round_canonical:'R16',status:'finished',winner_pair:1,pair1_player1_id:id,pair1_player2_id:'partner',pair2_player1_id:'other',pair2_player2_id:'other2',pair1_seed:1,pair2_seed:2}
   ];return Promise.resolve({data:rows,error:null}).then(resolve)}
  };return b
 })
})
describe('shared Live Race refresh',()=>{
 it('publishes match-derived gains and writes a monitored profile job',async()=>{
  const result=await refreshRace('women',24)
  expect(result?.players[0]).toMatchObject({race_points:370,liveGain:360,pending:false})
  expect(store.startProfileJob).toHaveBeenCalledWith(p.profile_url)
  expect(store.finishProfileJob).toHaveBeenCalledWith('job',expect.any(Number),undefined)
  expect(state.lease.publish).toHaveBeenLastCalledWith(result)
  expect(store.finishRaceRun).toHaveBeenCalledWith('run',result)
  expect(state.lease.release).toHaveBeenCalledOnce()
 })
 it('records profile failures and exposes the pending reason without inventing points',async()=>{
  vi.mocked(fetchBreakdown).mockRejectedValue(new FipFetchError('FIP_HTTP_403',403))
  const result=await refreshRace('women',24)
  expect(result?.players[0]).toMatchObject({race_points:10,pending:true,pendingReason:'profile_unavailable'})
  expect(result?.pendingReasons).toEqual({profile_unavailable:1})
  expect(store.finishProfileJob).toHaveBeenCalledWith('job',expect.any(Number),'FIP_HTTP_403')
  expect(result?.status).toBe('partial')
 })
 it('uses already verified shared history without requiring a fresh FIP response',async()=>{
  vi.mocked(store.loadSharedProfiles).mockResolvedValue(new Map([[id,{baselineDate:date,attemptedAt:new Date().toISOString(),fetchedAt:new Date().toISOString(),data}]]))
  const result=await refreshRace('women',24)
  expect(result?.players[0].liveGain).toBe(360)
  expect(fetchBreakdown).not.toHaveBeenCalled()
  expect(store.startProfileJob).not.toHaveBeenCalled()
 })
 it('makes a second region read the existing shared snapshot while another owns the lock',async()=>{
  vi.mocked(store.acquireSharedRace).mockResolvedValue(null)
  const previous={version:1,gender:'women',status:'live',players:[p]} as any
  vi.mocked(store.readSharedRace).mockResolvedValue(previous)
  expect(await refreshRace('women')).toBe(previous)
  expect(store.startRaceRun).not.toHaveBeenCalled()
  expect(fetchBreakdown).not.toHaveBeenCalled()
 })
 it('treats telemetry persistence failure as a failed run, never a successful profile',async()=>{
  vi.mocked(fetchBreakdown).mockRejectedValue(new Error('telemetry sink down'))
  await expect(refreshRace('women')).rejects.toThrow('telemetry sink down')
  expect(store.finishProfileJob).toHaveBeenCalledWith('job',expect.any(Number),'LIVE_RACE_TELEMETRY_ERROR')
  expect(store.finishRaceRun).toHaveBeenCalledWith('run',null,'LIVE_RACE_REFRESH_FAILED')
  expect(state.lease.release).toHaveBeenCalledOnce()
 })
 it('invalidates verified history when Monday or a corrected official total changes',()=>{
  expect(profileMatchesBaseline(data,date,10)).toBe(true)
  expect(profileMatchesBaseline(data,'2026-11-30',10)).toBe(false)
  expect(profileMatchesBaseline(data,date,11)).toBe(false)
 })
})

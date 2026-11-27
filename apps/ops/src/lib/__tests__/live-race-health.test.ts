import {describe,it,expect} from 'vitest'
import {liveRaceHealth} from '../live-race-health'
const now=Date.parse('2026-11-27T10:00:00Z')
const make=(snapshot:Record<string,unknown>={},run:Record<string,unknown>={})=>({
 snapshots:[{gender:'women',region:'eu',snapshot:{computedAt:new Date(now).toISOString(),baselineDate:'2026-11-23',appliedPlayers:18,pendingPlayers:95,totalPlayers:1000,status:'partial',pendingReasons:{profile_unavailable:75,profile_not_loaded:20},...snapshot}}],
 runs:[{gender:'women',status:'partial',...run}],routes:[{route:'fixed_1',requests:2,failures:1,bytes:100}],
 errors:[{error_code:'FIP_HTTP_403',count:1}],
})
describe('Live Race dashboard health',()=>{
 it('shows a partial live calculation even when the official baseline is current',()=>{
  const r=liveRaceHealth(make(),now)
  expect(r.genders[1]).toMatchObject({status:'warning',pending:95,reasons:{profile_unavailable:75,profile_not_loaded:20}})
  expect(r.routes[0].failures).toBe(1)
 })
 it('fails stale or failed runs without changing the official baseline status',()=>{
  expect(liveRaceHealth(make({computedAt:'2026-11-27T09:00:00Z'}),now).genders[1].status).toBe('error')
  expect(liveRaceHealth(make({pendingPlayers:0,status:'live'},{status:'error'}),now).genders[1].status).toBe('error')
 })
 it('never treats missing telemetry as zero failures or healthy',()=>{
  const r=liveRaceHealth(null,now)
  expect(r.available).toBe(false)
  expect(r.genders.every(g=>g.status==='unknown')).toBe(true)
 })
 it('allows healthy only when live coverage is current and complete',()=>{
  expect(liveRaceHealth(make({pendingPlayers:0,status:'live'}),now).genders[1].status).toBe('healthy')
 })
 it('does not expose raw error messages, player data, or proxy URLs',()=>{
  const r=liveRaceHealth({...make(),errors:[{error_code:'https://secret@proxy',count:1}],routes:[{route:'https://secret@proxy'}]},now)
  expect(JSON.stringify(r)).not.toContain('secret')
 })
})

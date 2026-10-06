import {describe,it,expect} from 'vitest'
import {freshDoc,validateDoc,replay,type Event} from '../scouting/model'
import {pointsCsv,sessionExport} from '../scouting/export'
const players=[0,1,2,3].map(i=>({id:String(i),name:'Player '+i}))
const error:Event={kind:'point',id:'error',at:'2026-10-06T00:00:00Z',player:0,outcome:'forced',smash:false,shot:'block',forcedBy:2,netTouch:true}
describe('manual point tags in admin stats and exports',()=>{
 it('credits the opponent, preserves event details and reverses stats on Undo',()=>{
  const doc=validateDoc({...freshDoc(),events:[error]}),m=replay(doc)
  expect(m.stats[2].forcedErrorsCreated).toBe(1);expect(m.stats[0].netTouches).toBe(1);expect(m.stats[0].forced).toBe(1)
  expect(m.tracking.timeline[0]).toMatchObject({forcedBy:2,netTouch:true})
  const exported=sessionExport('match',players,1,doc)
  expect(exported.summary.tracking.timeline[0]).toMatchObject({forcedBy:2,netTouch:true})
  const csv=pointsCsv(players,doc)
  expect(csv).toContain('"forced_by_player_id","forced_by_player_name","net_touch"')
  expect(csv).toContain('"2","Player 2","true"')
  const undone=replay({...doc,events:[error,{kind:'undo',id:'undo',at:'2026-10-06T00:00:01Z'}]})
  expect(undone.stats[2].forcedErrorsCreated).toBe(0);expect(undone.stats[0].netTouches).toBe(0)
 })
 it('keeps legacy lucky/unlucky details and counts their observed net contacts',()=>{
  const legacy={...error,forcedBy:undefined,netTouch:undefined,netCord:'unlucky' as const}
  const m=replay(validateDoc({...freshDoc(),events:[legacy]}))
  expect(m.stats[0].unluckyNetCords).toBe(1);expect(m.stats[0].netTouches).toBe(1);expect(m.stats[2].forcedErrorsCreated).toBe(0)
  expect(m.tracking.timeline[0].netCord).toBe('unlucky')
 })
 it('rejects invalid credit without changing the V1 impact inputs',()=>{
  for(const patch of [{forcedBy:1},{forcedBy:4},{outcome:'winner'},{netTouch:'yes'}])expect(()=>validateDoc({...freshDoc(),events:[{...error,...patch}]})).toThrow()
 })
})

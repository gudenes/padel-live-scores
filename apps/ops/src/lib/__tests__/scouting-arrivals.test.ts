import {describe,it,expect} from 'vitest'
import {freshDoc,replay,validateDoc,type Event,type ScoutDoc} from '../scouting/model'
import {sessionExport} from '../scouting/export'
const at='2026-10-04T14:00:00Z'
function prep():ScoutDoc{return {...freshDoc(),preparation:true,events:[]}}
const arrivals:Event[]=[{id:'a',at,kind:'pair_arrived',team:'a'},{id:'b',at:'2026-10-04T14:02:00Z',kind:'pair_arrived',team:'b'}]
const setup:Event={id:'setup',at:'2026-10-04T14:03:00Z',kind:'court_setup',settings:{rule:'advantage',firstServer:3,otherServer:1,near:'b'}}
describe('pre-match preparation',()=>{
 it('saves arrivals without starting any scoring clock and exports them',()=>{
  const doc={...prep(),events:arrivals};validateDoc(doc)
  const state=replay(doc);expect(state.ready).toBe(false);expect(state.arrivals.a).toBe(at)
  expect(state.tracking.startedAt).toBeNull();expect(state.tracking.rally).toBeNull();expect(state.points).toBe(0)
  expect(sessionExport('match',[],1,doc).summary.arrivals.b).toBe(arrivals[1].at)
 })
 it('requires both arrivals and court setup before rally or scoring',()=>{
  expect(()=>validateDoc({...prep(),events:[arrivals[0],setup]})).toThrow(/both pairs/)
  expect(()=>validateDoc({...prep(),events:[...arrivals,{id:'r',at,kind:'rally_start'}]})).toThrow(/Confirm court/)
  expect(()=>validateDoc({...prep(),events:[...arrivals,{id:'p',at,kind:'point',player:0,outcome:'winner',smash:false}]})).toThrow(/Confirm court/)
 })
 it('applies second-step settings and starts the clock only on the first rally',()=>{
  const doc={...prep(),events:[...arrivals,setup]};validateDoc(doc)
  expect(replay(doc)).toMatchObject({ready:true,server:3,near:'b',settings:{rule:'advantage'},tracking:{startedAt:null}})
  doc.events.push({id:'r',at:'2026-10-04T14:05:00Z',kind:'rally_start'})
  expect(replay(doc).tracking.startedAt).toBe('2026-10-04T14:05:00Z')
 })
 it('supports undo and prevents duplicate arrivals and setup',()=>{
  expect(()=>validateDoc({...prep(),events:[...arrivals,{...arrivals[0],id:'again'}]})).toThrow(/already recorded/)
  expect(()=>validateDoc({...prep(),events:[...arrivals,setup,{...setup,id:'again'}]})).toThrow()
  expect(replay({...prep(),events:[...arrivals,{id:'undo',at,kind:'undo'}]}).arrivals.b).toBeNull()
  expect(replay({...prep(),events:[...arrivals,setup,{id:'undo',at,kind:'undo'}]}).ready).toBe(false)
 })
 it('keeps existing sessions ready and rejects invalid new settings',()=>{
  expect(replay(freshDoc()).ready).toBe(true)
  expect(()=>validateDoc({...prep(),events:[...arrivals,{...setup,settings:{...freshDoc(),otherServer:1}}]})).toThrow(/Invalid court/)
 })
})

import {expect,it} from 'vitest'
import {freshDoc,replay,validateDoc,type Event} from '../scouting/model'
let id=0
const e=(kind:Event['kind'],seconds:number,extra={})=>({kind,...extra,id:String(++id),at:new Date(Date.UTC(2026,9,4,12,0,seconds)).toISOString()}) as Event
const start=(s=0)=>e('rally_start',s)
const win=(s=10)=>e('point',s,{player:0,outcome:'winner',smash:false})
const model=(events:Event[])=>replay({...freshDoc(),events})
it('starts match, game and serve clocks with the first rally and ends the rally with its outcome',()=>{
 const m=model([start(),win(18)])
 expect(m.tracking.scope).toBe('match');expect(m.tracking.startedAt).toBe('2026-10-04T12:00:00.000Z')
 expect(m.tracking.gameStartedAt).toBe(m.tracking.startedAt);expect(m.tracking.serviceStartedAt).toBe(m.tracking.startedAt)
 expect(m.tracking.rally).toBeNull();expect(m.tracking.rallies[0]).toMatchObject({server:0,durationMs:18000,winner:'a',firstFaultAt:null})
})
it('first fault does not score; double fault awards the receiving pair exactly one point',()=>{
 const events=[start(),e('first_fault',5)]
 expect(model(events).score.currentGame).toEqual({a:0,b:0});expect(model(events).tracking.rally?.firstFaultAt).toBeTruthy()
 const m=model([...events,e('double_fault',15)])
 expect(m.score.currentGame).toEqual({a:0,b:15});expect(m.points).toBe(1);expect(m.unclassified).toBe(0)
 expect(m.tracking.service[0]).toMatchObject({points:1,won:0,firstFaults:1,doubleFaults:1});expect(m.stats[0].unforced).toBe(0)
 expect(m.tracking.rallies[0]).toMatchObject({doubleFault:true,durationMs:15000,server:0});expect(m.tracking.rally).toBeNull()
})
it('allows a second-serve winner without a double fault',()=>{const m=model([start(),e('first_fault',5),win(20)]);expect(m.tracking.service[0]).toMatchObject({firstFaults:1,doubleFaults:0,won:1})})
it('rejects faults without starts, repeated faults, duplicate starts and an outcome before the next start',()=>{
 for(const events of [[e('first_fault',0)],[e('double_fault',0)],[start(),e('double_fault',10)],[start(),start(5)],[start(),e('first_fault',2),e('first_fault',4)],[start(),win(),win(20)]])expect(()=>validateDoc({...freshDoc(),events})).toThrow()
})
it('undo restores an active second serve and removes double-fault stats',()=>{
 const m=model([start(),e('first_fault',5),e('double_fault',10),e('undo',12)])
 expect(m.score.currentGame.b).toBe(0);expect(m.tracking.rally?.firstFaultAt).toBeTruthy();expect(m.tracking.service[0].doubleFaults).toBe(0);expect(m.tracking.rallies).toHaveLength(0)
})
it('prevents changing servers or correcting scores within an active rally',()=>{
 expect(()=>model([start(),e('server',1,{player:2})])).toThrow()
 expect(()=>model([start(),e('score',1,{seed:{sets:[{a:1,b:1}],game:{a:0,b:0},phase:'playing',returns:0,server:0}})])).toThrow()
})
it('a double fault converts a break point and Star Point, with automatic service rotation',()=>{
 const seed=e('score',0,{seed:{sets:[{a:0,b:0}],game:{a:40,b:40},phase:'playing',returns:2,server:0}})
 const m=model([seed,start(1),e('first_fault',4),e('double_fault',9)])
 expect(m.tracking.scope).toBe('observation');expect(m.tracking.pairs.b).toMatchObject({breaks:1,starPointsWon:1});expect(m.server).toBe(2)
})
it('the first rally of the next game starts its clock, excluding the changeover',()=>{
 const events=Array.from({length:4},(_,i)=>[start(i*20),win(i*20+10)]).flat()
 const m=model([...events,start(120)])
 expect(m.tracking.games[0].durationMs).toBe(70000);expect(m.tracking.gameStartedAt).toBe('2026-10-04T12:02:00.000Z');expect(m.tracking.rally?.server).toBe(2)
})
it('preserves old sessions without inventing rally starts',()=>{const m=model([win()]);expect(m.points).toBe(1);expect(m.tracking.rallies).toHaveLength(0)})

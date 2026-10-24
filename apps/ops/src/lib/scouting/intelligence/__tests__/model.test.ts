import {it,expect} from 'vitest'
import {aggregate,convertSession,type SessionRow,type Person} from '../model'
import {freshDoc,type Event} from '../../model'
const people=Array.from({length:4},(_,i)=>({id:'p'+i,name:'Player '+i,country:null,ranking:null,avatar_url:null,category:null})) as Person[]
function session(events:unknown[],extra:Partial<SessionRow>={}):SessionRow{return {match_id:'match',source:'admin',manual:false,date:null,tournament:'Example',round:null,players:people,revision:1,updated_at:'2026-10-23',document:{...freshDoc(),events:events.map((e,i)=>({id:String(i),at:'2026-10-23T12:00:00Z',...e as object}))},...extra}}
const point=(player:number,outcome='winner',extra={})=>({kind:'point',player,outcome,smash:false,...extra})
it('counts joint matches once and never combines opponents into a pair',()=>{
 const m=convertSession(session([point(0),point(1),point(2,'unforced')]),new Map())!
 expect(aggregate([m],['p0','p1'])).toMatchObject({matches:1,points:3,winners:2,inProgress:1,wins:0})
 expect(aggregate([m],['p0','p2']).matches).toBe(0)
})
it('includes assist contributions and undoes deleted points',()=>{
 const m=convertSession(session([point(0,'winner',{assistBy:1}),point(2),{kind:'undo'}]),new Map())!
 expect(m.points).toHaveLength(1)
 expect(m.points[0].contributors).toContain('p1')
 expect(aggregate([m],['p1']).winners).toBe(0)
 expect(aggregate([m],['p1']).impact).toBeGreaterThan(0)
})
it('uses explicit canonical manual links and rejects ambiguous identities',()=>{
 const m=convertSession(session([point(0)],{manual:true,roster:[{id:'p0',existingPlayerId:'canonical'}]}),new Map())!
 expect(m.players[0].id).toBe('canonical')
 expect(aggregate([m],['canonical']).winners).toBe(1)
 expect(convertSession(session([point(0)],{roster:[{id:'p0',existingPlayerId:'p1'}]}),new Map())).toBeNull()
})
it('zero sample remains distinguishable from a player with zero winners',()=>{
 expect(aggregate([],['p0'])).toMatchObject({matches:0,points:0,winners:0})
 const m=convertSession(session([point(2)]),new Map())!
 expect(aggregate([m],['p0'])).toMatchObject({matches:1,points:1,winners:0})
})
it('pools rally samples and counts available durations once for a pair',()=>{
 const base=convertSession(session([point(0)]),new Map())!
 const a={...base,rallyShots:20,rallySamples:2,durationMs:3600000}
 const b={...base,id:'second',rallyShots:6,rallySamples:1,durationMs:7200000}
 const missing={...base,id:'unknown'}
 const result=aggregate([a,b,missing],['p0','p1'])
 expect(result.rallyShots/result.rallySamples).toBeCloseTo(26/3)
 expect(result.durationMs/result.durationSamples).toBe(5400000)
 expect(result.durationSamples).toBe(2)
 expect(missing.durationMs).toBeNull()
})

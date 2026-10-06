import {describe,it,expect} from 'vitest'
import {savedReport} from '../saved-report'
import {freshDoc} from '../model'
const snapshot=(time:number)=>({tabId:1,documentId:'doc',videoId:'v',mediaId:'m',page:'https://youtube.com/watch?v=v',time,seekEpoch:0,readyState:4,paused:false,seeking:false,at:'2026-10-06T00:00:00Z'})
const session=()=>({revision:2,updated_at:'2026-10-06T00:00:00Z',players:[0,1,2,3].map(i=>({id:String(i),name:'Player '+i})),document:{version:1,label:'Test',cancelled:[],pending:null,setup:{names:['A1','A2','B1','B2'],firstServer:0,otherServer:2,rule:'star-point',adjustments:[{type:'ends',afterId:null,at:'2026-10-06T00:00:00Z'}],startingScore:{completed:[{a:6,b:4}],games:{a:5,b:4},points:{a:40,b:0},server:0,near:'a',advantageReturns:0}},rallies:[{id:'last',varReviewed:true,start:snapshot(100),end:snapshot(110),attempts:[{player:0,smashType:'power',snapshot:snapshot(105)}],touches:[{player:0,order:[2,3,0,1],snapshot:snapshot(102)},{player:2,order:[2,3,0,1],snapshot:snapshot(103)}],point:{player:0,outcome:'winner',shot:'smash',smashType:'power',smashAlreadyCounted:true,x4:true}}]}})
describe('saved extension data reuses admin insights without changing either session',()=>{
 it('preserves imported score, video timing, pressure, typed attempts, VAR and inferred taps',()=>{
  const row=session(),before=JSON.stringify(row),r=savedReport(row,'video')
  expect(r.model.score.phase).toBe('finished');expect(r.model.score.sets).toEqual([{a:6,b:4},{a:6,b:4}]);expect(r.model.points).toBe(1)
  expect(r.model.tracking.timeline[0].durationMs).toBe(10000);expect(r.model.tracking.timeline[0].matchPoint.a).toBe(true)
  expect(r.model.stats[0].smashes).toBe(1);expect(r.videoReport?.players[0].stats.powerSmashes).toBe(1);expect(r.videoReport?.players[0].stats.x4Winners).toBe(1)
  expect(r.videoReport?.varReviews).toBe(1);expect(r.videoReport?.shotTracking.shots).toBe(2);expect(r.videoReport?.shotTracking.players[0].downTheLine).toBe(1)
  expect(r.partial).toBe(true);expect(JSON.stringify(row)).toBe(before)
 })
 it('excludes undone points and retains the seeded score without fabricated stats',()=>{
  const row=session();Object.assign(row.document.rallies[0],{undone:true,undoneAt:'2026-10-06T00:00:01Z'})
  const r=savedReport(row,'video');expect(r.model.points).toBe(0);expect(r.model.stats[0].winners).toBe(0);expect(r.model.score.sets).toEqual([{a:6,b:4},{a:5,b:4}]);expect(r.videoReport).toBe(null)
 })
 it('keeps original admin scouting compatible and rejects malformed saved data',()=>{
  const row={...session(),document:freshDoc()},r=savedReport(row,'admin')
  expect(r.source).toBe('admin');expect(r.model.points).toBe(0);expect(r.videoReport).toBe(null)
  expect(()=>savedReport({...row,document:{}},'admin')).toThrow();expect(()=>savedReport({...row,players:[]},'admin')).toThrow()
 })
})

import {it,expect} from 'vitest'
import {freshDoc,replay,type Event} from '../scouting/model'
import {sessionExport,pointsCsv} from '../scouting/export'
const players=['=Coello','Tapia','Galán','Chingotto'].map((name,i)=>({id:String(i),name}))
const events:Event[]=[{kind:'rally_start',id:'1',at:'2026-10-04T12:00:00Z'},{kind:'first_fault',id:'2',at:'2026-10-04T12:00:05Z'},{kind:'double_fault',id:'3',at:'2026-10-04T12:00:12Z'}]
it('exports all events and detailed points with timing and score',()=>{const out=sessionExport('match',players,7,{...freshDoc(),events});expect(out.document.events).toEqual(events);const p=out.summary.tracking.timeline[0];expect(p).toMatchObject({server:0,player:0,winner:'b',lead:-1,durationMs:12000});expect(p.before.currentGame.b).toBe(0);expect(p.after.currentGame.b).toBe(15);const csv=pointsCsv(players,{...freshDoc(),events});expect(csv.split('\r\n')).toHaveLength(2);expect(csv).toContain('"\'=Coello"');expect(csv).toContain('"12000"')})
it('keeps undo history but removes undone graph and CSV points',()=>{const d={...freshDoc(),events:[...events,{kind:'undo',id:'4',at:'2026-10-04T12:00:13Z'} as Event]},out=sessionExport('match',players,8,d);expect(out.document.events).toHaveLength(4);expect(out.summary.tracking.timeline).toHaveLength(0);expect(out.activeEventIds).toEqual(['1','2']);expect(pointsCsv(players,d).split('\r\n')).toHaveLength(1)})
it('does not invent observed points from imported scores',()=>{const seed:Event={kind:'score',id:'0',at:'2026-10-04T11:59:00Z',seed:{sets:[{a:4,b:2}],game:{a:0,b:0},phase:'playing',returns:0,server:0}};const p=replay({...freshDoc(),events:[seed,...events]}).tracking.timeline[0];expect(p.lead).toBe(-1);expect(p.before.sets).toEqual([{a:4,b:2}])})
it('includes shot, side, assist and recovery in JSON and CSV',()=>{
 const doc={...freshDoc(),events:[{id:'tagged',at:'2026-10-04T12:00:00Z',kind:'point',player:0,outcome:'winner',smash:false,shot:'volley',side:'backhand',assistBy:1,recovery:true,smashRecovery:true,netCord:'lucky'} as Event]}
 const json=sessionExport('test',players,1,doc)
 expect(json.summary.stats[1].assists).toBe(1)
 expect(json.summary.tracking.timeline[0]).toMatchObject({shot:'volley',assistBy:1,recovery:true,smashRecovery:true,netCord:'lucky'})
 const csv=pointsCsv(players,doc)
 expect(csv).toContain('"smash_recovery","net_cord"');expect(csv).toContain('"true","true","lucky"');expect(csv).toContain('"outside_court_recovery"');expect(csv).toContain('"volley","backhand","1","Tapia","true"')
})

import {it,expect} from 'vitest'
import {freshDoc,replay,type Event} from '../scouting/model'
import {playerEvolution,scopedStats,teamSummary} from '../scouting/insights'
it('tracks each player independently and subtracts each error once',()=>{
 const acts=[{kind:'point',player:0,outcome:'winner',smash:true},{kind:'point',player:1,outcome:'unforced',smash:false},{kind:'point',player:2,outcome:'forced',smash:false},{kind:'rally_start'},{kind:'first_fault'},{kind:'double_fault'}]
 const events=acts.map((e,i)=>({...e,id:String(i),at:new Date(100000+i*1000).toISOString()})) as Event[]
 const series=playerEvolution(replay({...freshDoc(),events}).tracking.timeline)
 expect(series.map(p=>p.values)).toEqual([[1,0,0,0],[1,-1,0,0],[1,-1,-1,0],[0,-1,-1,0]])
 expect(series[0].values).toEqual([1,0,0,0])
})

it('keeps the set-winning point in its set and begins the next bar on the following point',async()=>{
 const {setSegments}=await import('../scouting/insights')
 const events:Event[]=[{kind:'score',id:'seed',at:'2026-10-04T12:00:00Z',seed:{sets:[{a:5,b:2}],game:{a:40,b:0},phase:'playing',returns:0,server:0}},...[1,2].map(i=>({kind:'point',player:0,outcome:'winner',smash:false,id:String(i),at:'2026-10-04T12:00:10Z'} as Event))]
 expect(setSegments(replay({...freshDoc(),events}).tracking.timeline)).toEqual([{set:1,first:1,last:1,score:{a:6,b:2},complete:true},{set:2,first:2,last:2,score:{a:0,b:0},complete:false}])
})

it('counts linked smash attempts once, assigns the closing point to its set and excludes imported scores',()=>{
 const acts=[{kind:'score',seed:{sets:[{a:5,b:2}],game:{a:40,b:0},phase:'playing',returns:0,server:0}},
 {kind:'smash',player:0},{kind:'point',player:0,outcome:'winner',smash:true,smashAttemptId:'1'},
 {kind:'smash',player:2},{kind:'point',player:2,outcome:'forced',forcedBy:1,smash:true,smashAttemptId:'3'}]
 const doc={...freshDoc(),events:acts.map((e,i)=>({...e,id:String(i),at:new Date(100000+i*1000).toISOString()})) as Event[]},all=replay(doc).tracking.timeline
 const second=all.filter(p=>p.before.sets.length===2),stats=scopedStats(doc,all,second)
 expect(stats.stats[0].smashes).toBe(0);expect(stats.stats[2].smashes).toBe(1);expect(stats.stats[2].smashErrors).toBe(1)
 const teams=teamSummary(second,stats)
 expect(teams[0]).toMatchObject({won:1,winners:0,created:1,smashes:0});expect(teams[1]).toMatchObject({won:0,forced:1,smashes:1,smashWinners:0})
 expect(teamSummary(all,scopedStats(doc,all,all))[0]).toMatchObject({won:2,winners:1,smashes:1,smashWinners:1})
})
it('keeps break opportunities, double faults, undone actions and corrected set ranges consistent',()=>{
 const acts=[{kind:'score',seed:{sets:[{a:2,b:5}],game:{a:0,b:40},phase:'playing',returns:0,server:0}},
 {kind:'point',player:2,outcome:'winner',smash:false},
 {kind:'point',player:1,outcome:'unforced',smash:false},
 {kind:'score',seed:{sets:[{a:2,b:5}],game:{a:0,b:0},phase:'playing',returns:0,server:0}},
 {kind:'point',player:0,outcome:'winner',smash:false},
 {kind:'undo'}]
 const doc={...freshDoc(),events:acts.map((e,i)=>({...e,id:String(i),at:new Date(100000+i*1000).toISOString()})) as Event[]},all=replay(doc).tracking.timeline
 const first=all.filter(p=>p.before.sets.length===1),teams=teamSummary(first,scopedStats(doc,all,first))
 expect(first).toHaveLength(1);expect(teams[1]).toMatchObject({won:1,breaks:1,breakPoints:1,winners:1});expect(teams[0].unforced).toBe(0)
})

it('combines revisited set segments without including other sets and preserves double-fault attribution',()=>{
 const seed=(sets:{a:number;b:number}[])=>({kind:'score',seed:{sets,game:{a:0,b:0},phase:'playing',returns:0,server:0}})
 const acts=[seed([{a:0,b:0}]),{kind:'point',player:0,outcome:'winner',smash:false},seed([{a:6,b:4},{a:0,b:0}]),{kind:'point',player:1,outcome:'unforced',smash:false},seed([{a:0,b:0}]),{kind:'point',player:0,outcome:'winner',smash:false},{kind:'rally_start'},{kind:'first_fault'},{kind:'double_fault'}]
 const doc={...freshDoc(),events:acts.map((e,i)=>({...e,id:String(i),at:new Date(100000+i*1000).toISOString()})) as Event[]},all=replay(doc).tracking.timeline,first=all.filter(p=>p.before.sets.length===1),stats=scopedStats(doc,all,first)
 expect(stats.stats[0].winners).toBe(2);expect(stats.stats[1].unforced).toBe(0)
 expect(teamSummary(first,stats)[0]).toMatchObject({won:2,doubleFaults:1});expect(teamSummary(first,stats)[1].won).toBe(1)
})

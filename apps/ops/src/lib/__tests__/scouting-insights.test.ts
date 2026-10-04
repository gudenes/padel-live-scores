import {it,expect} from 'vitest'
import {freshDoc,replay,type Event} from '../scouting/model'
import {playerEvolution} from '../scouting/insights'
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

import {it,expect} from 'vitest';
import {sprintEvents} from '../sprint-events';
import {motionSeries} from '../movement-efforts';
import type {TrackRow} from '../movement-series';
const rows:TrackRow[]=Array.from({length:101},(_,i)=>({source_s:i/10,segment_id:1,overlay_visible:true,players:{p:{court_m:[5,1+i*.4],position_source:'observed'}}}));
const players=[{key:'p',name:'Player',shortName:'P.'}];
it('attaches sprints to the correct rally and never merges across rally boundaries',()=>{
 const motion=motionSeries(rows,['p']);
 const events=sprintEvents(motion,players,[{id:'first',start:1,end:3},{id:'second',start:5,end:7}]);
 expect(events).toHaveLength(2);expect(events.map(e=>e.pointId)).toEqual(['first','second']);
 expect(events[0].end).toBeLessThan(3);expect(events[1].start).toBeGreaterThan(5);
 expect(events.every(e=>e.playerKey==='p'&&e.playerName==='P.'&&e.peak>=12)).toBe(true);
});
it('does not invent sprint events for unavailable tracking or untimed rallies',()=>{
 expect(sprintEvents(undefined,players,[{id:'x',start:1,end:3}])).toEqual([]);
 expect(sprintEvents(motionSeries(rows,['p']),players,[{id:'x',start:null,end:3},{id:'y',start:4,end:3}])).toEqual([]);
});

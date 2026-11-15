import {it,expect} from 'vitest';
import {rallyAt,rallyPressure} from '../rally-pressure';
import type {TrackRow} from '../movement-series';
const rows:TrackRow[]=Array.from({length:101},(_,i)=>({source_s:i/10,segment_id:1,overlay_visible:true,players:{a:{court_m:[2,i<50?18:12],position_source:'observed'},b:{court_m:[7,12],position_source:'observed'}}}));
const rally={start:0,end:11};
it('changes with video, uses only the trailing five seconds and pools teammates equally',()=>{
 expect(rallyPressure(rows,4,['a'],rally).score).toBe(0);
 expect(rallyPressure(rows,10,['a'],rally).score).toBe(100);
 expect(rallyPressure(rows,4,['a','b'],rally).score).toBe(50);
 expect(rallyPressure(rows,7,['a'],rally).score).toBeCloseTo(40);
});
it('resets at rally start and never rates between rallies',()=>{
 expect(rallyPressure(rows,5.2,['a'],{start:5,end:8}).score).toBeNull();
 expect(rallyPressure(rows,6,['a'],{start:5,end:8}).score).toBe(100);
 expect(rallyAt([{start:1,end:4},{start:5,end:8}],4.5)).toBeNull();
 expect(rallyPressure(rows,8,['a'],{start:5,end:8}).score).toBeNull();
});
it('rejects gaps, inferred positions and poor coverage; zero is a valid score',()=>{
 const missing=rows.map(r=>({...r,players:{...r.players,b:{...r.players.b,position_source:'inferred_hold'}}}));
 expect(rallyPressure(missing,4,['a','b'],rally).score).toBeNull();
 expect(rallyPressure(missing,4,['a'],rally).score).toBe(0);
 expect(rallyPressure(rows.filter(r=>r.source_s>3),4,['a'],rally).score).toBeNull();
 const cuts=rows.map((r,i)=>({...r,segment_id:i}));
 expect(rallyPressure(cuts,4,['a'],rally).score).toBeNull();
});

it('does not carry a score beyond the latest observed frame',()=>{expect(rallyPressure(rows.slice(0,31),4,['a'],rally).score).toBeNull();});

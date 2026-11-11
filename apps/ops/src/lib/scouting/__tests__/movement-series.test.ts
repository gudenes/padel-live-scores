import {describe,it,expect} from 'vitest';
import {movementSeries,speedBands,intensityBins,type TrackRow} from '../movement-series';
const rows=(n=31):TrackRow[]=>Array.from({length:n},(_,i)=>({source_s:i/10,segment_id:1,overlay_visible:true,players:{p0:{court_m:[i/10,5],position_source:'observed'}}}));
describe('observed movement charts',()=>{
 it('measures 1m/s and normalizes intensity by valid time',()=>{const s=movementSeries(rows(),['p0']).p0;expect(s).toHaveLength(3);expect(s[0].speed).toBeCloseTo(3.6);expect(speedBands(s)[1].percent).toBe(100);const long=movementSeries(rows(101),['p0']).p0;expect(intensityBins(long,0,30)[0].value).toBeCloseTo(60)});
 it('does not bridge cuts or inference',()=>{const r=rows(21);r[5].segment_id=2;r[15].players.p0.position_source='inferred';expect(movementSeries(r,['p0']).p0).toHaveLength(0)});
 it('does not bridge missing frames or impossible jumps',()=>{const r=rows(21).filter((_,i)=>i!==5&&i!==6);r[12].players.p0.court_m=[100,100];expect(movementSeries(r,['p0']).p0.every(s=>s.speed<=30)).toBe(true);expect(movementSeries(rows(11).filter((_,i)=>i!==5),['p0']).p0).toHaveLength(0);expect(movementSeries(rows(11).filter((_,i)=>i!==5&&i!==6),['p0']).p0).toHaveLength(0)});
 it('keeps empty bins unavailable rather than zero',()=>{expect(intensityBins([],0,60).map(b=>b.value)).toEqual([null,null]);expect(speedBands([]).every(b=>b.percent===0)).toBe(true)});
});
import {movementGroups,summarizeMovement,type MovementPoint} from '../movement-breakdown';
const point=(id:string,start:number,end:number):MovementPoint=>({id,number:Number(id),start,end,before:{sets:[{a:0,b:0}],currentGame:{a:0,b:0}}});
describe('scouted movement breakdown',()=>{
 it('aligns and merges overlapping intervals',()=>{
 const {groups,excluded}=movementGroups([point('1',100,103),point('2',102,105)],'game',0,10,100);
 expect(excluded).toBe(0);expect(groups[0].windows).toEqual([{start:0,end:5}]);expect(groups[0].points).toBe(2);
 });
 it('excludes points crossing edits or outside coverage',()=>{
 const result=movementGroups([point('1',100,105),point('2',110,112),point('3',200,202)],'point',0,30,0,{version:1,method:'test',offsetSeconds:100,segments:[{sourceFrom:103,offsetSeconds:99}]});
 expect(result.excluded).toBe(2);expect(result.groups[0].windows).toEqual([{start:11,end:13}]);
 });
 it('keeps complete windows and sums zone time',()=>{
 const v=summarizeMovement(movementSeries(rows(31),['p0']).p0,[{start:.5,end:2.5}]);
 expect(v.seconds).toBeCloseTo(1);expect(v.distance).toBeCloseTo(1);expect(v.zones[1]).toBeCloseTo(1);
 });
});
import {breakMovement} from '../movement-breakdown';
describe('break-point comparison',()=>{
 it('uses recorded break opportunities and conversions, not movement to infer outcomes',()=>{
 const pts=[{...point('1',100,102),breakPoint:'b' as const,breakConverted:true},point('2',102,104)];
 const result=breakMovement(pts,movementSeries(rows(41),['p0']).p0,0,4,100,undefined,'a');
 expect(result.events).toEqual([{time:0,end:2,number:1,converted:true,team:'b'}]);
 expect(result.comparisons.map(v=>v.trackedPoints)).toEqual([1,0,1]);
 expect(result.comparisons[0].intensity).toBeCloseTo(60);
 });
 it('does not report zero intensity when break-point tracking is absent',()=>{
 const result=breakMovement([{...point('1',100,102),breakPoint:'a'}],[],0,4,100,undefined,'b');
 expect(result.comparisons[0].intensity).toBeNull();expect(result.comparisons[0].trackedPoints).toBe(0);
 });
});

it('reverses serving and returning contexts when the selected team changes',()=>{
 const pts=[{...point('1',100,102),breakPoint:'b' as const,breakConverted:true},{...point('2',102,104),breakPoint:'a' as const,breakConverted:false}];
 const samples=movementSeries(rows(41),['p0']).p0;
 const a=breakMovement(pts,samples,0,4,100,undefined,'a').comparisons;
 const b=breakMovement(pts,samples,0,4,100,undefined,'b').comparisons;
 expect(a.map(v=>v.points)).toEqual([1,1,0]);
 expect(a.map(v=>v.successes)).toEqual([0,0,0]);
 expect(b.map(v=>v.successes)).toEqual([1,1,0]);
 expect(a[0].distance).toEqual(b[1].distance);
});
it('heatmap counts observed dwell time without carrying cells into later windows',()=>{
 const s=movementSeries(rows(21),['p0']).p0;
 expect(Object.values(s[0].heat??{}).reduce((a,b)=>a+b,0)).toBeCloseTo(1);
 expect(s[0].heat?.['0,5']).toBeCloseTo(1);
 expect(s[1].heat?.['1,5']).toBeCloseTo(1);
 expect(s[1].heat?.['0,5']).toBeUndefined();
});

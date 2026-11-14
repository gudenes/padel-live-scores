import {describe,it,expect} from 'vitest';
import {positionAt,trailAt,speedAt,pairMetrics,projectCourt} from '../tracking-overlay';
import type {TrackRow} from '../movement-series';
const rows=():TrackRow[]=>Array.from({length:31},(_,i)=>({source_s:i/10,segment_id:1,overlay_visible:true,players:{p0:{court_m:[i/10,5],position_source:'observed'}}}));
describe('tracking overlays',()=>{
 it('interpolates observed positions on the source-video clock',()=>{expect(positionAt(rows(),1.05,'p0')).toEqual([1.05,5]);expect(positionAt(rows(),-1,'p0')).toBeNull();expect(positionAt(rows(),3.2,'p0')).toBeNull();});
 it('hides gaps, cuts and inferred positions',()=>{const r=rows();r[15].overlay_visible=false;expect(positionAt(r,1.5,'p0')).toBeNull();expect(speedAt(r,2,'p0')).toBeNull();expect(trailAt(r,2,'p0')[0].time).toBe(1.6);r[20].players.p0.position_source='inferred_gap';expect(positionAt(r,2,'p0')).toBeNull();const c=rows();c[20].segment_id=2;expect(trailAt(c,2,'p0')).toHaveLength(1);expect(speedAt(c,2,'p0')).toBeNull();});
 it('calculates speed across chunk boundaries',()=>{const r=rows().map(p=>({...p,source_s:p.source_s+59}));expect(speedAt(r,60.1,'p0')).toBeCloseTo(3.6);expect(speedAt(r,59.2,'p0')).toBeNull();expect(trailAt(r,61.5,'p0').every(p=>p.time>=59.5)).toBe(true);});
 it('rejects missing samples, invalid coordinates and impossible speeds',()=>{expect(speedAt(rows().filter(r=>r.source_s!==1.5),2,'p0')).toBeNull();const r=rows();r[20].players.p0.court_m=[NaN,4];expect(positionAt(r,2,'p0')).toBeNull();const fast=rows().map(r=>({...r,players:{p0:{court_m:[r.source_s*20,5],position_source:'observed'}}}));expect(speedAt(fast,2,'p0')).toBeNull();});
 it('measures court distances',()=>{expect(pairMetrics([1,6],[4,2])).toEqual({spacing:5,depth:4});expect(pairMetrics([1,6],[4,14]).depth).toBe(0);});
 it('projects ground coordinates and rejects invalid transforms',()=>{expect(projectCourt([2,3],{start:0,end:5,inverseHomography:[[2,0,10],[0,3,20],[0,0,1]]})).toEqual([14,29]);expect(projectCourt([2,3],{start:0,end:5})).toBeNull();expect(projectCourt([2,3],{start:0,end:5,inverseHomography:[[1,0,0],[0,1,0],[0,0,0]]})).toBeNull();});
});

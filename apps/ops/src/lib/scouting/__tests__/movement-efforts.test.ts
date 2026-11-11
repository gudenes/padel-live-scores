import {describe,it,expect} from 'vitest';
import {motionSeries,effortSummary} from '../movement-efforts';
import type {TrackRow} from '../movement-series';
const track=(fn:(t:number)=>number[],n=41):TrackRow[]=>Array.from({length:n},(_,i)=>({source_s:i/10,segment_id:1,overlay_visible:true,players:{p:{court_m:fn(i/10),position_source:'observed'}}}));
describe('movement effort estimates',()=>{
 it('detects sustained running and direction relative to either end',()=>{
  for(const near of [false,true]){const s=motionSeries(track(t=>[5,near?19-4*t:1+4*t]),['p']).p;const v=effortSummary(s);expect(v.sprints).toHaveLength(1);expect(v.sprints[0].direction).toBe('Toward net');expect(v.sprints[0].peak).toBeCloseTo(14.4);expect(v.acceleration).toBeCloseTo(0);}
 });
 it('does not label a brief burst or standing jitter as a sprint',()=>{
  const s=motionSeries(track(t=>[5+Math.sin(t*20)*.02,15]),['p']).p;expect(effortSummary(s).sprints).toHaveLength(0);
  const brief=motionSeries(track(t=>[2+4*Math.min(t,.3),15]),['p']).p;expect(effortSummary(brief).sprints).toHaveLength(0);
 });
 it('estimates acceleration and braking from smooth speed changes',()=>{
  const a=effortSummary(motionSeries(track(t=>[1+.5*t*t,15]),['p']).p);expect(a.acceleration).toBeCloseTo(1,1);
  const b=effortSummary(motionSeries(track(t=>[1+4*t-.5*t*t,15]),['p']).p);expect(b.braking).toBeCloseTo(1,1);
 });
 it('splits at camera cuts and inference, and excludes incomplete selection support',()=>{
  const r=track(t=>[1+4*t,15]);r[20].players.p.position_source='inferred';const samples=motionSeries(r,['p']).p;
  expect(effortSummary(samples).sprints).toHaveLength(2);expect(samples.filter(s=>s.acceleration!==null).every(s=>s.end<2||s.start>2)).toBe(true);
  const selected=effortSummary(samples,[{start:0,end:1}]);expect(selected.samples.every(s=>s.start>=0&&s.end<=1)).toBe(true);
  const cut=track(t=>[1+4*t,15]);cut.forEach((r,i)=>{r.segment_id=i<20?1:2});expect(effortSummary(motionSeries(cut,['p']).p).sprints).toHaveLength(2);
 });
 it('does not bridge missing frames or impossible jumps',()=>{
  const r=track(t=>[1+4*t,15]).filter((_,i)=>i!==20);expect(effortSummary(motionSeries(r,['p']).p).sprints).toHaveLength(2);
  const jump=track(t=>[1,15]);jump[20].players.p.court_m=[100,100];expect(effortSummary(motionSeries(jump,['p']).p).sprints).toHaveLength(0);
 });
});

import {describe,it,expect} from 'vitest';
import {assessPair,DEFAULT_PAIR_RULES} from '../pair-position-rules';
import type {TrackRow} from '../movement-series';
const rows=(b:number[]=[6,13]):TrackRow[]=>Array.from({length:11},(_,i)=>({source_s:i/10,segment_id:1,overlay_visible:true,players:{a:{court_m:[2,13],position_source:'observed'},b:{court_m:b,position_source:'observed'}}}));
const assess=(r:TrackRow[])=>assessPair(r,1,['a','b'],DEFAULT_PAIR_RULES);
describe('experimental pair geometry rules',()=>{
 it('explains green, yellow, red and close-pair flags',()=>{
 expect(assess(rows()).level).toBe('green');
 expect(assess(rows([6,15])).reason).toContain('Depth 2.0 m');
 expect(assess(rows([6,15])).level).toBe('yellow');
 expect(assess(rows([6,17])).level).toBe('red');
 expect(assess(rows([2.5,13])).reason).toContain('Close pair');
 });
 it('includes threshold equality and responds to edited rules',()=>{
 expect(assess(rows([7,13])).level).toBe('yellow');
 expect(assess(rows([9,13])).level).toBe('red');
 expect(assessPair(rows([6,15]),1,['a','b'],{...DEFAULT_PAIR_RULES,depthWarning:2.5}).level).toBe('green');
 });
 it('does not rate cuts, missing or inferred observations',()=>{
 const cut=rows();cut[7].segment_id=2;expect(assess(cut).level).toBe('grey');
 const missing=rows();missing[7].players.b.position_source='inferred_gap';expect(assess(missing).level).toBe('grey');
 expect(assess(rows().filter(r=>r.source_s!==.7)).level).toBe('grey');
 });
 it('does not rate opposite court sides or outside recoveries',()=>{
 expect(assess(rows([6,5])).reason).toContain('ambiguity');
 expect(assess(rows([11,13])).reason).toContain('Outside-court');
 });
 it('requires history after seeking and averages brief spikes',()=>{
 expect(assessPair(rows(),.2,['a','b'],DEFAULT_PAIR_RULES).level).toBe('grey');
 const spike=rows();spike[10].players.b.court_m=[6,17];expect(assess(spike).level).toBe('green');
 });
});

import {describe,it,expect} from 'vitest';
import {analysisProgress} from './analysis-progress';
describe('worker progress presentation',()=>{
 it('uses stage progress without presenting it as full analysis completion',()=>{expect(analysisProgress({status:'running',stage:'players',progress:{processed:420,total:1000}})).toMatchObject({percent:42,index:1,pill:'Tracking players · 42%'});});
 it('does not invent progress for start-only stages',()=>{for(const stage of ['normalizing','preparing','uploading','movement','refinement'])expect(analysisProgress({status:'running',stage,progress:{processed:0,total:1}}).percent).toBeNull();});
 it('guards invalid progress and clamps valid readings',()=>{expect(analysisProgress({status:'running',stage:'ball',progress:{processed:1,total:0}}).percent).toBeNull();expect(analysisProgress({status:'running',stage:'ball',progress:{processed:20,total:10}}).percent).toBe(100);});
 it('separates queued, failed, cancelled and ready states',()=>{for(const [status,title] of [['queued','Waiting to start'],['failed','Analysis needs attention'],['cancelled','Analysis stopped'],['complete','Analysis ready']])expect(analysisProgress({status,stage:'players'}).title).toBe(title);});
});

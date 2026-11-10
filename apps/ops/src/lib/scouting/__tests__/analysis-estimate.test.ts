import {describe,it,expect} from 'vitest'
import {estimateAnalysis} from '../analysis-estimate'
import benchmark from '../data/analysis-benchmark.json'
const now=Date.now();const base={id:'estimate-test',worker_id:benchmark.workerIds[0],status:'running',stage:'players',setup:{analysisSeconds:3600},updated_at:new Date(now).toISOString(),progress:{processed:0,total:3600}}
describe('whole analysis estimate',()=>{
 it('includes future ball work, not just the current stage',()=>{const e=estimateAnalysis(base,now)!;expect(e.lowSeconds).toBeGreaterThan(3600*benchmark.ball.low);expect(e.highSeconds).toBeGreaterThan(e.lowSeconds);expect(e.blocks).toBe(19)})
 it('reduces remaining work as the job advances',()=>{const a=estimateAnalysis({...base,id:'a'},now)!;const b=estimateAnalysis({...base,id:'b',stage:'ball',progress:{processed:1800,total:3600}},now)!;expect(b.highSeconds).toBeLessThan(a.lowSeconds)})
 it('uses real update throughput once enough time has elapsed',()=>{estimateAnalysis({...base,id:'live'},now);const e=estimateAnalysis({...base,id:'live',updated_at:new Date(now+60000).toISOString(),progress:{processed:120,total:3600}},now+60000)!;expect(e.live).toBe(true);expect(e.stageSeconds).toBe(1740)})
 it('withholds stale, completed and different-device estimates',()=>{expect(estimateAnalysis(base,now+46000)).toBeNull();expect(estimateAnalysis({...base,status:'complete'},now)).toBeNull();expect(estimateAnalysis({...base,worker_id:'another'},now)).toBeNull()})
 it('does not count a refined block twice',()=>{const e=estimateAnalysis({...base,id:'refine',stage:'refinement',progress:{processed:3000,total:3600}},now)!;expect(e.highSeconds).toBe(600)})
 it('does not turn repeated browser polls into measured speed',()=>{estimateAnalysis({...base,id:'poll'},now);expect(estimateAnalysis({...base,id:'poll'},now+30000)?.live).toBe(false)})
})

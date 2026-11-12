import {describe,it,expect} from 'vitest'
import {datasetSummary,evaluatePredictions,validateSplit,issues} from '../training'
const a={id:'a',kind:'Shot contact',shot:'Volley',status:'verified',confirmed:true,timingVerified:true,player:'Player',time:10,start:9,end:11,duration:60,box:{x:.1,y:.1,width:.2,height:.4},matchId:'match1'}
describe('Training dataset integrity',()=>{
 it('uses latest revisions and never resurrects rejected labels',()=>{const s=datasetSummary([a,{...a,id:'b',supersedes:'a',status:'excluded'}]);expect(s.ready).toHaveLength(0);expect(s.rejected).toBe(1)})
 it('separates quick classification approvals from verified contacts',()=>{const s=datasetSummary([{...a,status:'needs_review',confirmed:false,timingVerified:false,quickDecision:'shot',classificationReviewed:true}]);expect(s.accepted).toHaveLength(1);expect(s.ready).toHaveLength(0);expect(issues(s.accepted[0])).toContain('Contact timing')})
 it('rejects invalid clip bounds and boxes',()=>{expect(issues({...a,end:80})).toContain('Clip bounds');expect(issues({...a,box:{...a.box,width:2}})).toContain('Hitter box')})
 it('keeps overhead original labels and groups only for starter classes',()=>{const s=datasetSummary([{...a,shot:'Bandeja'}]);expect(s.ready[0].shot).toBe('Bandeja');expect(s.classes.find(c=>c.name==='Overhead')?.ready).toBe(1)})
 it('does not treat three clips in one match as three independent splits',()=>{expect(validateSplit([a,{...a,id:'b'},{...a,id:'c'}],{match1:'train'}).canTrain).toBe(false)})
})
describe('Evaluation import',()=>{
 const snapshot={samples:[a,{...a,id:'b',matchId:'match2'},{...a,id:'c',matchId:'match2',shot:'Lob'}],split:{match1:'train',match2:'test'}}
 it('rejects train leakage, duplicate IDs, invalid scores',()=>{expect(()=>evaluatePredictions(snapshot,[{annotationId:'a',shot:'Volley',confidence:.8}])).toThrow();expect(()=>evaluatePredictions(snapshot,[{annotationId:'b',shot:'Volley',confidence:.8},{annotationId:'b',shot:'Volley',confidence:.8}])).toThrow();expect(()=>evaluatePredictions(snapshot,[{annotationId:'b',shot:'Volley',confidence:2}])).toThrow()})
 it('reports incomplete coverage instead of making a whole-test claim',()=>{const r=evaluatePredictions(snapshot,[{annotationId:'b',shot:'Volley',confidence:.8}]);expect(r.complete).toBe(false);expect(r.total).toBe(2);expect(r.evaluated).toBe(1)})
 it('calculates confusion and F1 from labels, not supplied metrics',()=>{const r=evaluatePredictions(snapshot,[{annotationId:'b',shot:'Lob',confidence:.8},{annotationId:'c',shot:'Lob',confidence:.9}]);expect(r.accuracy).toBe(.5);expect(r.complete).toBe(true);expect(r.classes.find(c=>c.name==='Lob')?.f1).toBeCloseTo(2/3)})
})

describe('Separate smash class and snapshot compatibility',()=>{
 it('counts smash separately',()=>{const s=datasetSummary([{...a,id:'s',shot:'Smash'},{...a,id:'b',shot:'Bandeja'}]);expect(s.classes.find(c=>c.name==='Smash')?.ready).toBe(1);expect(s.classes.find(c=>c.name==='Overhead')?.ready).toBe(1)})
 it('preserves old five-class snapshot evaluation',()=>{const s={samples:[{...a,shot:'Smash'}],split:{match1:'test'},classMapping:'starter-five-v1'};expect(evaluatePredictions(s,[{annotationId:'a',shot:'Overhead',confidence:.9}]).accuracy).toBe(1);expect(()=>evaluatePredictions(s,[{annotationId:'a',shot:'Smash',confidence:.9}])).toThrow()})
 it('evaluates new snapshots with Smash',()=>{const s={samples:[{...a,shot:'Smash'}],split:{match1:'test'},classMapping:'starter-six-v2'};expect(evaluatePredictions(s,[{annotationId:'a',shot:'Smash',confidence:.9}]).accuracy).toBe(1)})
})

describe('Wall shot classes',()=>{
 it('makes existing Bajada and Contrapared labels eligible without changing them',()=>{const samples=['Bajada','Contrapared'].map((shot,i)=>({...a,id:String(i),shot}));const before=JSON.stringify(samples);const summary=datasetSummary(samples);for(const shot of ['Bajada','Contrapared'])expect(summary.classes.find(c=>c.name===shot)).toMatchObject({accepted:1,ready:1});expect(JSON.stringify(samples)).toBe(before)})
 it('keeps missing-box checks for the new classes',()=>{expect(datasetSummary([{...a,shot:'Bajada',box:null}]).ready).toHaveLength(0)})
 it('preserves six-class snapshots and evaluates eight-class snapshots',()=>{const old={samples:[{...a,shot:'Bajada'}],split:{match1:'test'},classMapping:'starter-six-v2'};expect(()=>evaluatePredictions(old,[{annotationId:'a',shot:'Bajada',confidence:.9}])).toThrow();const current={...old,classMapping:'starter-eight-v3'};expect(evaluatePredictions(current,[{annotationId:'a',shot:'Bajada',confidence:.9}]).accuracy).toBe(1)})
})

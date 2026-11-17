import {describe,it,expect} from 'vitest'
import {approveLocal,preflight} from '../local-training'
const snapshot={id:'s',sha256:'hash',canTrain:true,classMapping:'starter-eight-v3',samples:[{matchId:'a'},{matchId:'b'},{matchId:'c'}],split:{a:'train',b:'validation',c:'test'}}
const report={snapshotId:'s',snapshotSha256:'hash',model:'pose-mlp-v1',counts:{train:{eligible:1,usable:1},validation:{eligible:1,usable:1},test:{eligible:1,usable:1}}}
describe('Local run approval and frozen-data checks',()=>{
 it('requires matching frozen snapshot, three splits and nonempty coverage',()=>{expect(preflight(snapshot,report).test.usable).toBe(1);expect(()=>preflight(snapshot,{...report,snapshotSha256:'other'})).toThrow();expect(()=>preflight({...snapshot,split:{a:'train',b:'train',c:'test'}},report)).toThrow();expect(()=>preflight(snapshot,{...report,counts:{...report.counts,test:{eligible:1,usable:0}}})).toThrow()})
 it('only approves an online pending local plan owned by the caller',()=>{const p={execution:'local',createdBy:'owner',status:'awaiting_approval',lastSeenAt:new Date().toISOString()};expect(approveLocal(p,'owner').status).toBe('queued');for(const changed of [{createdBy:'other'},{status:'running'},{status:'queued'},{execution:'cloud'},{lastSeenAt:'2000-01-01'}])expect(()=>approveLocal({...p,...changed},'owner')).toThrow()})
})

import {snapshotArtifacts,missingSplits} from '../local-training'
describe('Dataset-specific training views',()=>{
 it('never substitutes old runs or evaluations when the selected snapshot has none',()=>{const artifacts=[{id:'old-run',snapshotId:'old',kind:'plan'},{id:'old-results',snapshotId:'old',kind:'evaluation'}];expect(snapshotArtifacts(artifacts,'new')).toEqual([]);expect(snapshotArtifacts(artifacts,'old')).toHaveLength(2)})
 it('identifies an absent held-out test split',()=>{expect(missingSplits({...snapshot,split:{a:'train',b:'validation',c:'train'}})).toEqual(['test']);expect(missingSplits(snapshot)).toEqual([])})
})

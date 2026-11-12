import {describe,it,expect} from 'vitest'
import {resolveAnnotationRevision} from '../library-review'
describe('Saved annotation review',()=>{
 it('resolves latest revisions including rejection without changing original times',()=>{const a={id:'a',time:10.133},b={id:'b',supersedes:'a',time:10.2},c={id:'c',supersedes:'b',status:'excluded'};expect(resolveAnnotationRevision([a,b,c],'a')).toEqual(c);expect(a.time).toBe(10.133)})
 it('selects manual annotations by ID rather than an absent candidate ID',()=>{const rows=[{id:'a',time:1},{id:'b',time:2}];expect(resolveAnnotationRevision(rows,'b')).toEqual(rows[1]);expect(resolveAnnotationRevision(rows,undefined)).toBeUndefined()})
})

import {libraryEligibility} from '../library-review'
describe('Library eligibility filter matches training requirements',()=>{
 const shot={kind:'Shot contact',shot:'Smash',status:'verified',timingVerified:true,player:'A',time:10,start:9,end:11,box:{x:.1,y:.1,width:.2,height:.4}}
 it('includes missing boxes, even when a stale stored eligibility flag says ready',()=>{expect(libraryEligibility({...shot,box:null,trainingEligible:true},60)).toMatchObject({eligible:false,needsReview:true,reasons:['Hitter box']})})
 it('does not send rejected shots into the not-eligible correction queue',()=>{expect(libraryEligibility({...shot,status:'excluded'},60).needsReview).toBe(false)})
 it('recognizes smash and recomputes eligibility after a correction',()=>{expect(libraryEligibility(shot,60).eligible).toBe(true);expect(libraryEligibility({...shot,end:70},60).reasons).toContain('Clip bounds')})
})

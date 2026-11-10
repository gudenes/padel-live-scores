import {describe,it,expect} from 'vitest'
import {parseAnnotation} from '../annotations'
const base={kind:'Shot contact',time:10,start:9,end:12,player:'Player A',shot:'Volley',side:'Forehand',direction:'Unknown',status:'needs_review',notes:'',confirmed:false}
describe('human annotation validation',()=>{
 it('keeps uncertain labels unverified',()=>expect(parseAnnotation(base,60,['Player A']).status).toBe('needs_review'))
 it('requires explicit timing confirmation',()=>expect(()=>parseAnnotation({...base,status:'verified'},60,['Player A'])).toThrow(/Confirm/))
 it('rejects wrong player identity',()=>expect(()=>parseAnnotation(base,60,['Player B'])).toThrow(/player/))
 it.each([{start:11},{end:8},{time:NaN},{end:61},{time:-1}])('rejects invalid temporal ranges %j',patch=>expect(()=>parseAnnotation({...base,...patch},60,['Player A'])).toThrow())
 it('accepts verified contact only after review',()=>expect(parseAnnotation({...base,status:'verified',confirmed:true},60,['Player A']).confirmed).toBe(true))
})

describe('player bounding boxes',()=>{
 it('preserves normalized human box and serve viewpoint',()=>{const box={x:.1,y:.2,width:.2,height:.4};const result=parseAnnotation({...base,box,shot:'Serve',viewpoint:'Back',serveAttempt:'Second'},60,['Player A']);expect(result.box).toEqual(box);expect(result.boxSource).toBe('human');expect(result.viewpoint).toBe('Back');expect(result.serveAttempt).toBe('Second')})
 it.each([{x:-.1,y:0,width:.2,height:.2},{x:.9,y:0,width:.2,height:.2},{x:0,y:0,width:0,height:.2},{x:NaN,y:0,width:.2,height:.2}])('rejects invalid box %j',box=>expect(()=>parseAnnotation({...base,box},60,['Player A'])).toThrow(/Bounding box/))
 it('accepts legacy annotations without a box',()=>expect(parseAnnotation(base,60,['Player A']).box).toBeNull())
})

describe('serve review decisions',()=>{
 const candidateId='pose-wrist-peaks-v1:p0:10.000'
 it('keeps rejection distinct from no contact',()=>{const r=parseAnnotation({...base,candidateId,serveDecision:'not_serve',status:'excluded'},60,['Player A']);expect(r.serveDecision).toBe('not_serve')})
 it('requires approved serves to have confirmed timing',()=>expect(()=>parseAnnotation({...base,candidateId,serveDecision:'serve',shot:'Serve',status:'verified'},60,['Player A'])).toThrow())
 it('rejects malformed candidate identifiers',()=>expect(()=>parseAnnotation({...base,candidateId:'../invalid'},60,['Player A'])).toThrow())
})

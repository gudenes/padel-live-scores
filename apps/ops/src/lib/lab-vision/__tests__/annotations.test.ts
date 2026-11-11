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

describe('four player serve review',()=>{
 const names=['A','B','C','D']
 const box={x:.1,y:.2,width:.1,height:.3}
 const participants=names.map((player,i)=>({player,role:['Server','Server’s partner','Receiver','Receiver’s partner'][i],visibility:'visible',box}))
 const serve={...base,player:'A',shot:'Serve',serveDecision:'serve',status:'verified',confirmed:true,participants}
 it('saves four roles and boxes',()=>expect(parseAnnotation(serve,60,names).participants).toEqual(participants))
 it('allows an explicitly occluded player',()=>expect(parseAnnotation({...serve,participants:participants.map((p,i)=>i===1?{...p,visibility:'not_visible',box:null}:p)},60,names).participants[1].box).toBeNull())
 it('rejects same-team receiver',()=>expect(()=>parseAnnotation({...serve,participants:participants.map((p,i)=>({...p,role:['Server','Receiver','Server’s partner','Receiver’s partner'][i]}))},60,names)).toThrow(/teams/))
 it('rejects duplicate identities',()=>expect(()=>parseAnnotation({...serve,participants:[participants[0],participants[0],participants[2],participants[3]]},60,names)).toThrow(/four/))
 it('rejects missing box on approval',()=>expect(()=>parseAnnotation({...serve,participants:participants.map((p,i)=>i===1?{...p,visibility:'unmarked',box:null}:p)},60,names)).toThrow(/four/))
})

 it('keeps a quick-review hitter box without claiming verified timing or identity',()=>{
  const box={x:.2,y:.3,width:.1,height:.4}
  for(const boxOrigin of ['pose-proposal','pose-adjusted','human']){
   const result=parseAnnotation({...base,candidateId:'scout:872e6f34-5304-42a7-a23c-685a25c72340:872e6f34-5304-42a7-a23c-685a25c72340:touch-0',quickDecision:'shot',classificationReviewed:true,box,boxOrigin},60,['Player A'])
   expect(result.player).toBe('Player A');expect(result.box).toEqual(box);expect(result.boxOrigin).toBe(boxOrigin)
   expect(result.timingVerified).toBe(false);expect(result.playerIdentityVerified).toBe(false)
  }
 })

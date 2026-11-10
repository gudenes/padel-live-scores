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

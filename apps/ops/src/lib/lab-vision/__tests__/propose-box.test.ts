import {describe,it,expect} from 'vitest'
import {proposeBox} from '../propose-box'
const joints=Array.from({length:17},(_,i)=>[100+i*3,100+i*10,.95])
const manifest={sourceDimensions:[1000,1000],coverage:[[10,12,1],[12.1,14,2]]}
const poses=[{t:11,players:{p0:joints}}]
describe('tracked pose box proposals',()=>{
 it('pads joints and normalizes the box',()=>{const p=proposeBox(manifest,poses,11,'p0')!;expect(p.sampleTime).toBe(11);expect(p.box.x).toBeLessThan(.1);expect(p.box.y).toBeLessThan(.1);expect(p.box.y+p.box.height).toBeGreaterThan(.26)})
 it('does not propose stale positions',()=>expect(proposeBox(manifest,poses,11.1,'p0')).toBeNull())
 it('does not borrow a different player',()=>expect(proposeBox(manifest,poses,11,'p1')).toBeNull())
 it('does not bridge a camera cut',()=>expect(proposeBox(manifest,[{t:12,players:{p0:joints}}],12.1,'p0')).toBeNull())
 it('rejects missing feet',()=>expect(proposeBox(manifest,[{t:11,players:{p0:joints.map((p,i)=>i===16?[p[0],p[1],.1]:p)}}],11,'p0')).toBeNull())
 it('rejects out-of-coverage frames',()=>expect(proposeBox(manifest,poses,9,'p0')).toBeNull())
})

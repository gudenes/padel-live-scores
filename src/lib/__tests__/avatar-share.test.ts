import {describe,it,expect} from 'vitest'
import {clearAvatarBackdrop} from '../avatar-share'

describe('transparent avatar export',()=>{
 it('clears the backdrop but preserves enclosed dark details and colored edges',()=>{
  const width=5, pixels=new Uint8ClampedArray(5*5*4)
  for(let i=0;i<25;i++)pixels.set([36,37,32,255],i*4)
  for(let y=1;y<=3;y++)for(let x=1;x<=3;x++)if(x!==2||y!==2)pixels.set([180,90,40,255],(y*width+x)*4)
  clearAvatarBackdrop(pixels,5,5)
  expect(pixels[3]).toBe(0)
  expect(pixels[(2*width+2)*4+3]).toBe(255)
  expect(pixels[(1*width+1)*4+3]).toBe(255)
 })
})

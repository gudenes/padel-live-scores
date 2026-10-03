import {describe,it,expect} from 'vitest'
import sharp from 'sharp'
import {markA01Avatar,avatarArtVersion} from '../avatar-art-version'
import {renderAvatar} from '../avatar-a01-renderer.mjs'
describe('versioned custom A01 artwork',()=>{
 it('keeps PNG pixels intact and identifies new versus legacy images',async()=>{
  const original=await sharp({create:{width:32,height:48,channels:4,background:'#ffaa00'}}).png().toBuffer()
  const marked=markA01Avatar(original)
  expect(avatarArtVersion(original)).toBe('legacy')
  expect(avatarArtVersion(marked)).toBe('a01-v1')
  expect(await sharp(marked).raw().toBuffer()).toEqual(await sharp(original).raw().toBuffer())
  expect(avatarArtVersion(marked.subarray(0,35))).toBe('legacy')
 })
 it('retains the personal image for every hat instead of substituting a roster face',()=>{
  for(const hat of ['starter','club','cobalt','sunset','champion','backwards','bandana']){
   const svg=renderAvatar({customSource:'/api/play/avatar/image?id=test',outfit:{hat,shirt:'club'}})
   expect(svg).toContain('/api/play/avatar/image?id=test')
   expect(svg).not.toContain('characters/face-06')
   expect(svg).not.toContain('fitted-v')
   expect(svg).toContain('data-avatar-renderer="a01"')
  }
 })
})

import {afterEach,describe,it,expect,vi} from 'vitest'
import {usesA01Artwork,a01Outfit} from '../avatar-a01'
import {renderAvatar} from '../avatar-a01-renderer.mjs'
afterEach(()=>vi.unstubAllEnvs())
describe('A01 wardrobe integration',()=>{
 it('keeps the incomplete art rollout local',()=>{
  vi.stubEnv('NODE_ENV','development')
  expect(usesA01Artwork('face-06')).toBe(true)
  expect(usesA01Artwork('face-01')).toBe(true)
  for(let i=1;i<=10;i++) expect(usesA01Artwork(`face-${String(i).padStart(2,'0')}`)).toBe(true)
  expect(usesA01Artwork('face-11')).toBe(false)
  expect(usesA01Artwork('custom:photo')).toBe(false)
  vi.stubEnv('NODE_ENV','production')
  expect(usesA01Artwork('face-06')).toBe(false)
 })
 it('maps special headwear without confusing their collection',()=>{
  expect(a01Outfit({hat:'hat-backwards',shirt:'shirt-cobalt'})).toEqual({hat:'backwards',shirt:'cobalt'})
  expect(a01Outfit({hat:'hat-bandana',shirt:'shoes-club'})).toEqual({hat:'bandana'})
 })
 it('uses the fitted cap source across clothes without adding a second hat',()=>{
  const svg=renderAvatar({avatar:'face-06',outfit:a01Outfit({hat:'hat-club',shirt:'shirt-cobalt'}),base:'/play/avatars/a01-local/'})
  expect(svg).toContain('face-06-club-fitted-study-v1.png')
  expect(svg).not.toContain('wardrobe/club.png')
  expect(svg).toContain('data-portrait-crop="310 45 430 445"')
  expect(renderAvatar({avatar:'face-06',outfit:{hat:'starter'}})).not.toContain('fitted-study')
 })
})

describe('fitted headwear variants',()=>{
 it.each([['face-05','backwards','face-05-backwards-fitted-v5.png'],['face-01','club','face-01-club-fitted-v2.png'],['face-06','backwards','face-06-backwards-fitted-v2.png']])('keeps %s / %s fitted through wardrobe changes',(avatar,hat,file)=>{
  const svg=renderAvatar({avatar,outfit:{hat,shirt:'cobalt',shorts:'sunset'}})
  expect(svg).toContain(file)
  expect(svg).not.toContain('wardrobe/'+hat+'.png')
  expect(svg).not.toContain('reverse-three-quarter')
  expect(renderAvatar({avatar,outfit:{hat:'starter'}})).not.toContain(file)
 })
})

describe('complete fitted headwear roster',()=>{
 for(const avatar of Array.from({length:10},(_,i)=>`face-${String(i+1).padStart(2,'0')}`)){
  it.each(avatar==='face-10'?['club']:['club','cobalt','sunset','champion','backwards','bandana'])('uses a fitted source for '+avatar+' / %s',(hat)=>{
   const svg=renderAvatar({avatar,outfit:{hat,shirt:'cobalt',shorts:'sunset',shoes:'club'}})
   expect(svg).toMatch(new RegExp(avatar+'-'+hat+'-fitted'))
   expect(svg).not.toContain('wardrobe/')
   expect(svg).not.toContain('mask="url(#a01-crown-mask)"')
  })
 }
})

describe('full A01 character rollout',()=>{
 it.each(Array.from({length:10},(_,i)=>`face-${String(i+1).padStart(2,'0')}`))('renders %s in full-body and portrait views with every collection',(avatar)=>{
  for(const collection of ['starter','club','cobalt','sunset','champion']){
   for(const portrait of [false,true]){
    const svg=renderAvatar({avatar,portrait,outfit:{shirt:collection,shorts:collection,shoes:collection,wrist:collection,racket:collection}})
    expect(svg).toContain(`characters/${avatar}.png`)
    expect(svg).toContain('data-avatar-renderer="a01"')
    expect(svg).not.toMatch(/undefined|NaN/)
   }
  }
 })
})

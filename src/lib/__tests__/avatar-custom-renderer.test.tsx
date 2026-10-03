import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe,it,expect,vi} from 'vitest'
const state=vi.hoisted(()=>({version:'a01-v1'}))
vi.mock('@/hooks/useAvatarArtVersion',()=>({useAvatarArtVersion:()=>state.version}))
import {Figure} from '@/components/player/shop/WardrobeFigure'
import {PlayerFigure} from '@/components/PlayerAvatar'
import {initialShopState} from '@/lib/avatar-shop'
Object.assign(globalThis,{React})
const avatar='custom:23324cab-b3f0-4019-b4b0-c1ec708990b2' as const
describe('photo avatar renderer integration',()=>{
 it('uses the complete custom image for wardrobe and portrait',()=>{
  state.version='a01-v1'
  for(const html of [renderToStaticMarkup(<Figure state={{...initialShopState(),avatar}} preview={null} original={false}/>),renderToStaticMarkup(<PlayerFigure outfit={avatar} portrait/>)]){
   expect(html).toContain('data-avatar-renderer="a01"')
   expect(html).toContain('/api/play/avatar/image?id=23324cab')
   expect(html).not.toContain('body-only')
   expect(html).not.toContain('characters/face-06')
  }
 })
 it('does not flash the legacy body while checking the version',()=>{
  state.version='loading'
  const html=renderToStaticMarkup(<Figure state={{...initialShopState(),avatar}} preview={null} original={false}/>)
  expect(html).toContain('Loading avatar')
  expect(html).not.toContain('<svg')
 })
})

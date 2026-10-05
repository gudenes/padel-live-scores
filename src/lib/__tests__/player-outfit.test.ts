import { describe, it, expect } from 'vitest'
import { parseOutfit, outfitStorageKey } from '../player-outfit'
describe('local player wardrobe', () => {
  it('only accepts catalog outfits from browser storage', () => {
    expect(parseOutfit('court-club')).toBe('court-club')
    expect(parseOutfit('../../other')).toBeNull()
    expect(parseOutfit(null)).toBeNull()
    expect(parseOutfit('')).toBeNull()
  })
  it('separates saved outfits by signed-in account', () => {
    expect(outfitStorageKey('alice')).not.toBe(outfitStorageKey('bob'))
    expect(outfitStorageKey('alice')).toBe('pn:outfit:v1:alice')
  })
})

import { PLAYER_FACES, playerImageSrc } from '../player-outfit'
it('supports ten faces and only valid private generated image identifiers', () => {
  expect(new Set(PLAYER_FACES).size).toBe(10)
  for (const face of PLAYER_FACES) expect(parseOutfit(face)).toBe(face)
  const custom = 'custom:20fca730-15c5-4e54-ab12-b2e34e2fd913'
  expect(parseOutfit(custom)).toBe(custom)
  expect(playerImageSrc(custom)).toBe('/api/play/avatar/image?id=20fca730-15c5-4e54-ab12-b2e34e2fd913')
  expect(parseOutfit('custom:../../secret')).toBeNull()
  expect(parseOutfit('https://external.example/face.png')).toBeNull()
})

import { splitPlayerLook, withPlayerFace, withPlayerClothes } from '../player-outfit'
it('keeps a custom face through outfit changes and storage reloads', () => {
 const face = 'custom:20fca730-15c5-4e54-ab12-b2e34e2fd913'
 const look = withPlayerClothes(withPlayerFace('starter',face),'night-match')
 expect(splitPlayerLook(parseOutfit(look)!)).toEqual({face,clothes:'night-match'})
 expect(splitPlayerLook(withPlayerFace(look,'face-03'))).toEqual({face:'face-03',clothes:'night-match'})
 expect(splitPlayerLook('court-club')).toEqual({face:'starter',clothes:'court-club'})
 expect(parseOutfit('look:face-01|../../secret')).toBeNull()
 expect(parseOutfit('look:bad|starter')).toBeNull()
})

import {simulationPlayerLook,simulationPlayerWardrobe} from '../player-outfit'
import {renderAvatar} from '../avatar-a01-renderer.mjs'
import {existsSync} from 'node:fs'
it('renders varied stable bot wardrobes with existing fitted artwork',()=>{
 const looks=new Set<string>(),shirts=new Set<string>(),hats=new Set<string>()
 for(let i=1;i<=150;i++){
  const identity=`bot-${i}`,wardrobe=simulationPlayerWardrobe(identity)
  expect(wardrobe).toEqual(simulationPlayerWardrobe(identity))
  const face=splitPlayerLook(simulationPlayerLook(identity)).face
  const svg=renderAvatar({avatar:face,outfit:wardrobe,base:'/play/avatars/a01-local/'})
  for(const match of svg.matchAll(/href="([^"]+)"/g)) expect(existsSync(`public${match[1]}`)).toBe(true)
  shirts.add(wardrobe.shirt);hats.add(wardrobe.hat);looks.add(JSON.stringify(wardrobe))
 }
 expect(shirts.size).toBe(5);expect(hats.size).toBe(7);expect(looks.size).toBeGreaterThan(20)
})

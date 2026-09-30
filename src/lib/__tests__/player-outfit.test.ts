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

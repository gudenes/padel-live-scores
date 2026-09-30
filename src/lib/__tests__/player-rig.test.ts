import { it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { playerArtwork } from '../player-rig'
import { withPlayerClothes, PLAYER_FACES, OUTFITS } from '../player-outfit'

it.each(PLAYER_FACES)('preserves %s identity across all three available outfits', face => {
  const options = OUTFITS.map(clothes => playerArtwork(withPlayerClothes(face, clothes)))
  expect(options.every(option => option.kind === 'layers' && option.head === `/play/avatars/${face}.webp`)).toBe(true)
  expect(new Set(options.map(option => option.kind === 'layers' && option.body)).size).toBe(3)
  for (const option of options) {
    if (option.kind !== 'layers') throw new Error('Missing registered outfit')
    expect(option.headBottom).toBeGreaterThan(option.bodyTop)
    expect(existsSync(join(process.cwd(), 'public', option.body))).toBe(true)
  }
})
it('keeps photo-generated identities whole without unrelated body parts', () => {
  const artwork = playerArtwork(withPlayerClothes('custom:20fca730-15c5-4e54-ab12-b2e34e2fd913', 'court-club'))
  expect(artwork.kind).toBe('whole')
  expect(artwork).not.toHaveProperty('body')
})

export const OUTFITS = ['starter', 'court-club', 'night-match'] as const
export const PLAYER_FACES = ['face-01', 'face-02', 'face-03', 'face-04', 'face-05', 'face-06', 'face-07', 'face-08', 'face-09', 'face-10'] as const
export type PlayerOutfit = typeof OUTFITS[number] | typeof PLAYER_FACES[number] | `custom:${string}` | `look:${string}`
const CUSTOM_ID = /^custom:([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/
export function parseOutfit(value: string | null): PlayerOutfit | null {
  if (!value) return null
  if (value.startsWith('look:')) {
    const parts = value.slice(5).split('|')
    if (parts.length !== 2 || !(OUTFITS as readonly string[]).includes(parts[1])) return null
    const face = parts[0]
    return face === 'starter' || (PLAYER_FACES as readonly string[]).includes(face) || CUSTOM_ID.test(face) ? value as PlayerOutfit : null
  }
  return [...OUTFITS, ...PLAYER_FACES].includes(value as typeof OUTFITS[number]) || CUSTOM_ID.test(value) ? value as PlayerOutfit : null
}
export function playerImageSrc(outfit: PlayerOutfit) {
  // Validate even when called from untyped/browser-persisted data.
  const safe = parseOutfit(outfit) ?? 'starter'
  return safe.startsWith('custom:') ? `/api/play/avatar/image?id=${safe.slice(7)}` : `/play/avatars/${safe}.png`
}
export function outfitStorageKey(userId: string) { return `pn:outfit:v1:${userId}` }

export type Clothing = typeof OUTFITS[number]
export function splitPlayerLook(value: PlayerOutfit): { face: PlayerOutfit; clothes: Clothing } {
  if (value.startsWith('look:')) {
    const [face, clothes] = value.slice(5).split('|')
    return { face: face as PlayerOutfit, clothes: clothes as Clothing }
  }
  if ((OUTFITS as readonly string[]).includes(value)) return { face: 'starter', clothes: value as Clothing }
  return { face: value, clothes: 'starter' }
}
export function withPlayerFace(value: PlayerOutfit, face: PlayerOutfit): PlayerOutfit {
  return `look:${splitPlayerLook(face).face}|${splitPlayerLook(value).clothes}`
}
export function withPlayerClothes(value: PlayerOutfit, clothes: Clothing): PlayerOutfit {
  return `look:${splitPlayerLook(value).face}|${clothes}`
}

/** Stable identity and wardrobe shared by simulation profiles and activity. */
export function simulationPlayerLook(identity: string): PlayerOutfit {
  const seed = [...identity].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 0)
  return withPlayerClothes(PLAYER_FACES[seed % PLAYER_FACES.length], OUTFITS[Math.floor(seed / PLAYER_FACES.length) % OUTFITS.length])
}

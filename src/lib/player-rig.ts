import { splitPlayerLook, playerImageSrc, PLAYER_FACES, type PlayerOutfit } from './player-outfit'

/** One registered canvas for the first wardrobe-ready character.
 * Neck overlap is measured in artwork pixels, never CSS container percentages.
 * Every outfit is authored against the same master; identity always uses master.
 */
export const PLAYER_RIG = {
  face: 'face-06',
  width: 1024,
  height: 1536,
  headBottom: 570,
  bodyTop: 550,
  master: '/play/avatars/face-06.png',
  bodies: {
    starter: '/play/avatars/face-06.png',
    'court-club': '/play/avatars/rig-v1/rafa-court-club.png',
    'night-match': '/play/avatars/rig-v1/rafa-night-match.png',
  },
} as const
// Each source keeps its own identity and neck coordinates.
const HEAD_BOTTOMS: Record<string, number> = {
  'face-01': 560, 'face-02': 560, 'face-03': 540, 'face-04': 560,
  'face-05': 575, 'face-06': 570, 'face-07': 560, 'face-08': 560,
  'face-09': 545, 'face-10': 565,
}
export function canCustomizePlayer(value: PlayerOutfit) {
  return PLAYER_FACES.some(face => face === splitPlayerLook(value).face)
}
export function playerArtwork(value: PlayerOutfit) {
  const { face, clothes } = splitPlayerLook(value)
  if (canCustomizePlayer(value)) {
    const head = `/play/avatars/${face}.png`
    const body = clothes === 'starter' ? head : face === 'face-06'
      ? PLAYER_RIG.bodies[clothes]
      : `/play/avatars/rig-v1/${face}-${clothes}.png`
    return { kind: 'layers' as const, head, body, headBottom: HEAD_BOTTOMS[face], bodyTop: HEAD_BOTTOMS[face] - 20 }
  }
  // Photo-generated characters remain whole until matching outfits exist.
  return { kind: 'whole' as const, image: playerImageSrc(face === 'starter' ? clothes : face) }
}

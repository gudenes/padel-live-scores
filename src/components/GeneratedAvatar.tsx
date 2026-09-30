// src/components/GeneratedAvatar.tsx
//
// Generated character avatars — a flat vector face assembled from a handful
// of swappable parts, picked deterministically from a hash of the display
// name. The same name always yields the same face.
//
// Why generated rather than uploaded: Play's Activity feed and leaderboard
// are a public social surface. Uploads would mean image storage, hosting,
// resizing, and a moderation queue for every profile picture on a product
// that has none of that today. A pure function of the name has no such
// surface, costs nothing to serve, and stays legible at 32px because every
// part is a solid shape with no fine detail.
//
// Ported from public/mockup-play-market.html (hashOf / avatarSVG). The part
// tables and the bit-shift indices are unchanged — changing them would
// silently reshuffle every existing user's face.
//
// Lives in src/components/ rather than inside the Play route because the
// prediction-market design spec calls for a shared module: the admin's
// Traders page needs the identical face for the identical name.

const AV_BG = ['#7ED321', '#38C8FF', '#F472B6', '#EAB308', '#818CF8', '#FF4655', '#5BA8FF', '#34D399']
const AV_SKIN = ['#F2C29B', '#E8B084', '#C68642', '#8D5524', '#FFD9B8', '#A9713F']
const AV_HAIR = ['#2B211A', '#4A3427', '#8B5A2B', '#D9A441', '#12100E', '#6B3F23']
const AV_SHIRT = ['#1F2937', '#7ED321', '#38C8FF', '#F472B6', '#EAB308', '#F4F4F5', '#FF4655', '#818CF8']

/** FNV-1a. Stable across runtimes — no Math.random, no Date. */
export function hashOf(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

interface AvatarParts {
  bg: string
  skin: string
  hair: string
  shirt: string
  hairStyle: number
  accessory: number
  mouth: number
}

export function avatarParts(name: string): AvatarParts {
  const h = hashOf(name)
  const bg = AV_BG[h % AV_BG.length]!
  // The shirt index is offset off the background index so the character
  // never disappears into its own backdrop.
  const first = AV_SHIRT[((h >> 9) + 3) % AV_SHIRT.length]!
  const shirt = first === bg ? AV_SHIRT[((h >> 9) + 4) % AV_SHIRT.length]! : first
  return {
    bg,
    skin: AV_SKIN[(h >> 3) % AV_SKIN.length]!,
    hair: AV_HAIR[(h >> 6) % AV_HAIR.length]!,
    shirt,
    hairStyle: (h >> 12) % 4, // 0 short · 1 long · 2 bun · 3 buzz
    accessory: (h >> 15) % 5, // 0 none · 1 headband · 2 cap · 3 shades · 4 none
    mouth: (h >> 18) % 3,
  }
}

export interface GeneratedAvatarProps {
  /** Display name. Falsy values fall back to `fallbackSeed` so the face is
   *  still stable rather than randomly re-rolling on every render. */
  name: string
  /** CSS class for the wrapper. Play passes `pl-av` / `pl-av pl-lg`. */
  className?: string
  fallbackSeed?: string
}

export default function GeneratedAvatar({
  name,
  className,
  fallbackSeed = 'anonymous',
}: GeneratedAvatarProps) {
  const seed = name && name.trim() ? name.trim() : fallbackSeed
  const { bg, skin, hair, shirt, hairStyle, accessory, mouth } = avatarParts(seed)

  return (
    <div className={className}>
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <rect width="40" height="40" fill={bg} />
        {/* shoulders */}
        <path d="M2 40 C2 31.5 10.5 27.5 20 27.5 C29.5 27.5 38 31.5 38 40 Z" fill={shirt} />
        {/* neck */}
        <rect x="17.4" y="23" width="5.2" height="6" fill={skin} />
        {/* head */}
        <circle cx="20" cy="18" r="9" fill={skin} />

        {hairStyle === 2 && <circle cx="20" cy="7.4" r="3.4" fill={hair} />}

        {hairStyle === 3 ? (
          <path d="M11.4 17.6 A8.6 8.6 0 0 1 28.6 17.6 Z" fill={hair} />
        ) : (
          <>
            <path d="M11 18 A9 9 0 0 1 29 18 L29 15.5 A9 9 0 0 0 11 15.5 Z" fill={hair} />
            <path d="M11 17 A9 9 0 0 1 29 17 Z" fill={hair} />
          </>
        )}

        {hairStyle === 1 && (
          <>
            <rect x="10.2" y="16" width="3.4" height="11" rx="1.7" fill={hair} />
            <rect x="26.4" y="16" width="3.4" height="11" rx="1.7" fill={hair} />
          </>
        )}

        {accessory === 1 && (
          <rect x="10.6" y="13.4" width="18.8" height="3.1" rx="1.4" fill="#FF4655" />
        )}
        {accessory === 2 && (
          <>
            <path d="M11 16 A9 9 0 0 1 29 16 Z" fill="#1F2937" />
            <rect x="8.6" y="15.2" width="22.8" height="2.7" rx="1.35" fill="#111827" />
          </>
        )}
        {accessory === 3 && (
          <g fill="#111827">
            <rect x="12.6" y="16.2" width="6.2" height="4.4" rx="1.4" />
            <rect x="21.2" y="16.2" width="6.2" height="4.4" rx="1.4" />
            <rect x="18.8" y="17.8" width="2.4" height="1.2" />
          </g>
        )}

        {accessory !== 3 && (
          <>
            <circle cx="16.6" cy="18.6" r="1.35" fill="#15120F" />
            <circle cx="23.4" cy="18.6" r="1.35" fill="#15120F" />
          </>
        )}

        {mouth === 0 && (
          <path d="M17 22.6 q3 2.5 6 0" stroke="#15120F" strokeWidth="1.3" fill="none" strokeLinecap="round" />
        )}
        {mouth === 1 && (
          <path d="M17.4 23.1 h5.2" stroke="#15120F" strokeWidth="1.3" fill="none" strokeLinecap="round" />
        )}
        {mouth === 2 && <ellipse cx="20" cy="23.2" rx="2.1" ry="1.7" fill="#15120F" />}
      </svg>
    </div>
  )
}

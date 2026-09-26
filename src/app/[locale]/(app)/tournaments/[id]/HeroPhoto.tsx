'use client'
import Avatar from '@/components/Avatar'
import { Link } from '@/i18n/navigation'

// Player image for the hero banner; links to the player profile.
// Prefers the full-body `photoUrl`; when a player has no body shot, falls back
// to the smaller circular headshot (then Avatar's own initial fallback) so the
// banner degrades gracefully instead of showing a giant letter. `overlap`
// slides this photo over the previous one (broadcast-style).
export default function HeroPhoto({ id, name, photoUrl, avatarUrl, overlap }: {
  id: string
  name: string
  photoUrl: string | null
  avatarUrl: string | null
  overlap?: boolean
}) {
  return (
    <Link href={`/player/${id}`} aria-label={name} style={{ display: 'block', lineHeight: 0, flexShrink: 0, marginLeft: overlap ? -38 : 0 }}>
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt={name} style={{ height: 130, width: 'auto', objectFit: 'cover', objectPosition: 'top center', display: 'block' }} />
      ) : (
        <div style={{ height: 130, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 12 }}>
          <Avatar src={avatarUrl} alt={name} size={82} fallback={name?.[0]} unoptimized style={{ border: '2px solid rgba(255,255,255,0.12)' }} />
        </div>
      )}
    </Link>
  )
}

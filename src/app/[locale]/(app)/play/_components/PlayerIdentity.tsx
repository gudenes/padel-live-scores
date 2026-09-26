'use client'
// src/app/[locale]/(app)/play/_components/PlayerIdentity.tsx
//
// Who is playing — the four avatars, 2 v 2, that replaced the ghosted "LB vs
// CS" monogram on the deck card. Shared with the detail sheet.
//
// The photos are real: all four players on a Premier/FIP draw carry
// `players.avatar_url`, and those URLs are rehosted onto our own Supabase
// Storage bucket (see src/lib/avatar-rehost.ts), so they are not hotlinks that
// can rot. Rows that have not been rehosted yet, or have no photo at all, fall
// back to GeneratedAvatar seeded on the player's name — the same deterministic
// face the Activity feed and leaderboard use. Never a broken-image glyph.
//
// Every value rendered here comes from GET /api/play/markets. Nothing is
// derived from a guess: a null ranking prints no ranking, a null country
// prints no flag.

import Image from 'next/image'
import { FlagImage } from '@/components/FlagImage'
import GeneratedAvatar from '@/components/GeneratedAvatar'
import type { PlayPlayer } from './types'

/**
 * next/image for the rehosted Supabase Storage photos — the same treatment
 * src/components/Avatar.tsx gives player avatars elsewhere in the app, and the
 * host is already in `next.config.ts`'s remotePatterns.
 *
 * `size` is the rendered CSS box; the request is made at 2× for retina.
 */
function Face({ player, size }: { player: PlayPlayer; size: number }) {
  if (!player.avatarUrl) {
    return (
      <GeneratedAvatar
        name={player.name}
        className="pl-face"
        // Seeded on the name, so the same player always gets the same face.
        fallbackSeed={player.id ?? 'player'}
      />
    )
  }
  return (
    <Image
      className="pl-face"
      src={player.avatarUrl}
      alt={player.name}
      width={size * 2}
      height={size * 2}
      referrerPolicy="no-referrer"
    />
  )
}

/** Avatar + flag + ranking for one player. */
function PlayerChip({ player, size }: { player: PlayPlayer; size: number }) {
  return (
    <div className="pl-pchip">
      <Face player={player} size={size} />
      <div className="pl-pmeta">
        <span className="pl-pname">{player.surname}</span>
        <span className="pl-pline">
          {player.country && <FlagImage country={player.country} size={11} rounded />}
          {player.ranking !== null && <i>#{player.ranking}</i>}
        </span>
      </div>
    </div>
  )
}

export interface PairIdentityProps {
  players: PlayPlayer[]
  /**
   * Rendered avatar box in px — only the next/image request size. The painted
   * box is .pl-face's CSS width, which steps down on narrow and short
   * viewports; asking for the largest of those and letting the browser
   * downscale beats shipping a blurry face.
   */
  size?: number
}

export function PairIdentity({ players, size = 66 }: PairIdentityProps) {
  return (
    <div className="pl-pair">
      {players.map((p, i) => (
        <PlayerChip key={p.id ?? `${p.name}-${i}`} player={p} size={size} />
      ))}
    </div>
  )
}

/**
 * The full 2-v-2 strip that sits over the court art, replacing the monogram.
 * `vsLabel` is translated by the caller — this component holds no copy.
 */
export function VersusIdentity({
  pair1,
  pair2,
  vsLabel,
  size = 66,
}: {
  pair1: PlayPlayer[]
  pair2: PlayPlayer[]
  vsLabel: string
  size?: number
}) {
  return (
    <div className="pl-vs">
      <PairIdentity players={pair1} size={size} />
      <span className="pl-vs-sep" aria-hidden>
        {vsLabel}
      </span>
      <PairIdentity players={pair2} size={size} />
    </div>
  )
}

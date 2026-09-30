'use client'
// src/app/[locale]/(app)/play/_components/PlayerIdentity.tsx
//
// Who is playing — the four avatars, 2 v 2, that replaced the ghosted "LB vs
// CS" monogram on the deck card. Shared with the detail sheet.
//
// Available photos use the stored player URL. Missing or failed photos show
// the player's initials, matching the match detail screen.
//
// Every value rendered here comes from GET /api/play/markets. Nothing is
// derived from a guess: a null ranking prints no ranking, a null country
// prints no flag.

import Image from 'next/image'
import { FlagImage } from '@/components/FlagImage'
import { useState } from 'react'
import type { PlayPlayer } from './types'

/**
 * next/image for the rehosted Supabase Storage photos — the same treatment
 * src/components/Avatar.tsx gives player avatars elsewhere in the app, and the
 * host is already in `next.config.ts`'s remotePatterns.
 *
 * `size` is the rendered CSS box; the request is made at 2× for retina.
 */
function Face({ player, size }: { player: PlayPlayer; size: number }) {
  const [failed, setFailed] = useState<string[]>([])
  const source = player.avatarUrl
  if (!source || failed.includes(source)) {
    const initials = player.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toLocaleUpperCase() ?? '').join('') || '?'
    return <span className="pl-face pl-face-initials" role="img" aria-label={player.name}>{initials}</span>
  }
  return <Image className="pl-face" src={source} alt={player.name} width={size * 2} height={size * 2}
    referrerPolicy="no-referrer" onError={() => setFailed(previous => [...previous, source])} />
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

/**
 * Which of the card's two brand colours a pair wears.
 *
 * 'subject' is the pair the question names — it gets ORANGE, the same
 * #FF6B2B this app already uses for pair one on the momentum chart and the
 * prediction bars. 'other' gets the LIME brand accent. 'neutral' is for
 * surfaces that have no subject to point at.
 *
 * The colour lands as a `--pl-side` custom property on the pair wrapper, so
 * the avatar ring and the name both read it from one place.
 */
export type PairAccent = 'subject' | 'other' | 'neutral'

const ACCENT_CLASS: Record<PairAccent, string> = {
  subject: ' pl-subject',
  other: ' pl-other',
  neutral: '',
}

export interface PairIdentityProps {
  players: PlayPlayer[]
  accent?: PairAccent
  /**
   * Rendered avatar box in px — only the next/image request size. The painted
   * box is .pl-face's CSS width, which steps down on narrow and short
   * viewports; asking for the largest of those and letting the browser
   * downscale beats shipping a blurry face.
   */
  size?: number
}

export function PairIdentity({ players, accent = 'neutral', size = 66 }: PairIdentityProps) {
  return (
    <div className={`pl-pair${ACCENT_CLASS[accent]}`}>
      {players.map((p, i) => (
        <PlayerChip key={p.id ?? `${p.name}-${i}`} player={p} size={size} />
      ))}
    </div>
  )
}

/**
 * The full 2-v-2 strip that sits over the court art, replacing the monogram.
 * `vsLabel` is translated by the caller — this component holds no copy.
 *
 * `subjectPair` comes from the API (see PlayMarket.subjectPair) and says which
 * of the two pairs the question names. It is NOT inferred from slot order:
 * plenty of templates ask about pair two, and guessing would paint those
 * markets' colours backwards.
 */
export function VersusIdentity({
  pair1,
  pair2,
  vsLabel,
  subjectPair,
  size = 66,
}: {
  pair1: PlayPlayer[]
  pair2: PlayPlayer[]
  vsLabel: string
  subjectPair: 1 | 2
  size?: number
}) {
  return (
    <div className="pl-vs">
      <PairIdentity players={pair1} accent={subjectPair === 1 ? 'subject' : 'other'} size={size} />
      <span className="pl-vs-sep" aria-hidden>
        {vsLabel}
      </span>
      <PairIdentity players={pair2} accent={subjectPair === 2 ? 'subject' : 'other'} size={size} />
    </div>
  )
}

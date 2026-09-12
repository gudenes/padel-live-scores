'use client'
// Squad list for the team page. Client-side because each row navigates.
//
// Rows follow the same idiom as ProjectionPickerList's CompactRow: avatar on
// the left, name in the middle, record on the right, on a subtly-tinted
// chunky card. Full names are shown with CSS ellipsis rather than
// toShortName — each row has the full row width to itself (no second player
// competing for space), so truncation is the rarer case and reads better
// than always shortening.

import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import Avatar from '@/components/Avatar'
import { FlagImage } from '@/components/FlagImage'
import type { AmateurRosterEntry } from '@/lib/amateur-profile'

const CARD = 'rgba(255,255,255,0.03)'
const MUTED = '#8A8A8A'
const ORANGE = '#F5A623'
const CHUNK = 'polygon(0% 4%, 99.5% 0%, 100% 96%, 0.5% 100%)'
const AVATAR = 34
const FLAG_W = 14

/**
 * Avatar with the player's flag tucked into the bottom-right corner — the
 * same treatment PartnerAvatar gives professionals on the player profile.
 * The ring around the flag is the row's own background, so the badge reads as
 * cut into the avatar rather than floating over it.
 *
 * Without a country there is no badge at all: an unknown nationality must not
 * render as a placeholder that looks like a real one.
 */
function RosterAvatar({ entry }: { entry: AmateurRosterEntry }) {
  const avatar = (
    <Avatar src={entry.avatarUrl} alt={entry.name} size={AVATAR} fallback={entry.name?.[0]} unoptimized />
  )
  if (!entry.country) return avatar

  return (
    <div style={{ position: 'relative', width: AVATAR, height: AVATAR, flexShrink: 0 }}>
      {avatar}
      <div style={{
        position: 'absolute', right: -2, bottom: -2,
        width: FLAG_W, height: Math.round(FLAG_W * 0.75),
        borderRadius: 2, overflow: 'hidden',
        boxShadow: '0 0 0 2px #0E0E0E',
      }}>
        <FlagImage country={entry.country} size={FLAG_W} />
      </div>
    </div>
  )
}

export function TeamRoster({ roster }: { roster: AmateurRosterEntry[] }) {
  const t = useTranslations('team')
  const tAmateur = useTranslations('amateur')
  const router = useRouter()

  return (
    <div>
      {roster.map(r => {
        const played = r.gamesPlayed > 0
        return (
          <button
            key={r.playerId}
            onClick={() => router.push(`/player/${r.playerId}` as Parameters<typeof router.push>[0])}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
              cursor: 'pointer', background: CARD, border: '1px solid rgba(255,255,255,0.06)',
              padding: '8px 12px', marginBottom: 6, clipPath: CHUNK, font: 'inherit', color: 'inherit',
            }}
          >
            <RosterAvatar entry={r} />
            <span style={{
              flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: played ? '#fff' : MUTED,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {r.name}
            </span>
            {r.isCaptain && (
              <span style={{
                flexShrink: 0, border: `1px solid ${ORANGE}`, color: ORANGE,
                fontSize: 8, fontWeight: 800, padding: '1px 5px',
                textTransform: 'uppercase', letterSpacing: 0.5,
              }}>
                {tAmateur('captain')}
              </span>
            )}
            <span style={{ fontSize: 11, color: MUTED, fontVariantNumeric: 'tabular-nums', flexShrink: 0, whiteSpace: 'nowrap' }}>
              {played
                ? t('playerLine', { games: r.gamesPlayed, wins: r.wins, losses: r.losses })
                : t('noGames')}
            </span>
          </button>
        )
      })}
    </div>
  )
}

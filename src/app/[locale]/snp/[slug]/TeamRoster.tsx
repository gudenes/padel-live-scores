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
import type { AmateurRosterEntry } from '@/lib/amateur-profile'

const CARD = 'rgba(255,255,255,0.03)'
const MUTED = '#8A8A8A'
const CHUNK = 'polygon(0% 4%, 99.5% 0%, 100% 96%, 0.5% 100%)'

export function TeamRoster({ roster }: { roster: AmateurRosterEntry[] }) {
  const t = useTranslations('team')
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
            <Avatar src={r.avatarUrl} alt={r.name} size={34} fallback={r.name?.[0]} unoptimized />
            <span style={{
              flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: played ? '#fff' : MUTED,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {r.name}
            </span>
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

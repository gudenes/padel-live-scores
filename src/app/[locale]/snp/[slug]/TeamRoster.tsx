'use client'
// Squad grid for the team page. Client-side because each card navigates.

import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import type { AmateurRosterEntry } from '@/lib/amateur-profile'

const MUTED = '#8A8A8A'

export function TeamRoster({ roster }: { roster: AmateurRosterEntry[] }) {
  const t = useTranslations('team')
  const router = useRouter()

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
      gap: 1, background: '#1C1C1C',
    }}>
      {roster.map(r => (
        <button
          key={r.playerId}
          onClick={() => router.push(`/player/${r.playerId}` as Parameters<typeof router.push>[0])}
          style={{
            background: '#141414', padding: '10px 11px', border: 'none', textAlign: 'left',
            cursor: 'pointer', display: 'grid', gap: 3, font: 'inherit', color: 'inherit',
          }}
        >
          <span style={{
            fontSize: 12, fontWeight: 600, color: r.gamesPlayed > 0 ? '#fff' : MUTED,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {r.name}
          </span>
          <span style={{ fontSize: 10, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>
            {r.gamesPlayed > 0
              ? t('playerLine', { games: r.gamesPlayed, wins: r.wins, losses: r.losses })
              : t('noGames')}
          </span>
        </button>
      ))}
    </div>
  )
}

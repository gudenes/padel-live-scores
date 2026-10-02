'use client'

// Coaches card on the player Overview tab. Names only, in FIP list order.
// Names become links once coach pages exist (spec 2026-10-02-player-profile-coaches).

import { useTranslations } from 'next-intl'
import { Widget } from './Widget'

export interface ProfileCoach {
  coach_id: string
  display_name: string
}

export function CoachesCard({ coaches }: { coaches: ProfileCoach[] }) {
  const t = useTranslations('player')
  if (coaches.length === 0) return null
  return (
    <Widget wide label={t('coachesLabel', { count: coaches.length })}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {coaches.map((c) => (
          <div
            key={c.coach_id}
            data-testid="coach-name"
            style={{ fontSize: 13, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {c.display_name}
          </div>
        ))}
      </div>
    </Widget>
  )
}

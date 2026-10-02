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
      <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', lineHeight: 1.4 }}>
        {coaches.map((c, i) => (
          <span key={c.coach_id}>
            {i > 0 && ', '}
            <span data-testid="coach-name">{c.display_name}</span>
          </span>
        ))}
      </div>
    </Widget>
  )
}

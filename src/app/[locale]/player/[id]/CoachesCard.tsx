'use client'

// Coaches card on the player Overview tab. Names only, in FIP list order.
// Each name links to its coach page.

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Widget } from './Widget'

export interface ProfileCoach {
  coach_id: string
  display_name: string
  slug: string
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
            <Link href={`/coach/${c.slug}`} style={{ color: 'inherit', textDecoration: 'none' }}>
              <span data-testid="coach-name">{c.display_name}</span>
            </Link>
          </span>
        ))}
      </div>
    </Widget>
  )
}

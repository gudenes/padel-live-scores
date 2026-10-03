'use client'

// Coaches with their saved photos, in FIP list order.
// Each name links to its coach page.

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import Avatar from '@/components/Avatar'
import { Widget } from './Widget'

export interface ProfileCoach {
  coach_id: string
  display_name: string
  slug: string
  avatar_url?: string | null
}

export function CoachesCard({ coaches }: { coaches: ProfileCoach[] }) {
  const t = useTranslations('player')
  if (coaches.length === 0) return null
  return (
    <Widget wide label={t('coachesLabel', { count: coaches.length })}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 13, fontWeight: 700, color: '#fff', lineHeight: 1.4 }}>
        {coaches.map((c) => (
          <span key={c.coach_id}>
            <Link href={`/coach/${c.slug}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'inherit', textDecoration: 'none' }}>
              <Avatar src={c.avatar_url} alt={c.display_name} size={32} />
              <span data-testid="coach-name">{c.display_name}</span>
            </Link>
          </span>
        ))}
      </div>
    </Widget>
  )
}

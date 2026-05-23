import * as React from 'react'
import { Link } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import { TrophyIcon } from '@/components/icons/TrophyIcon'
import type { TitleEntry } from '@/lib/derive-titles'
import { titleCase } from '@/lib/title-case'

const MUTED = '#6B7280'
const GOLD = '#D4A017'

interface Props {
  year: number
  titles: TitleEntry[]
}

/**
 * Gold-tinted card listing titles for the given year.
 * Renders nothing when `titles` is empty (per spec: no "0 titles" placeholder).
 */
export function TitlesCallout({ year, titles }: Props) {
  const t = useTranslations('player')
  if (titles.length === 0) return null

  return (
    <div
      style={{
        padding: 12,
        background: 'linear-gradient(135deg, rgba(212,160,23,0.15), rgba(245,166,35,0.05))',
        borderLeft: `3px solid ${GOLD}`,
        clipPath: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
      }}
    >
      <div
        style={{
          fontSize: 9,
          color: GOLD,
          textTransform: 'uppercase',
          letterSpacing: 1,
          fontWeight: 700,
          marginBottom: 6,
        }}
      >
        {t('titlesCalloutLabel', { year, count: titles.length })}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {titles.map(title => (
          <Link
            key={title.tournamentId}
            href={`/tournaments/${title.tournamentId}`}
            style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', color: 'inherit' }}
          >
            <TrophyIcon size={16} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>
                {titleCase(title.tournamentName)}
              </div>
              {title.partner && (
                <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>
                  {t('wonWithPartner', {
                    partnerName: titleCase(
                      title.partner.display_name?.trim() || title.partner.name || '',
                    ),
                  })}
                </div>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

'use client'

import { useFormatter, useTranslations } from 'next-intl'
import { DATE_SHORT } from '@/lib/format-patterns'
import type { Tab } from '@/lib/matches-filters'

const GREEN = '#7ED321'
const GREEN_DIM = 'rgba(126,211,33,0.12)'
const BG_ELEV = '#1E1E1E'
const MUTED = '#6B7280'
const MUTED_2 = '#9CA3AF'
const TEXT = '#FFFFFF'
const BORDER = 'rgba(255,255,255,0.06)'
const CHUNKY_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

export default function MatchesTabs({
  tab,
  onTabChange,
  dates,
  filterCount,
  onFilterClick,
}: {
  tab: Tab
  onTabChange: (tab: Tab) => void
  dates: {
    yesterday: Date
    today: Date
    upcoming: Date | null   // null when there are no scheduled matches beyond today
  }
  filterCount: number
  onFilterClick: () => void
}) {
  const t = useTranslations('matches')
  const format = useFormatter()

  const upcomingLabel = dates.upcoming
    ? `${format.dateTime(dates.upcoming, DATE_SHORT)}+`
    : '—'

  const tabs: { key: Tab; label: string; date: string }[] = [
    { key: 'yesterday', label: t('yesterday'),   date: format.dateTime(dates.yesterday, DATE_SHORT) },
    { key: 'today',     label: t('today'),       date: format.dateTime(dates.today, DATE_SHORT) },
    { key: 'upcoming',  label: t('upcomingTab'), date: upcomingLabel },
  ]

  return (
    <div style={{
      display: 'flex', alignItems: 'stretch',
      padding: '14px 14px 0',
      borderBottom: `1px solid ${BORDER}`,
      gap: 4,
    }}>
      <div style={{ display: 'flex', flex: '1 1 auto', justifyContent: 'space-around' }}>
        {tabs.map(tb => {
          const active = tab === tb.key
          return (
            <button
              key={tb.key}
              onClick={() => onTabChange(tb.key)}
              aria-pressed={active}
              style={{
                flex: 1,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                padding: '6px 0 12px',
                background: 'transparent', border: 'none', cursor: 'pointer',
                position: 'relative',
              }}
            >
              <span style={{
                fontSize: 15,
                fontWeight: active ? 800 : 700,
                color: active ? TEXT : MUTED,
                letterSpacing: -0.1,
              }}>{tb.label}</span>
              <span style={{
                fontSize: 10, fontWeight: 700,
                color: active ? GREEN : MUTED,
                opacity: active ? 1 : 0.65,
                letterSpacing: 0.3,
                fontVariantNumeric: 'tabular-nums',
              }}>{tb.date}</span>
              {active && (
                <span aria-hidden style={{
                  position: 'absolute',
                  left: '18%', right: '18%', bottom: -1, height: 2.5,
                  background: GREEN,
                  clipPath: 'polygon(3% 0%, 97% 0%, 100% 100%, 0% 100%)',
                }} />
              )}
            </button>
          )
        })}
      </div>

      <button
        onClick={onFilterClick}
        aria-label="Filters"
        style={{
          position: 'relative',
          width: 38, height: 40,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: filterCount > 0 ? GREEN_DIM : BG_ELEV,
          border: `1px solid ${filterCount > 0 ? 'transparent' : BORDER}`,
          color: filterCount > 0 ? GREEN : MUTED_2,
          cursor: 'pointer',
          clipPath: CHUNKY_BADGE,
          margin: '4px 0 8px',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="4" y1="6" x2="20" y2="6"/>
          <line x1="4" y1="12" x2="14" y2="12"/>
          <line x1="4" y1="18" x2="10" y2="18"/>
          <circle cx="17" cy="12" r="2.2" fill="currentColor" stroke="none"/>
          <circle cx="13" cy="18" r="2.2" fill="currentColor" stroke="none"/>
        </svg>
        {filterCount > 0 && (
          <span style={{
            position: 'absolute', top: 3, right: 3,
            minWidth: 14, height: 14, padding: '0 3px',
            background: GREEN, color: '#000',
            fontSize: 9, fontWeight: 900,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            clipPath: CHUNKY_BADGE,
            lineHeight: 1,
          }}>{filterCount}</span>
        )}
      </button>
    </div>
  )
}

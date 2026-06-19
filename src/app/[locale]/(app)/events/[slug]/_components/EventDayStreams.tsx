'use client'

// Per-day YouTube stream cards for a managed event (e.g. the Reserve Cup).
// Presentational: badges are computed server-side (event-day-streams-server)
// and passed in. Styling matches EventDetail's chunky card language.

import { useTranslations, useFormatter } from 'next-intl'
import { CHUNKY, MUTED, BORDER } from '@/components/home/shared'
import { DATE_WITH_WEEKDAY, TIME_24H } from '@/lib/format-patterns'
import type { DayStreamCard } from '@/lib/event-day-streams'

const sectionLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: '#4A6F8E',
  marginBottom: 11,
}

// A broadcast "day" is a calendar date, not a moment — so we anchor both the
// date display and the today/past comparison to UTC. This matches the
// server-side badge logic and avoids the viewer-timezone off-by-one that a
// local-midnight Date would produce when next-intl formats it in another tz.
const DATE_WEEKDAY_UTC = { ...DATE_WITH_WEEKDAY, timeZone: 'UTC' } as const

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function EventDayStreams({
  streams,
  embedded = false,
}: {
  streams: DayStreamCard[]
  /** When true, render just the stacked cards — no section padding or eyebrow.
   *  Used when the cards live inside the "Where to watch" section. */
  embedded?: boolean
}) {
  const t = useTranslations('events.dayStreams')
  const format = useFormatter()
  if (streams.length === 0) return null

  const today = todayUtc()

  const cards = streams.map((s) => {
        const isLive = s.badge === 'live'
        const isPast = s.dayDate < today && !isLive
        const isToday = s.dayDate === today
        const dayDateObj = new Date(`${s.dayDate}T00:00:00Z`)

        const label = isToday
          ? `${t('dayLabel', { n: s.day })} · ${t('today')}`
          : t('dayLabel', { n: s.day })

        let badgeText: string
        let badgeColor: string
        let badgeBg: string
        if (s.badge === 'live') {
          badgeText = t('live')
          badgeColor = '#fff'
          badgeBg = '#FF3B30'
        } else if (s.badge === 'upcoming') {
          const when = s.scheduledStartTime
            ? `${format.dateTime(new Date(s.scheduledStartTime), DATE_WITH_WEEKDAY)}, ${format.dateTime(new Date(s.scheduledStartTime), TIME_24H)}`
            : format.dateTime(dayDateObj, DATE_WEEKDAY_UTC)
          badgeText = `${t('upcoming')} · ${when}`
          badgeColor = '#9AAEC4'
          badgeBg = 'rgba(255,255,255,0.05)'
        } else {
          badgeText = t('replay')
          badgeColor = MUTED
          badgeBg = 'rgba(255,255,255,0.05)'
        }

        return (
          <a
            key={s.videoId}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              textDecoration: 'none',
              color: '#EEE4CE',
              background: isLive
                ? 'linear-gradient(100deg, rgba(255,0,0,0.14), rgba(255,0,0,0.04))'
                : '#141414',
              border: `1px solid ${isLive ? 'rgba(255,70,85,0.28)' : BORDER}`,
              clipPath: CHUNKY.card,
              padding: '12px 14px',
              marginBottom: 8,
              opacity: isPast ? 0.55 : 1,
            }}
          >
            <span
              style={{
                width: 38,
                height: 27,
                background: '#FF0000',
                borderRadius: 7,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span
                style={{
                  width: 0,
                  height: 0,
                  borderLeft: '11px solid #fff',
                  borderTop: '7px solid transparent',
                  borderBottom: '7px solid transparent',
                  marginLeft: 3,
                }}
              />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span
                style={{
                  display: 'block',
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: isLive ? '#FF6470' : '#7C8A99',
                }}
              >
                {label}
              </span>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 700, marginTop: 2 }}>
                {format.dateTime(dayDateObj, DATE_WEEKDAY_UTC)}
              </span>
            </span>
            <span
              style={{
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 9.5,
                fontWeight: 800,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                padding: '4px 8px',
                borderRadius: 6,
                color: badgeColor,
                background: badgeBg,
              }}
            >
              {isLive && (
                <span
                  style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }}
                />
              )}
              {badgeText}
            </span>
          </a>
        )
  })

  if (embedded) return <>{cards}</>

  return (
    <div style={{ padding: '18px 16px 4px' }}>
      <div style={sectionLabel}>{t('eyebrow')}</div>
      {cards}
    </div>
  )
}

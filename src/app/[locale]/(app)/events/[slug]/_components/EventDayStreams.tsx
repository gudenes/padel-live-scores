'use client'

// Per-day YouTube stream cards for a managed event (e.g. the Reserve Cup).
// Badges are computed server-side (event-day-streams-server) and passed in;
// styling matches EventDetail's chunky card language. Tapping a card expands
// an inline 16:9 player right in the list (tap again to collapse). Fullscreen
// stays available via the player's own control. Modifier/middle clicks and
// no-JS still fall through to the YouTube link.

import { useEffect, useRef, useState } from 'react'
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
  const today = todayUtc()
  const [active, setActive] = useState<{ id: string; autoplay: boolean } | null>(null)
  // Auto-expand today's stream — the headline during the event. Done in a
  // mount effect (not the initial state) so the server-rendered, ISR-cached
  // HTML matches hydration; "today" is dynamic and can't be rendered on the
  // server. No autoplay on the auto-open — a tap starts playback.
  const autoOpenedRef = useRef(false)
  useEffect(() => {
    if (autoOpenedRef.current) return
    autoOpenedRef.current = true
    const todays = streams.find((s) => s.dayDate === todayUtc())
    // Intentional one-time post-hydration expand (deferred off SSR to avoid a
    // hydration mismatch on the dynamic, ISR-cached "today").
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (todays) setActive({ id: todays.videoId, autoplay: false })
  }, [streams])
  if (streams.length === 0) return null

  const rows = streams.flatMap((s) => {
    const isLive = s.badge === 'live'
    const isPast = s.dayDate < today && !isLive
    const isToday = s.dayDate === today
    const isOpen = active?.id === s.videoId
    const dayDateObj = new Date(`${s.dayDate}T00:00:00Z`)
    const dayLabel = t('dayLabel', { n: s.day })
    const dateStr = format.dateTime(dayDateObj, DATE_WEEKDAY_UTC)

    const label = isToday ? `${dayLabel} · ${t('today')}` : dayLabel

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

    const toggle = (e: React.MouseEvent) => {
      // Let modified / middle clicks fall through to the YouTube link so power
      // users can still open a real tab.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return
      e.preventDefault()
      setActive((cur) => (cur?.id === s.videoId ? null : { id: s.videoId, autoplay: true }))
    }

    const highlight = isLive || isOpen

    const card = (
      <a
        key={s.videoId}
        href={s.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={toggle}
        aria-expanded={isOpen}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          textDecoration: 'none',
          color: '#EEE4CE',
          background: highlight
            ? 'linear-gradient(100deg, rgba(255,0,0,0.14), rgba(255,0,0,0.04))'
            : '#141414',
          border: `1px solid ${highlight ? 'rgba(255,70,85,0.28)' : BORDER}`,
          clipPath: CHUNKY.card,
          padding: '12px 14px',
          marginBottom: isOpen ? 0 : 8,
          opacity: isPast && !isOpen ? 0.55 : 1,
          cursor: 'pointer',
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
          {isOpen ? (
            // Pause glyph while expanded — tapping again collapses.
            <span style={{ display: 'flex', gap: 3 }}>
              <span style={{ width: 3, height: 12, background: '#fff', borderRadius: 1 }} />
              <span style={{ width: 3, height: 12, background: '#fff', borderRadius: 1 }} />
            </span>
          ) : (
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
          )}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{
              display: 'block',
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: highlight ? '#FF6470' : '#7C8A99',
            }}
          >
            {label}
          </span>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 700, marginTop: 2 }}>
            {dateStr}
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
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />
          )}
          {badgeText}
        </span>
      </a>
    )

    if (!isOpen) return [card]

    // Inline player rendered directly under its card — no overlay.
    const player = (
      <div
        key={`${s.videoId}-player`}
        style={{
          background: '#000',
          border: '1px solid rgba(255,70,85,0.28)',
          borderTop: 'none',
          clipPath: CHUNKY.card,
          marginBottom: 8,
          overflow: 'hidden',
        }}
      >
        <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9' }}>
          <iframe
            src={`https://www.youtube.com/embed/${s.videoId}?autoplay=${active?.autoplay ? 1 : 0}&rel=0&playsinline=1&modestbranding=1`}
            allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            title={`${dayLabel} — ${dateStr}`}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
          />
        </div>
        <div style={{ padding: '8px 12px' }}>
          <a
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 11, color: '#6fa8dc', textDecoration: 'none' }}
          >
            {t('openOnYoutube')}
          </a>
        </div>
      </div>
    )

    return [card, player]
  })

  if (embedded) return <>{rows}</>

  return (
    <div style={{ padding: '18px 16px 4px' }}>
      <div style={sectionLabel}>{t('eyebrow')}</div>
      {rows}
    </div>
  )
}

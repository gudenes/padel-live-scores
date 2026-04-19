'use client'

import React, { useEffect, useRef } from 'react'
import { useFormatter, useTranslations } from 'next-intl'

const GREEN = '#7ED321'
const GREEN_DIM = 'rgba(126,211,33,0.14)'
const BG = '#0A0A0A'
const BG_ELEV = '#1E1E1E'
const MUTED = '#6B7280'
const MUTED_2 = '#9CA3AF'
const TEXT = '#FFFFFF'
const BORDER = 'rgba(255,255,255,0.06)'
const LIVE_RED = '#FF4655'
const LIVE_STRONG = 'rgba(255,77,95,0.18)'
const CHUNKY_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

const DATE_RANGE = 14

function addDays(d: Date, days: number): Date {
  const out = new Date(d.getTime())
  out.setDate(out.getDate() + days)
  return out
}

export interface DateStripDay {
  offset: number
  date: Date
  weekday: string
  dayNum: string
}

export default function MatchesDateStrip({
  dateOffset,
  onDateChange,
  filterCount,
  onFilterClick,
  liveOnly,
  onLiveToggle,
  liveDisabled,
}: {
  dateOffset: number
  onDateChange: (offset: number) => void
  filterCount: number
  onFilterClick: () => void
  liveOnly: boolean
  onLiveToggle: () => void
  liveDisabled: boolean
}) {
  const t = useTranslations('matches')
  const format = useFormatter()

  // Build the ±14 day strip relative to "today"
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days: DateStripDay[] = []
  for (let offset = -DATE_RANGE; offset <= DATE_RANGE; offset++) {
    const date = addDays(today, offset)
    days.push({
      offset,
      date,
      // Use native Date methods to format in the browser's local timezone —
      // next-intl's formatter uses a globally-configured tz (from the
      // geo-timezone cookie) that may differ in dev, causing off-by-one.
      weekday: date.toLocaleDateString(undefined, { weekday: 'short' }),
      dayNum: String(date.getDate()).padStart(2, '0'),
    })
  }

  // Scroll the active day into the centre on mount + whenever dateOffset changes
  const stripRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!stripRef.current) return
    const btn = stripRef.current.querySelector<HTMLButtonElement>(`[data-offset="${dateOffset}"]`)
    if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [dateOffset])

  return (
    <div style={{
      display: 'flex', alignItems: 'stretch',
      padding: '12px 12px 0',
      borderBottom: `1px solid ${BORDER}`,
      gap: 8,
    }}>
      <div style={{
        flex: 1, position: 'relative',
        display: 'flex', alignItems: 'stretch',
        overflow: 'hidden',
      }}>
        {/* Edge fade masks */}
        <div aria-hidden style={{
          position: 'absolute', top: 12, bottom: 18, left: 0, width: 28,
          pointerEvents: 'none', zIndex: 2,
          background: `linear-gradient(to left, transparent, ${BG} 80%)`,
        }} />
        <div aria-hidden style={{
          position: 'absolute', top: 12, bottom: 18, right: 0, width: 28,
          pointerEvents: 'none', zIndex: 2,
          background: `linear-gradient(to right, transparent, ${BG} 80%)`,
        }} />

        <div
          ref={stripRef}
          role="tablist"
          style={{
            display: 'flex', gap: 4,
            overflowX: 'auto', scrollSnapType: 'x mandatory',
            WebkitOverflowScrolling: 'touch' as any,
            scrollbarWidth: 'none' as any,
            padding: '0 8px',
            flex: 1,
          }}
        >
          <style dangerouslySetInnerHTML={{ __html: '[role="tablist"]::-webkit-scrollbar { display: none }' }} />
          {days.map(d => {
            const active = d.offset === dateOffset
            const relative =
              d.offset === 0  ? t('today') :
              d.offset === -1 ? t('yesterday') :
              d.offset === 1  ? t('upcomingTab') : ''
            return (
              <button
                key={d.offset}
                data-offset={d.offset}
                role="tab"
                aria-selected={active}
                onClick={() => onDateChange(d.offset)}
                style={{
                  flex: '0 0 auto',
                  width: 54,
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 2,
                  padding: '14px 0 18px',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  scrollSnapAlign: 'center',
                  position: 'relative',
                }}
              >
                <span style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
                  textTransform: 'uppercase', color: MUTED,
                }}>
                  {d.weekday}
                </span>
                <span style={{
                  fontSize: 17, fontWeight: active ? 800 : 700,
                  color: active ? TEXT : MUTED,
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {d.dayNum}
                </span>
                <span style={{
                  fontSize: 9, fontWeight: 800,
                  color: active ? GREEN : MUTED,
                  opacity: active ? 1 : 0.6,
                  letterSpacing: 0.5, textTransform: 'uppercase',
                  minHeight: 11,
                }}>
                  {relative || '\u00A0'}
                </span>
                {active && (
                  <span aria-hidden style={{
                    position: 'absolute', bottom: -1, left: '18%', right: '18%', height: 2.5,
                    background: GREEN,
                    clipPath: 'polygon(3% 0%, 97% 0%, 100% 100%, 0% 100%)',
                  }} />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Stacked action column */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 6,
        width: 64, padding: '12px 0 18px', flexShrink: 0,
        alignSelf: 'stretch',
      }}>
        <button
          type="button"
          onClick={onFilterClick}
          aria-label={t('filters.title')}
          style={{
            flex: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            background: filterCount > 0 ? GREEN_DIM : BG_ELEV,
            border: `1px solid ${filterCount > 0 ? 'transparent' : BORDER}`,
            color: filterCount > 0 ? GREEN : MUTED_2,
            cursor: 'pointer', padding: '4px 8px',
            clipPath: CHUNKY_BADGE,
            position: 'relative',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="4" y1="12" x2="14" y2="12" />
            <line x1="4" y1="18" x2="10" y2="18" />
            <circle cx="17" cy="12" r="2.2" fill="currentColor" stroke="none" />
            <circle cx="13" cy="18" r="2.2" fill="currentColor" stroke="none" />
          </svg>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.3 }}>{t('filters.title')}</span>
          {filterCount > 0 && (
            <span style={{
              position: 'absolute', top: 2, right: 3,
              minWidth: 14, height: 14, padding: '0 3px',
              background: GREEN, color: '#000',
              fontSize: 9, fontWeight: 900,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              clipPath: CHUNKY_BADGE,
              lineHeight: 1,
            }}>{filterCount}</span>
          )}
        </button>

        <button
          type="button"
          onClick={onLiveToggle}
          aria-pressed={liveOnly}
          aria-label={t('liveOnly')}
          disabled={liveDisabled}
          style={{
            flex: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            background: liveOnly ? LIVE_STRONG : BG_ELEV,
            border: liveOnly ? '1px solid transparent' : `1px solid ${BORDER}`,
            color: liveOnly ? LIVE_RED : MUTED_2,
            cursor: liveDisabled ? 'default' : 'pointer', padding: '4px 8px',
            clipPath: CHUNKY_BADGE,
            opacity: liveDisabled ? 0.5 : 1,
            pointerEvents: liveDisabled ? 'none' : 'auto',
          }}
        >
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: liveOnly ? LIVE_RED : MUTED_2,
            animation: liveOnly ? 'v3-scores-pulse 2s infinite' : 'none',
          }} />
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.3 }}>{t('live')}</span>
        </button>
      </div>
    </div>
  )
}

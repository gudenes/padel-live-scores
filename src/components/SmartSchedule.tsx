'use client'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { relativeStartWindow, startClockWindow, earliestStartClock, type SmartScheduleForecast } from '@/lib/smart-schedule'

export function NextToPlayBadge() {
  const t = useTranslations('smartSchedule')
  return <span style={{ fontSize: 9, fontWeight: 800, padding: '3px 6px', color: '#141414', background: '#F5A623', clipPath: 'polygon(3% 5%,97% 0%,100% 95%,0% 100%)', whiteSpace: 'nowrap' }}>{t('nextToPlay')}</span>
}
export function SmartScheduleHint({ forecast, now, locale, tz, scheduledTime }: { forecast: SmartScheduleForecast; now: number; locale: string; tz: string; scheduledTime?: string | null }) {
  const t = useTranslations('smartSchedule')
  const [open, setOpen] = useState(false)
  const range = relativeStartWindow(forecast, now)
  const clock = startClockWindow(forecast, locale, tz)
  if (!range && !forecast.predecessor_id) return null
  const early = earliestStartClock(forecast, locale, tz)
  const heading = range ? forecast.next_to_play ? t('estimatePrefix') : t('unlikelyBefore') : null
  const value = range ? forecast.next_to_play ? range.max >= 120 ? t('hoursRange', { min: Math.floor(range.min / 30) / 2, max: Math.ceil(range.max / 30) / 2 }) : t('minutesRange', range) : early : t('afterPrevious')
  return <>
    <button type="button" aria-expanded={open} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(!open) }} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false) } }} style={{ color: '#F5A623', fontSize: 9, fontWeight: 600, padding: '2px 0', textAlign: 'right', lineHeight: 1.3, border: 0, borderBottom: '1px dotted #F5A62366', background: 'transparent', cursor: 'pointer', whiteSpace: 'nowrap' }}>{heading && <span style={{ display: 'block', fontSize: 9, fontWeight: 600 }}>{heading}</span>}<span style={{ display: 'block', fontSize: range ? 13 : 9, fontWeight: range ? 800 : 600 }}>{value}</span></button>
    {open && <div role="tooltip" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false) }} style={{ position: 'absolute', right: 12, bottom: 5, zIndex: 5, maxWidth: 260, padding: 12, background: '#1A1A1D', border: '1px solid #F5A62344', fontSize: 12, lineHeight: 1.5, color: '#ccc', textAlign: 'left' }}>
      {clock && <div style={{ color: '#F5A623', fontWeight: 700 }}>{t('estimatedWindow', { window: clock })}</div>}
      {scheduledTime && <div style={{ color: '#999', marginBottom: 4 }}>{t('scheduledAt', { time: scheduledTime })}</div>}
      {t('explanation')}
    </div>}
  </>
}

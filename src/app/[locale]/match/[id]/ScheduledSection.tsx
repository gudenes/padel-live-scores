'use client'
// Scheduled section: countdown timer and tournament info rows.
import { useLocale, useTranslations } from 'next-intl'
import { Match, pairName, getMatchDisplay } from '@/types/match'
import { useSmartSchedule } from '@/hooks/useSmartSchedule'
import { useSchedulePredecessor } from '@/hooks/useSchedulePredecessor'
import { relativeStartWindow, startClockWindow } from '@/lib/smart-schedule'
import { GREEN, BG_CARD, MUTED, BORDER } from './lib/constants'

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function ScheduledSection({ match, pair1Label, pair2Label, countdown, tz }: {
  match: Match; pair1Label: string; pair2Label: string
  countdown: { h: number; m: number; s: number }; tz: string
}) {
  const tMatch = useTranslations('matchDetail')
  const tCommon = useTranslations('common')
  const tSmart = useTranslations('smartSchedule')
  const locale = useLocale()
  const { enabled, forecast, now } = useSmartSchedule(match)
  const predecessor = useSchedulePredecessor(forecast?.predecessor_id ?? null)
  const range = forecast ? relativeStartWindow(forecast, now) : null
  const clock = forecast ? startClockWindow(forecast, locale, tz) : null
  const pad = (n: number) => String(n).padStart(2, '0')
  const tournamentName = (match as Match & { tournament?: { name?: string } }).tournament?.name ?? null
  const scheduleLabel = (match as Match & { schedule_label?: string | null }).schedule_label ?? null
  const isApproximate = /not before|followed by/i.test(scheduleLabel ?? '')
  const hasTime = match.scheduled_at
    ? (() => { const d = new Date(match.scheduled_at); return d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0 })()
    : false
  const hasCountdown = hasTime && (countdown.h > 0 || countdown.m > 0 || countdown.s > 0)

  return (
    <>
      {/* Countdown */}
      <div style={{ background: BG_CARD, borderBottom: `0.5px solid ${BORDER}`, padding: '14px 16px', textAlign: 'center' }}>
        {enabled ? <>
          <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, letterSpacing: 1, marginBottom: 8 }}>{tSmart(range ? 'estimatedStart' : 'scheduledStart')}</div>
          <div style={{ fontSize: range ? 28 : 14, fontWeight: 800, color: '#F5A623' }}>{range ? range.max >= 120 ? tSmart('hoursRange', { min: Math.floor(range.min / 30) / 2, max: Math.ceil(range.max / 30) / 2 }) : tSmart('minutesRange', range) : forecast?.predecessor_id ? tSmart('afterPrevious') : tSmart('unavailable')}</div>
          {clock && <div style={{ fontSize: 13, color: '#ccc', marginTop: 6 }}>{tSmart('clockWindow', { window: clock })}</div>}
          <div style={{ fontSize: 12, color: MUTED, marginTop: 8 }}>
            {/followed by/i.test(scheduleLabel ?? '') ? tSmart('followedBy') : hasTime && match.scheduled_at ? tSmart(/not before/i.test(scheduleLabel ?? '') ? 'notBefore' : 'scheduledAt', { time: new Intl.DateTimeFormat(locale, { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(match.scheduled_at)) }) : tMatch('startTimeTbd')}
          </div>
          {range && <p style={{ fontSize: 11, color: MUTED, margin: '8px 0 0' }}>{tSmart('explanation')}</p>}
        </> : <>
        {hasCountdown ? (
          <div style={{ fontSize: 9, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 10 }}>
            {isApproximate ? tMatch('estimatedStartIn') : tMatch('startsIn')}
          </div>
        ) : (
          <div style={{ fontSize: 9, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 10 }}>
            {hasTime ? tSmart('waiting') : tMatch('startTimeTbd')}
          </div>
        )}
        {hasCountdown ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
              {[{ n: countdown.h, l: tCommon('hrs') }, { n: countdown.m, l: tCommon('min') }, { n: countdown.s, l: tCommon('sec') }].map(({ n, l }, i) => (
                <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {i > 0 && <span style={{ fontSize: 22, fontWeight: 900, color: BORDER, marginTop: -6 }}>:</span>}
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 26, fontWeight: 900, fontFamily: 'monospace', color: isApproximate ? '#F5A623' : GREEN, lineHeight: 1 }}>{pad(n)}</div>
                    <div style={{ fontSize: 8, color: MUTED, marginTop: 2, letterSpacing: '0.5px' }}>{l}</div>
                  </div>
                </div>
              ))}
            </div>
            {isApproximate && (
              <div style={{ fontSize: 9, color: '#F5A623', marginTop: 8, fontWeight: 600 }}>
                ⚠ {tMatch('timeEstimated')}
              </div>
            )}
          </>
        ) : hasTime ? (
          <div style={{ fontSize: 13, fontWeight: 700, color: GREEN }}>{tSmart('waiting')}</div>
        ) : (
          <div style={{ fontSize: 11, color: MUTED }}>{tMatch('startTimeTbd')}</div>
        )}
        </>}
      </div>

      {predecessor && predecessor.court === match.court && <div style={{ background: BG_CARD, padding: '12px 16px', borderBottom: `0.5px solid ${BORDER}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, marginBottom: 10 }}>
          <span>{tSmart('previousOnCourt', { court: match.court ?? '' })}</span>
          <span style={{ color: predecessor.status === 'live' ? '#FF4655' : MUTED }}>{tSmart(predecessor.status === 'live' ? 'live' : (predecessor.status as string) === 'on_court' ? 'onCourt' : 'finished')}</span>
        </div>
        {[pairName(predecessor.pair1_player1, predecessor.pair1_player2), pairName(predecessor.pair2_player1, predecessor.pair2_player2)].map((name, i) => <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, padding: '6px 0' }}>
          <span>{name}</span><span style={{ display: 'flex', gap: 10 }}>{getMatchDisplay(predecessor).sets.map((s) => <b key={s.raw.set_number}>{i === 0 ? s.p1Games : s.p2Games}</b>)}</span>
        </div>)}
        {forecast?.source_updated_at && <div style={{ fontSize: 10, color: MUTED, marginTop: 6 }}>{tSmart('updatedAgo', { minutes: Math.max(0, Math.floor((now - Date.parse(forecast.source_updated_at)) / 60_000)) })}</div>}
      </div>}

      {/* Tournament info */}
      <div style={{ background: BG_CARD, borderBottom: `0.5px solid ${BORDER}` }}>
        {[
          tournamentName && { key: tMatch('tournament'), val: tournamentName },
          match.round && { key: tMatch('round'), val: match.round },
          match.court && { key: tMatch('court'), val: match.court },
          { key: tMatch('timezone'), val: tz.replace(/_/g, ' ') },
        ].filter((row): row is { key: string; val: string } => !!row).map((row) => (
          <div key={row.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 16px', borderBottom: `0.5px solid ${BORDER}` }}>
            <span style={{ fontSize: 11, color: MUTED, fontWeight: 600 }}>{row.key}</span>
            <span style={{ fontSize: 11, color: '#ccc', fontWeight: 600 }}>{row.val}</span>
          </div>
        ))}
      </div>
    </>
  )
}

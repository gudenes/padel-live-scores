'use client'
// Scheduled section: countdown timer and tournament info rows.
import { useTranslations } from 'next-intl'
import { Match } from '@/types/match'
import { GREEN, BG_CARD, MUTED, BORDER } from './lib/constants'

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function ScheduledSection({ match, pair1Label, pair2Label, countdown, tz }: {
  match: Match; pair1Label: string; pair2Label: string
  countdown: { h: number; m: number; s: number }; tz: string
}) {
  const tMatch = useTranslations('matchDetail')
  const tCommon = useTranslations('common')
  const pad = (n: number) => String(n).padStart(2, '0')
  const tournamentName = ((match as any).tournament)?.name ?? null
  const scheduleLabel = (match as any).schedule_label as string | null
  const isApproximate = /not before|followed by/i.test(scheduleLabel ?? '')
  const hasTime = match.scheduled_at
    ? (() => { const d = new Date(match.scheduled_at); return d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0 })()
    : false
  const hasCountdown = hasTime && (countdown.h > 0 || countdown.m > 0 || countdown.s > 0)

  return (
    <>
      {/* Countdown */}
      <div style={{ background: BG_CARD, borderBottom: `0.5px solid ${BORDER}`, padding: '14px 16px', textAlign: 'center' }}>
        {hasCountdown ? (
          <div style={{ fontSize: 9, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 10 }}>
            {isApproximate ? tMatch('estimatedStartIn') : tMatch('startsIn')}
          </div>
        ) : (
          <div style={{ fontSize: 9, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 10 }}>
            {hasTime ? tMatch('startingSoon') : tMatch('startTimeTbd')}
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
          <div style={{ fontSize: 13, fontWeight: 700, color: GREEN }}>Match is about to start</div>
        ) : (
          <div style={{ fontSize: 11, color: MUTED }}>Schedule will be updated when available</div>
        )}
      </div>

      {/* Tournament info */}
      <div style={{ background: BG_CARD, borderBottom: `0.5px solid ${BORDER}` }}>
        {[
          tournamentName && { key: tMatch('tournament'), val: tournamentName },
          match.round && { key: tMatch('round'), val: match.round },
          match.court && { key: tMatch('court'), val: match.court },
          { key: tMatch('timezone'), val: tz.replace(/_/g, ' ') },
        ].filter(Boolean).map((row: any) => (
          <div key={row.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 16px', borderBottom: `0.5px solid ${BORDER}` }}>
            <span style={{ fontSize: 11, color: MUTED, fontWeight: 600 }}>{row.key}</span>
            <span style={{ fontSize: 11, color: '#ccc', fontWeight: 600 }}>{row.val}</span>
          </div>
        ))}
      </div>
    </>
  )
}

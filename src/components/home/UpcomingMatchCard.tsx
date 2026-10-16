'use client'

import React from 'react'
import { Link } from '@/i18n/navigation'
import { Match } from '@/types/match'
import { useLocale, useTimeZone } from 'next-intl'
import { useSmartSchedule } from '@/hooks/useSmartSchedule'
import { NextToPlayBadge, ScheduledMatchTime } from '@/components/SmartSchedule'
import { formatShortDate, formatScheduledTime } from '@/lib/match-schedule-format'
import FollowButton from '@/components/FollowButton'
import {
  GREEN, MUTED, BG_CARD, BORDER, CHUNKY,
  MEN_BLUE, WOMEN_PURPLE,
  FlagImg, titleCase,
} from './shared'

function UpcomingMatchCardInner({ match }: { match: Match }) {
  const locale = useLocale()
  const tz = useTimeZone() ?? 'UTC'
  const { forecast, now } = useSmartSchedule(match)
  const time = formatScheduledTime(match, locale, tz)
  const date = formatShortDate(match, locale, tz)
  const scheduleLabel = (match as Match & { schedule_label?: string | null }).schedule_label ?? ''
  const approximate = /not before|followed by/i.test(scheduleLabel)
  const tournament = (match as any).tournament
  const category = (match as any).category as string | null
  const genderColor = category === 'women' ? WOMEN_PURPLE : category === 'men' ? MEN_BLUE : null

  const pillStyle: React.CSSProperties = {
    fontSize: 9, fontWeight: 700, padding: '3px 7px',
    clipPath: CHUNKY.badge, textTransform: 'uppercase',
    letterSpacing: 0.3,
  }

  return (
    <Link href={`/match/${match.id}`} style={{ textDecoration: 'none', color: 'inherit', position: 'relative' }}>
      <div style={{
      background: BG_CARD,
      border: `1px solid ${BORDER}`,
      clipPath: CHUNKY.card,
      padding: '10px 14px',
      width: 300,
      flexShrink: 0,
      position: 'relative',
      overflow: 'hidden',
      cursor: 'pointer',
    }}>
      {/* Left accent bar — gender color */}
      <div style={{
        position: 'absolute',
        top: 0, left: 0, bottom: 0,
        width: 3,
        background: genderColor ?? GREEN,
      }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {tournament && (
            <span style={{ ...pillStyle, background: 'rgba(255,255,255,0.06)', color: MUTED, fontSize: 9 }}>
              {titleCase(tournament.name)}
            </span>
          )}
          <span style={{ ...pillStyle, background: 'rgba(255,255,255,0.06)', color: MUTED, fontSize: 9 }}>
            {match.round ?? ''}
          </span>
        </div>
        <FollowButton type="match" targetId={match.id} variant="star" size={14} />
      </div>
      {/* Players + date/time two-column layout */}
      {(() => {
        const seed1 = Math.min(
          match.pair1_player1?.ranking ?? 9999,
          match.pair1_player2?.ranking ?? 9999
        )
        const seed2 = Math.min(
          match.pair2_player1?.ranking ?? 9999,
          match.pair2_player2?.ranking ?? 9999
        )
        return (
          <div style={{ display: 'flex', gap: 6 }}>
            {/* Left: players */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {[match.pair1_player1, match.pair1_player2].map((p, i) => (
                <div key={`p1-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '1px 0' }}>
                  <FlagImg country={p?.country ?? null} size={13} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#fff', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p?.name ?? 'TBD'}</span>
                  {i === 0 && seed1 < 9999 && (
                    <span style={{ fontSize: 9, fontWeight: 700, color: MUTED, opacity: 0.7 }}>#{seed1}</span>
                  )}
                </div>
              ))}
              <div style={{ fontSize: 9, color: MUTED, margin: '2px 0', paddingLeft: 2 }}>vs</div>
              {[match.pair2_player1, match.pair2_player2].map((p, i) => (
                <div key={`p2-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '1px 0' }}>
                  <FlagImg country={p?.country ?? null} size={13} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#fff', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p?.name ?? 'TBD'}</span>
                  {i === 0 && seed2 < 9999 && (
                    <span style={{ fontSize: 9, fontWeight: 700, color: MUTED, opacity: 0.7 }}>#{seed2}</span>
                  )}
                </div>
              ))}
            </div>
            {/* Same forecast, fallback and explanation as the matches page. */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center', borderLeft: `1px solid ${BORDER}`, paddingLeft: 8, width: 100, minWidth: 0, flexShrink: 0, boxSizing: 'border-box' }}>
              {forecast?.next_to_play && <NextToPlayBadge compact />}
              {date && <span style={{ fontSize: 10, fontWeight: 600, color: MUTED }}>{date}</span>}
              <ScheduledMatchTime forecast={forecast} now={now} locale={locale} tz={tz} time={time} approximate={approximate} />
            </div>
          </div>
        )
      })()}
      </div>
    </Link>
  )
}

const UpcomingMatchCard = React.memo(UpcomingMatchCardInner)
export default UpcomingMatchCard

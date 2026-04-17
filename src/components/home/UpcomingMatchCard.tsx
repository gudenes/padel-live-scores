'use client'

import React from 'react'
import { Link } from '@/i18n/navigation'
import { Match, pairName } from '@/types/match'
import { useFormatter } from 'next-intl'
import { TIME_24H, DATE_SHORT } from '@/lib/format-patterns'
import FollowButton from '@/components/FollowButton'
import {
  GREEN, MUTED, BG_CARD, BORDER, CHUNKY,
  MEN_BLUE, WOMEN_PURPLE,
  FlagImg, titleCase,
} from './shared'

function UpcomingMatchCardInner({ match }: { match: Match }) {
  const format = useFormatter()
  const pair1 = pairName(match.pair1_player1, match.pair1_player2)
  const pair2 = pairName(match.pair2_player1, match.pair2_player2)
  // Detect date-only scheduled_at (midnight UTC = no real time from padelapi)
  const scheduledDate = match.scheduled_at ? new Date(match.scheduled_at) : null
  const hasTime = scheduledDate
    ? scheduledDate.getUTCHours() !== 0 || scheduledDate.getUTCMinutes() !== 0
    : false
  const time = hasTime
    ? format.dateTime(scheduledDate!, TIME_24H)
    : ''
  const date = match.scheduled_at
    ? format.dateTime(scheduledDate!, DATE_SHORT)
    : ''
  const tournament = (match as any).tournament
  const isLive = match.status === 'live'
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
      width: 260,
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
            {/* Right: date/time centered */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', borderLeft: `1px solid ${BORDER}`, paddingLeft: 8, minWidth: 65 }}>
              <span style={{ fontSize: 10, fontWeight: 600, textAlign: 'center', lineHeight: 1.4 }}>
                {date && time
                  ? <><span style={{ color: GREEN }}>{date}</span><br /><span style={{ color: GREEN, fontFamily: 'monospace', fontWeight: 700 }}>{time}</span></>
                  : <><span style={{ color: MUTED }}>Time to be</span><br /><span style={{ color: MUTED }}>confirmed</span></>
                }
              </span>
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

'use client'

import React from 'react'
import { Link } from '@/i18n/navigation'
import { useFormatter, useTranslations } from 'next-intl'
import FollowButton from '@/components/FollowButton'
import {
  GREEN, GREEN_DIM, ORANGE, BG_CARD, MUTED, BORDER, CHUNKY,
  Tournament, FlagImg, titleCase, countryName, daysUntil, formatDateRange, levelLabel,
} from './shared'

function TournamentSpotlightInner({ tournament, matchCount }: { tournament: Tournament; matchCount: number }) {
  const format = useFormatter()
  const tList = useTranslations('home.tournamentList')
  const tSpot = useTranslations('home.spotlight')
  const tTournament = useTranslations('tournament')
  const isLive = daysUntil(tournament.starts_at) === 0
  const days = daysUntil(tournament.starts_at)
  const level = levelLabel(tournament.level)

  // Simple progress: if live, show QF/SF/F based on dates
  const totalDays = Math.max(1, Math.ceil((new Date(tournament.ends_at).getTime() - new Date(tournament.starts_at).getTime()) / 86400000))
  const elapsed = Math.max(0, Math.ceil((Date.now() - new Date(tournament.starts_at).getTime()) / 86400000))
  const progress = isLive ? Math.min(100, (elapsed / totalDays) * 100) : 0

  return (
    <div style={{
      margin: '0 16px',
      background: `linear-gradient(135deg, ${BG_CARD} 0%, rgba(126,211,33,0.04) 100%)`,
      border: `1px solid ${isLive ? 'rgba(126,211,33,0.2)' : BORDER}`,
      clipPath: CHUNKY.card,
      padding: '20px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Decorative glow */}
      <div style={{
        position: 'absolute', top: -50, right: -50, width: 150, height: 150,
        background: isLive
          ? 'radial-gradient(circle, rgba(126,211,33,0.08) 0%, transparent 70%)'
          : 'radial-gradient(circle, rgba(245,166,35,0.06) 0%, transparent 70%)',
      }} />

      <FollowButton type="tournament" targetId={tournament.id} variant="star" size={14} style={{ position: 'absolute', top: 12, right: 12 }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative' }}>
        <div style={{ flex: 1 }}>
          <h3 style={{ fontSize: 18, fontWeight: 800, color: '#fff', margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <FlagImg country={tournament.country} size={20} />
            {titleCase(tournament.name)}
          </h3>
          <div style={{ fontSize: 12, color: MUTED }}>
            {tournament.location ? `${tournament.location}, ${countryName(tournament.country)}` : countryName(tournament.country)}
          </div>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>
            {formatDateRange(format, tournament.starts_at, tournament.ends_at)}
            {tournament.prize_money && tournament.prize_money !== 'EUR 0' && (
              <span style={{ color: GREEN, fontWeight: 600 }}> &middot; {tournament.prize_money}</span>
            )}
          </div>
        </div>

        {!isLive && days > 0 && (
          <div style={{
            background: 'rgba(255,255,255,0.04)',
            clipPath: CHUNKY.badge,
            padding: '10px 14px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: ORANGE, fontFamily: 'monospace', lineHeight: 1 }}>
              {days}
            </div>
            <div style={{ fontSize: 9, fontWeight: 700, color: MUTED, letterSpacing: 0.5, marginTop: 3 }}>
              {tList('daysLabel')}
            </div>
          </div>
        )}
      </div>

      {/* Progress bar */}
      {isLive && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: GREEN }}>
              {tSpot('matchesCount', { count: matchCount })}
            </span>
            <span style={{ fontSize: 10, fontWeight: 600, color: MUTED }}>
              {tSpot('dayOf', { elapsed, total: totalDays })}
            </span>
          </div>
          <div style={{
            height: 6,
            background: 'rgba(255,255,255,0.06)',
            borderRadius: 3,
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${progress}%`,
              background: `linear-gradient(90deg, ${GREEN}, rgba(126,211,33,0.7))`,
              clipPath: CHUNKY.bar,
              transition: 'width 0.5s',
            }} />
          </div>
        </div>
      )}

      <Link
        href={`/tournaments/${tournament.id}`}
        style={{
          display: 'inline-block',
          marginTop: 14,
          padding: '8px 20px',
          background: 'rgba(255,255,255,0.06)',
          color: GREEN,
          fontSize: 12,
          fontWeight: 700,
          textDecoration: 'none',
          clipPath: CHUNKY.button,
          transition: 'background 0.15s',
        }}
      >
        {tTournament('viewEventDetails')} &rarr;
      </Link>
    </div>
  )
}

const TournamentSpotlight = React.memo(TournamentSpotlightInner)
export default TournamentSpotlight

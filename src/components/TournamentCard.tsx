'use client'

import React from 'react'
import { Link } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import { Match } from '@/types/match'
import { FlagImage } from '@/components/FlagImage'
import { mostAdvancedRound } from '@/lib/tournament-labels'
import { ResultCard } from '@/components/ResultCard'
import V3MatchRow from '@/components/MatchRow'

const BG_BASE = '#1A1A1A'
const BG_CARD = '#141414'
const LIVE_RED = '#FF4655'
const MUTED = '#6B7280'
const BORDER = 'rgba(255,255,255,0.06)'

const CHUNKY = {
  badge: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
}

const KEEP_UPPER = new Set(['FIP', 'P1', 'P2', 'WPT', 'APT', 'A1', 'II', 'III', 'IV', 'BNL'])
function titleCase(name: string): string {
  return name.split(' ').map(word => {
    if (KEEP_UPPER.has(word.toUpperCase())) return word.toUpperCase()
    if (word.length <= 1) return word.toUpperCase()
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  }).join(' ')
}

function TournamentCard({ tournament, matches, tab }: {
  tournament: any
  matches: Match[]
  tab: 'yesterday' | 'today' | 'upcoming'
}) {
  const t = useTranslations('matches')
  if (!tournament) return null

  const stageLabel = mostAdvancedRound(matches)
  const anyLive = matches.some(m => m.status === 'live')
  const matchCount = matches.length

  return (
    <div>
      {/* Light text header — no dark block, no 2px accent bar, no chevron */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '16px 14px 8px',
        background: BG_BASE,
      }}>
        {tournament.country && <FlagImage country={tournament.country} size={16} />}
        <Link
          href={`/tournaments/${tournament.id}`}
          style={{
            flex: 1, minWidth: 0, textDecoration: 'none', color: 'inherit',
            display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
          }}
        >
          <span style={{
            fontSize: 11, fontWeight: 800, color: '#fff',
            letterSpacing: 0.5, textTransform: 'uppercase',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {titleCase(tournament.name)}
          </span>
          {stageLabel && (
            <>
              <span style={{ margin: '0 4px', color: MUTED, fontSize: 10 }}>·</span>
              <span style={{
                fontSize: 10, fontWeight: 700, color: MUTED,
                letterSpacing: 0.3, textTransform: 'uppercase',
              }}>
                {stageLabel}
              </span>
            </>
          )}
          {anyLive && (
            <span role="status" aria-label={t('liveNow')} style={{
              width: 5, height: 5, borderRadius: '50%',
              background: LIVE_RED,
              marginLeft: 4,
              animation: 'v3-scores-pulse 2s infinite',
            }} />
          )}
        </Link>
        <span style={{
          fontSize: 9, fontWeight: 700, color: '#9CA3AF',
          padding: '2px 7px',
          background: 'rgba(255,255,255,0.04)',
          clipPath: CHUNKY.badge,
        }}>
          {matchCount}
        </span>
      </div>

      {/* Match rows — always visible, no collapse */}
      <div style={{ background: BG_CARD }}>
        {matches.map(m => (
          tab === 'yesterday'
            ? <ResultCard key={m.id} match={m} />
            : <V3MatchRow key={m.id} match={m} />
        ))}
      </div>
    </div>
  )
}

export default TournamentCard

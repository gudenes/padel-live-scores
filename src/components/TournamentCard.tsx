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
const GREEN = '#7ED321'

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

const PREMIER_LEVELS = new Set(['p1', 'p2', 'major', 'finals'])

function circuitLogoFor(level: string | null | undefined): string | null {
  if (!level) return null
  if (PREMIER_LEVELS.has(level)) return '/premier-padel-logo.svg'
  if (level.startsWith('fip_')) return '/fip-tour-logo.svg'
  return null
}

function cityCountry(tournament: any): string {
  const city = (tournament.location || tournament.name || '').trim()
  const country = (tournament.country || '').toUpperCase()
  if (city && country) return `${titleCase(city)}, ${country}`
  return titleCase(city || country || '—')
}

function levelTint(level: string | null | undefined): { bg: string; color: string } {
  if (!level) return { bg: 'rgba(255,255,255,0.06)', color: '#9CA3AF' }
  if (level === 'fip_gold')   return { bg: 'rgba(245,166,35,0.14)', color: '#F5A623' }
  if (level === 'fip_silver') return { bg: 'rgba(192,192,192,0.12)', color: '#C0C0C0' }
  if (level === 'fip_bronze') return { bg: 'rgba(205,127,50,0.14)', color: '#CD7F32' }
  if (level === 'major' || level === 'finals') return { bg: 'rgba(245,166,35,0.14)', color: '#F5A623' }
  return { bg: 'rgba(126,211,33,0.14)', color: '#7ED321' }
}

function levelShortLabel(level: string | null | undefined): string {
  if (!level) return '—'
  if (level === 'fip_gold')   return 'FIP Gold'
  if (level === 'fip_silver') return 'FIP Silver'
  if (level === 'fip_bronze') return 'FIP Bronze'
  if (level === 'fip_other')  return 'FIP'
  return level.toUpperCase()
}

function TournamentCard({ tournament, matches, tab }: {
  tournament: any
  matches: Match[]
  tab: 'yesterday' | 'today' | 'upcoming'
}) {
  const t = useTranslations('matches')
  if (!tournament) return null

  const stageLabel = mostAdvancedRound(matches)
  const liveCount = matches.filter(m => m.status === 'live').length
  const matchCount = matches.length

  const logoSrc = circuitLogoFor(tournament.level)
  const tint = levelTint(tournament.level)

  return (
    <div style={{
      margin: '14px 12px 0',
      background: BG_CARD,
      border: '1px solid rgba(255,255,255,0.10)',
      clipPath: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
      overflow: 'hidden',
      boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
    }}>
      {/* ── Header ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '72px 1fr auto',
        columnGap: 14,
        alignItems: 'center',
        padding: '14px 14px 12px',
        background: 'rgba(255,255,255,0.02)',
        borderBottom: `1px solid ${BORDER}`,
      }}>
        <div style={{
          width: 72, height: 36,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRight: `1px solid ${BORDER}`,
          paddingRight: 12,
        }}>
          {logoSrc
            ? <img src={logoSrc} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            : <FlagImage country={tournament.country ?? null} size={24} />}
        </div>

        <Link
          href={`/tournaments/${tournament.id}`}
          style={{ minWidth: 0, textDecoration: 'none', color: 'inherit', display: 'flex', flexDirection: 'column', gap: 3 }}
        >
          <div style={{
            fontSize: 14, fontWeight: 800, color: '#fff',
            letterSpacing: -0.1,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {cityCountry(tournament)}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              padding: '2px 8px',
              fontSize: 10, fontWeight: 800,
              clipPath: CHUNKY.badge,
              letterSpacing: 0.4,
              background: tint.bg, color: tint.color,
            }}>
              {levelShortLabel(tournament.level)}
            </span>
            {stageLabel && (
              <span style={{
                fontSize: 11, fontWeight: 600, color: MUTED,
                textTransform: 'uppercase', letterSpacing: 0.3,
              }}>
                · {stageLabel}
              </span>
            )}
          </div>
        </Link>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
          {liveCount > 0 && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 9, fontWeight: 900, letterSpacing: 0.6, textTransform: 'uppercase',
              color: LIVE_RED, padding: '2px 7px',
              background: 'rgba(255,70,85,0.12)',
              clipPath: CHUNKY.badge,
            }}>
              <span style={{
                width: 5, height: 5, borderRadius: '50%',
                background: LIVE_RED, animation: 'v3-scores-pulse 2s infinite',
              }} />
              {t('live')} · {liveCount}
            </span>
          )}
          <span style={{
            fontSize: 10, fontWeight: 700, color: '#9CA3AF',
            padding: '3px 9px',
            background: 'rgba(255,255,255,0.05)',
            clipPath: CHUNKY.badge,
          }}>
            {matchCount}
          </span>
        </div>
      </div>

      {/* ── Match rows ── */}
      <div>
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

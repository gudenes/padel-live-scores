'use client'

import { useState, useId } from 'react'
import Image from 'next/image'
import { useTranslations, useFormatter } from 'next-intl'
import { Link } from '@/i18n/navigation'
import {
  CHUNKY,
  GREEN,
  MUTED,
  SectionTitle,
  Tournament,
  FlagImg,
  countryName,
  levelLabel,
} from '@/components/home/shared'
import { DATE_SHORT } from '@/lib/format-patterns'

export interface TournamentWithMatchInfo extends Tournament {
  matchesToday: number
  hasLiveMatch: boolean
}

interface Props {
  liveToday: TournamentWithMatchInfo[]
  upcoming: TournamentWithMatchInfo[]
}

type Chip = 'live-today' | 'upcoming'

// Tier-aware gradient/pill maps — LOCAL to this carousel, not a project-wide
// design token. Other tournament surfaces (TournamentSpotlightHero, tournament
// rows on /matches, etc.) render neutral/white level pills; this hero
// carousel is the only place that paints tier color. If a future surface
// wants the same scheme, lift these maps to src/lib/tournament-tier-style.ts
// rather than duplicating.
//
// Keys match production tournaments.level values (Premier tiers are bare;
// FIP tiers carry the fip_ prefix). The 17 known levels are mapped here;
// unknown values land on FALLBACK_GRADIENT and a neutral grey pill.
const PREMIER_GRADIENT = 'linear-gradient(135deg, #6B46C1, #9333EA)'
const GOLD_GRADIENT    = 'linear-gradient(135deg, #92750E, #EAB308)'
const SILVER_GRADIENT  = 'linear-gradient(135deg, #475569, #94A3B8)'
const BRONZE_GRADIENT  = 'linear-gradient(135deg, #92400E, #D97706)'
const CYAN_GRADIENT    = 'linear-gradient(135deg, #155E75, #06B6D4)'
const SLATE_GRADIENT   = 'linear-gradient(135deg, #334155, #64748B)'

const TIER_GRADIENT: Record<string, string> = {
  finals: PREMIER_GRADIENT,
  major:  PREMIER_GRADIENT,
  p1:     PREMIER_GRADIENT,
  p2:     PREMIER_GRADIENT,
  fip_platinum:     GOLD_GRADIENT,
  fip_gold:         GOLD_GRADIENT,
  fip_hexagon:      PREMIER_GRADIENT,
  fip_championship: PREMIER_GRADIENT,
  fip_finals:       GOLD_GRADIENT,
  fip_silver:       SILVER_GRADIENT,
  fip_bronze:       BRONZE_GRADIENT,
  fip_star:         CYAN_GRADIENT,
  fip_rise:         CYAN_GRADIENT,
  fip_promotion:    CYAN_GRADIENT,
  fip_promises:     SLATE_GRADIENT,
  fip_beyond:       SLATE_GRADIENT,
  fip_other:        SLATE_GRADIENT,
}

const TIER_PILL: Record<string, { background: string; color: string }> = {
  finals:           { background: PREMIER_GRADIENT, color: '#fff' },
  major:            { background: PREMIER_GRADIENT, color: '#fff' },
  p1:               { background: PREMIER_GRADIENT, color: '#fff' },
  p2:               { background: PREMIER_GRADIENT, color: '#fff' },
  fip_platinum:     { background: GOLD_GRADIENT,    color: '#1A1A1A' },
  fip_gold:         { background: GOLD_GRADIENT,    color: '#1A1A1A' },
  fip_hexagon:      { background: PREMIER_GRADIENT, color: '#fff' },
  fip_championship: { background: PREMIER_GRADIENT, color: '#fff' },
  fip_finals:       { background: GOLD_GRADIENT,    color: '#1A1A1A' },
  fip_silver:       { background: SILVER_GRADIENT,  color: '#fff' },
  fip_bronze:       { background: BRONZE_GRADIENT,  color: '#fff' },
  fip_star:         { background: CYAN_GRADIENT,    color: '#fff' },
  fip_rise:         { background: CYAN_GRADIENT,    color: '#fff' },
  fip_promotion:    { background: CYAN_GRADIENT,    color: '#fff' },
  fip_promises:     { background: SLATE_GRADIENT,   color: '#fff' },
  fip_beyond:       { background: SLATE_GRADIENT,   color: '#fff' },
  fip_other:        { background: SLATE_GRADIENT,   color: '#fff' },
}

const FALLBACK_GRADIENT = 'linear-gradient(135deg, #2A2A2A, #1A1A1A)'

function TournamentCarouselCard({
  tournament,
  chip,
}: {
  tournament: TournamentWithMatchInfo
  chip: Chip
}) {
  const t = useTranslations('home.liveTournaments')
  const format = useFormatter()

  const level = tournament.level ?? ''
  const tierGradient = TIER_GRADIENT[level] ?? FALLBACK_GRADIENT
  const pillStyle = TIER_PILL[level] ?? { background: '#444', color: '#fff' }
  const tierLabel = level ? levelLabel(level) : ''

  const cover = tournament.cover_image_url ?? null
  const city = tournament.location ?? countryName(tournament.country)

  const statusLine =
    chip === 'live-today'
      ? tournament.matchesToday > 0
        ? t('matchesTodayCount', { count: tournament.matchesToday })
        : t('restDay')
      : t('startsOn', {
          date: format.dateTime(new Date(tournament.starts_at), DATE_SHORT),
        })

  const ariaLabel = [tournament.name, tierLabel, statusLine].filter(Boolean).join(', ')

  return (
    <Link
      href={`/tournaments/${tournament.id}`}
      aria-label={ariaLabel}
      style={{ textDecoration: 'none', color: '#fff' }}
    >
      <div
        style={{
          position: 'relative',
          width: 178,
          height: 240,
          background: tierGradient,
          clipPath: CHUNKY.card,
          overflow: 'hidden',
        }}
      >
        {/* Cover image — fills the card; falls back to the tier gradient when null */}
        {cover && (
          <Image
            src={cover}
            alt=""
            fill
            sizes="178px"
            priority={false}
            style={{ objectFit: 'cover' }}
          />
        )}

        {/* Bottom gradient overlay for legibility */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.85) 70%, rgba(0,0,0,0.95) 100%)',
            pointerEvents: 'none',
          }}
        />

        {/* LIVE pill */}
        {tournament.hasLiveMatch && (
          <div
            style={{
              position: 'absolute',
              top: 9,
              left: 9,
              background: '#FF4655',
              color: '#fff',
              fontSize: 9,
              fontWeight: 900,
              padding: '4px 9px',
              letterSpacing: 1,
              clipPath: CHUNKY.badge,
              zIndex: 2,
            }}
          >
            LIVE
          </div>
        )}

        {/* Level pill */}
        {tierLabel && (
          <div
            style={{
              position: 'absolute',
              top: 9,
              right: 9,
              background: pillStyle.background,
              color: pillStyle.color,
              fontSize: 9,
              fontWeight: 900,
              padding: '4px 8px',
              letterSpacing: 0.5,
              clipPath: CHUNKY.badge,
              zIndex: 2,
              textTransform: 'uppercase',
            }}
          >
            {tierLabel}
          </div>
        )}

        {/* Meta block */}
        <div
          style={{
            position: 'absolute',
            left: 10,
            right: 10,
            bottom: 10,
            zIndex: 2,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          {tournament.country && (
            <div>
              <FlagImg country={tournament.country} size={16} />
            </div>
          )}
          <div style={{ fontSize: 15, fontWeight: 800, lineHeight: 1.15 }}>
            {tournament.name}
          </div>
          {city && (
            <div style={{ fontSize: 10.5, color: '#9CA3AF' }}>{city}</div>
          )}
          <div style={{ fontSize: 10, color: GREEN, fontWeight: 700, marginTop: 2 }}>
            {statusLine}
          </div>
          <div
            style={{
              marginTop: 6,
              background: GREEN,
              color: '#0E1B05',
              fontSize: 10,
              fontWeight: 900,
              padding: '7px 0',
              textAlign: 'center',
              letterSpacing: 0.4,
              clipPath: CHUNKY.button,
              textTransform: 'uppercase',
            }}
          >
            {t('viewMatches')}
          </div>
        </div>
      </div>
    </Link>
  )
}

export default function LiveTournamentsCarousel({ liveToday, upcoming }: Props) {
  const t = useTranslations('home.liveTournaments')
  const tablistId = useId()
  const liveTabId = `${tablistId}-live`
  const upcomingTabId = `${tablistId}-upcoming`
  const panelId = `${tablistId}-panel`

  const defaultChip: Chip = liveToday.length > 0 ? 'live-today' : 'upcoming'
  const [chip, setChip] = useState<Chip>(defaultChip)

  const visible = chip === 'live-today' ? liveToday : upcoming

  if (liveToday.length === 0 && upcoming.length === 0) return null

  return (
    <section aria-labelledby={`${tablistId}-title`}>
      <SectionTitle>
        <span id={`${tablistId}-title`}>{t('title')}</span>
      </SectionTitle>

      <div
        role="tablist"
        aria-label={t('title')}
        style={{ display: 'flex', gap: 8, padding: '0 16px 12px' }}
      >
        <ChipButton
          id={liveTabId}
          panelId={panelId}
          active={chip === 'live-today'}
          onClick={() => setChip('live-today')}
          disabled={liveToday.length === 0}
        >
          {t('chipLiveToday')}
        </ChipButton>
        <ChipButton
          id={upcomingTabId}
          panelId={panelId}
          active={chip === 'upcoming'}
          onClick={() => setChip('upcoming')}
          disabled={upcoming.length === 0}
        >
          {t('chipUpcoming')}
        </ChipButton>
      </div>

      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={chip === 'live-today' ? liveTabId : upcomingTabId}
        style={{
          display: 'flex',
          gap: 12,
          padding: '0 16px 8px',
          overflowX: 'auto',
          scrollSnapType: 'x mandatory',
          WebkitOverflowScrolling: 'touch',
          msOverflowStyle: 'none',
          scrollbarWidth: 'none',
        }}
      >
        {visible.map(tournament => (
          <div
            key={tournament.id}
            style={{ scrollSnapAlign: 'start', flexShrink: 0, width: 178 }}
          >
            <TournamentCarouselCard tournament={tournament} chip={chip} />
          </div>
        ))}
      </div>
    </section>
  )
}

function ChipButton({
  id,
  panelId,
  active,
  onClick,
  disabled,
  children,
}: {
  id: string
  panelId: string
  active: boolean
  onClick: () => void
  disabled: boolean
  children: React.ReactNode
}) {
  return (
    <button
      id={id}
      role="tab"
      aria-selected={active}
      aria-controls={panelId}
      onClick={onClick}
      disabled={disabled}
      style={{
        background: active ? GREEN : 'rgba(255,255,255,0.06)',
        color: active ? '#0E1B05' : disabled ? MUTED : '#fff',
        clipPath: CHUNKY.button,
        padding: '7px 14px',
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  )
}

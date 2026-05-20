'use client'

import { useState, useId } from 'react'
import TournamentCoverImage from '@/components/TournamentCoverImage'
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
import { getTierGradient, getTierPill } from '@/lib/tournament-tier-style'

export interface TournamentWithMatchInfo extends Tournament {
  matchesToday: number
  hasLiveMatch: boolean
}

interface Props {
  liveToday: TournamentWithMatchInfo[]
  upcoming: TournamentWithMatchInfo[]
}

type Chip = 'live-today' | 'upcoming'

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
  const tierGradient = getTierGradient(level)
  const pillStyle = getTierPill(level)
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
        <TournamentCoverImage
          src={cover}
          alt=""
          variant="tile-portrait"
          sizes="178px"
        />

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

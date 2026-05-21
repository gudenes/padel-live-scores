'use client'

import TournamentCoverImage from '@/components/TournamentCoverImage'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import {
  CHUNKY,
  GREEN,
  SectionTitle,
  Tournament,
  FlagImg,
  countryName,
  levelLabel,
} from '@/components/home/shared'
import { getTierGradient, getTierPill } from '@/lib/tournament-tier-style'

export interface TournamentWithMatchInfo extends Tournament {
  matchesToday: number
}

interface Props {
  liveToday: TournamentWithMatchInfo[]
}

function TournamentCarouselCard({
  tournament,
}: {
  tournament: TournamentWithMatchInfo
}) {
  const t = useTranslations('home.liveTournaments')

  const level = tournament.level ?? ''
  const tierGradient = getTierGradient(level)
  const pillStyle = getTierPill(level)
  const tierLabel = level ? levelLabel(level) : ''

  const cover = tournament.cover_image_url ?? null
  const city = tournament.location ?? countryName(tournament.country)

  const statusLine =
    tournament.matchesToday > 0
      ? t('matchesTodayCount', { count: tournament.matchesToday })
      : t('restDay')

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

        {/* LIVE chip — presence indicator (tournament is running today
            with matches scheduled). No pulse; calmer than a "scores
            ticking" signal. */}
        {tournament.matchesToday > 0 && (
          <div
            style={{
              position: 'absolute',
              top: 9,
              left: 9,
              background: '#FF4655',
              color: '#fff',
              fontSize: 8,
              fontWeight: 900,
              padding: '3px 7px',
              letterSpacing: 0.8,
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

export default function LiveTournamentsCarousel({ liveToday }: Props) {
  const t = useTranslations('home.liveTournaments')
  const tHome = useTranslations('home')

  if (liveToday.length === 0) return null

  return (
    <section aria-label={t('title')}>
      <SectionTitle action={tHome('fullEvents')} href="/tournaments">
        {t('title')}
      </SectionTitle>

      <div
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
        {liveToday.map(tournament => (
          <div
            key={tournament.id}
            style={{ scrollSnapAlign: 'start', flexShrink: 0, width: 178 }}
          >
            <TournamentCarouselCard tournament={tournament} />
          </div>
        ))}
      </div>
    </section>
  )
}

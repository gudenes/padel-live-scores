'use client'

import TournamentCoverImage from '@/components/TournamentCoverImage'
import { useFormatter, useTranslations } from 'next-intl'
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
import PressButton, { PRESS_PRESETS } from '@/components/PressButton'

/**
 * One pair of champion players from a winner_pair=1 or =2 finals row.
 * Names + countries fall back to the thin-match raw columns when the
 * joined players row is missing (same policy as MatchCard).
 */
export interface ChampionPair {
  player1Name: string
  player1Country: string | null
  player2Name: string
  player2Country: string | null
}

/**
 * Champion data attached to a tournament when one or both finals
 * finished in the carousel's back-window (currently 48h). When only
 * one gender's final is done the other side stays undefined and the
 * card renders "Final M: TBD" / "Final W: TBD" in muted style.
 */
export interface TournamentChampions {
  men?: ChampionPair
  women?: ChampionPair
  /** Latest finished_at across this tournament's finals — drives "Coronado hace Xh". */
  crownedAt: string
}

export interface TournamentWithMatchInfo extends Tournament {
  matchesToday: number
  champions?: TournamentChampions
}

const GOLD = '#F5C842'
const GOLD_SOFT = 'rgba(245,200,66,0.18)'

interface Props {
  liveToday: TournamentWithMatchInfo[]
}

/**
 * Render one pair of champion players: stacked dual flags + names.
 * Compact line that fits a 196px-wide card.
 */
function ChampionLine({
  pair,
  category,
  tCategory,
}: {
  pair: ChampionPair | undefined
  category: 'men' | 'women'
  tCategory: string
}) {
  if (!pair) {
    return (
      <div style={{
        fontSize: 10, color: '#6B7280', fontWeight: 600,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {tCategory}
      </div>
    )
  }
  const p1Country = pair.player1Country ?? pair.player2Country
  const p2Country = pair.player2Country ?? pair.player1Country
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {/* Stacked dual flags — mirrors MatchCard's pair flag stack */}
      <div style={{ position: 'relative', width: 20, height: 16, flexShrink: 0 }}>
        <div style={{ position: 'absolute', top: 0, left: 0, zIndex: 2 }}>
          <FlagImg country={p1Country} size={12} />
        </div>
        <div style={{ position: 'absolute', top: 4, left: 6, zIndex: 1 }}>
          <FlagImg country={p2Country} size={12} />
        </div>
      </div>
      <div style={{
        fontSize: 11, fontWeight: 700, color: '#fff',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        minWidth: 0, flex: 1,
      }}>
        {shortName(pair.player1Name)} / {shortName(pair.player2Name)}
      </div>
      <div style={{
        fontSize: 9, fontWeight: 800, color: GOLD, flexShrink: 0,
        letterSpacing: 0.4,
      }}>
        {category === 'men' ? 'M' : 'W'}
      </div>
    </div>
  )
}

/**
 * Compact name: keep the last word (surname), abbreviate first names to
 * initial-letter. "Galan Romo, Alejandro" → "A. Galan Romo". This is the
 * convention used elsewhere in the app (see toShortName in types/match).
 * Defensive against single-word names and empty strings.
 */
function shortName(full: string): string {
  if (!full || typeof full !== 'string') return ''
  const parts = full.trim().split(/\s+/)
  if (parts.length === 1) return parts[0] ?? ''
  const first = parts[0] ?? ''
  const rest = parts.slice(1).join(' ')
  return `${first.charAt(0)}. ${rest}`
}

function TournamentCarouselCard({
  tournament,
}: {
  tournament: TournamentWithMatchInfo
}) {
  const t = useTranslations('home.liveTournaments')
  const format = useFormatter()

  const level = tournament.level ?? ''
  const tierGradient = getTierGradient(level)
  const pillStyle = getTierPill(level)
  const tierLabel = level ? levelLabel(level) : ''

  const cover = tournament.cover_image_url ?? null
  const city = tournament.location ?? countryName(tournament.country)

  // Treatment decision: live > crowned > neither (caller already filtered).
  const isCrowned = tournament.matchesToday === 0 && !!tournament.champions

  const statusLine = isCrowned
    ? format.relativeTime(new Date(tournament.champions!.crownedAt))
    : tournament.matchesToday > 0
      ? t('matchesTodayCount', { count: tournament.matchesToday })
      : t('restDay')

  const ariaLabel = [tournament.name, tierLabel, statusLine].filter(Boolean).join(', ')

  return (
    <Link
      href={`/tournaments/${tournament.id}?tab=matches&intent=matches`}
      aria-label={ariaLabel}
      style={{ textDecoration: 'none', color: '#fff' }}
    >
      <div
        style={{
          position: 'relative',
          width: 196,
          height: 264,
          background: tierGradient,
          clipPath: CHUNKY.card,
          overflow: 'hidden',
        }}
      >
        {/* Cover image — desaturated for the crowned treatment so the
            gold accent + champion names pop without competing with the
            tournament artwork. Filter is the only diff vs. live cards. */}
        <div style={{ position: 'absolute', inset: 0, filter: isCrowned ? 'saturate(0.55) brightness(0.85)' : 'none' }}>
          <TournamentCoverImage
            src={cover}
            alt=""
            variant="tile-portrait"
            sizes="196px"
          />
        </div>

        {/* Bottom gradient overlay for legibility — extra dark on
            crowned so 4-line champion block has solid contrast. */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: isCrowned
              ? 'linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.92) 60%, rgba(0,0,0,0.98) 100%)'
              : 'linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.85) 70%, rgba(0,0,0,0.95) 100%)',
            pointerEvents: 'none',
          }}
        />

        {/* Top-left chip — LIVE (red) for live, CHAMPION (gold) for
            crowned. Calmer than a pulsing scores ticker. */}
        {tournament.matchesToday > 0 ? (
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
        ) : isCrowned ? (
          <div
            style={{
              position: 'absolute',
              top: 9,
              left: 9,
              background: GOLD_SOFT,
              color: GOLD,
              fontSize: 8,
              fontWeight: 900,
              padding: '3px 7px',
              letterSpacing: 0.8,
              clipPath: CHUNKY.badge,
              zIndex: 2,
              display: 'flex',
              alignItems: 'center',
              gap: 3,
              border: `1px solid ${GOLD}`,
            }}
          >
            <span aria-hidden style={{ fontSize: 9 }}>★</span>
            {t('crowned')}
          </div>
        ) : null}

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

          {isCrowned ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
              <ChampionLine
                pair={tournament.champions!.men}
                category="men"
                tCategory={t('finalMTbd')}
              />
              <ChampionLine
                pair={tournament.champions!.women}
                category="women"
                tCategory={t('finalWTbd')}
              />
              <div style={{ fontSize: 9, color: GOLD, fontWeight: 700, marginTop: 2, textTransform: 'capitalize' }}>
                {statusLine}
              </div>
            </div>
          ) : (
            <>
              {city && (
                <div style={{ fontSize: 10.5, color: '#9CA3AF' }}>{city}</div>
              )}
              <div style={{ fontSize: 10, color: GREEN, fontWeight: 700, marginTop: 2 }}>
                {statusLine}
              </div>
            </>
          )}

          <PressButton
            as="div"
            {...PRESS_PRESETS.chunkyTilted}
            style={{
              marginTop: 6,
              height: 30,
              fontSize: 10,
              fontWeight: 900,
              letterSpacing: 0.4,
              textTransform: 'uppercase',
            }}
          >
            {isCrowned ? t('viewRecap') : t('viewMatches')}
          </PressButton>
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
            style={{ scrollSnapAlign: 'start', flexShrink: 0, width: 196 }}
          >
            <TournamentCarouselCard tournament={tournament} />
          </div>
        ))}
      </div>
    </section>
  )
}

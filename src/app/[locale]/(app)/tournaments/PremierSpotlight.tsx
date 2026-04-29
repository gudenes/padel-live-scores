'use client'

// Premier Spotlight — the headline card at the top of /tournaments.
//
// Two stacked sections:
//   1. Último campeón — most recent completed Premier with champions
//   2. Próximo Premier — next upcoming Premier with countdown
//
// Visual language mirrors src/components/home/TournamentSpotlight.tsx:
// 135° diagonal gradient, decorative radial glow top-right, ORANGE
// countdown for upcoming. Sized bigger than that component because
// this is the page's primary feature card.

import { Link } from '@/i18n/navigation'
import { useFormatter } from 'next-intl'
import { FlagImage } from '@/components/FlagImage'
import {
  GREEN, ORANGE, BG_CARD, MUTED, BORDER, CHUNKY,
  titleCase,
} from '@/components/home/shared'
import {
  tierShortLabel,
  type PremierSpotlightData,
  type TournamentSummary,
  type ChampionPair,
} from './types'

interface PremierSpotlightProps {
  data: PremierSpotlightData
}

export default function PremierSpotlight({ data }: PremierSpotlightProps) {
  // Hide entirely if neither section has anything to show — keeps the
  // top of the page clean during the early-January gap when no Premier
  // has happened yet AND no Premier is upcoming within the year.
  if (!data.lastChampion && !data.nextPremier) return null

  return (
    <div
      style={{
        margin: '14px 16px',
        background: `linear-gradient(135deg, ${BG_CARD} 0%, rgba(126,211,33,0.06) 100%)`,
        border: '1px solid rgba(126,211,33,0.2)',
        clipPath: CHUNKY.card,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Decorative glow blob — same trick as TournamentSpotlight.tsx */}
      <div
        style={{
          position: 'absolute',
          top: -50,
          right: -50,
          width: 150,
          height: 150,
          background: 'radial-gradient(circle, rgba(126,211,33,0.08) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />

      {/* Eyebrow */}
      <div
        style={{
          padding: '12px 16px 4px',
          fontFamily: 'var(--font-mono, "SF Mono", monospace)',
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: '0.18em',
          color: GREEN,
          textTransform: 'uppercase',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          position: 'relative',
        }}
      >
        <span
          style={{
            width: 5,
            height: 5,
            background: GREEN,
            borderRadius: '50%',
            boxShadow: '0 0 6px rgba(126,211,33,0.6)',
          }}
        />
        Premier Spotlight
      </div>

      {data.lastChampion && (
        <SpotlightSection
          tournament={data.lastChampion}
          variant="last-champion"
        />
      )}
      {data.nextPremier && (
        <SpotlightSection
          tournament={data.nextPremier}
          variant="next"
          showDivider={!!data.lastChampion}
        />
      )}
    </div>
  )
}

interface SectionProps {
  tournament: TournamentSummary
  variant: 'last-champion' | 'next'
  showDivider?: boolean
}

function SpotlightSection({ tournament: t, variant, showDivider = false }: SectionProps) {
  const isLastChampion = variant === 'last-champion'
  const label = isLastChampion ? 'Último campeón' : 'Próximo Premier'
  const tierText = tierShortLabel(t.level)

  return (
    <Link
      href={`/tournaments/${t.id}`}
      style={{
        display: 'block',
        padding: '16px 16px 18px',
        position: 'relative',
        cursor: 'pointer',
        textDecoration: 'none',
        color: 'inherit',
        borderTop: showDivider ? `1px solid ${BORDER}` : 'none',
      }}
    >
      {/* Tap-affordance arrow */}
      <span
        style={{
          position: 'absolute',
          top: '50%',
          right: 14,
          transform: 'translateY(-50%)',
          color: MUTED,
          fontSize: 16,
          opacity: 0.6,
        }}
      >
        →
      </span>

      {/* Label + tier badge row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 10,
          paddingRight: 24,
        }}
      >
        <span
          style={{
            fontSize: 10,
            color: MUTED,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            fontWeight: 700,
          }}
        >
          {label}
        </span>
        <TierPill level={t.level} text={tierText} />
      </div>

      {/* Big tournament name */}
      <div
        style={{
          fontSize: 22,
          fontWeight: 800,
          letterSpacing: '-0.025em',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 12,
          paddingRight: 24,
          lineHeight: 1.1,
          color: '#fff',
        }}
      >
        <FlagImage country={t.country} size={24} />
        {titleCase(t.name)}
      </div>

      {/* Stat row — champion lines (último) or countdown (próximo) */}
      {isLastChampion && t.champions && t.champions.length > 0 && (
        <ChampionsList champions={t.champions} />
      )}
      {!isLastChampion && t.daysUntilStart != null && (
        <CountdownBig days={t.daysUntilStart} />
      )}

      {/* Date meta */}
      <div
        style={{
          fontSize: 11,
          color: '#B5B5B5',
          paddingTop: 10,
          borderTop: `1px solid ${BORDER}`,
          marginTop: 4,
        }}
      >
        <strong style={{ color: '#fff', fontWeight: 700 }}>
          {formatDateRangeShort(t.starts_at, t.ends_at)}
        </strong>
        {isLastChampion ? (
          <>
            <Sep /> {timeAgoShort(t.ends_at)}
          </>
        ) : (
          t.location && (
            <>
              <Sep /> {t.location}
            </>
          )
        )}
      </div>
    </Link>
  )
}

// ── Tier pill ──────────────────────────────────────────────────────

function TierPill({ level, text }: { level: string | null; text: string }) {
  const isPremier = level
    ? ['major', 'p1', 'p2', 'finals'].includes(level)
    : false
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono, "SF Mono", monospace)',
        fontSize: 9,
        fontWeight: 800,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        padding: '3px 8px',
        background: 'rgba(255,255,255,0.04)',
        border: `1px solid ${isPremier ? 'rgba(126,211,33,0.5)' : BORDER}`,
        color: isPremier ? GREEN : MUTED,
        clipPath: CHUNKY.badge,
      }}
    >
      {text}
    </span>
  )
}

// ── Champions list (último campeón section) ────────────────────────

function ChampionsList({ champions }: { champions: ChampionPair[] }) {
  // Show top 2: gold + silver (one of each, picking men by default if
  // the tournament has both genders — Phase 2 can show both genders side
  // by side if useful).
  const gold = champions.find((c) => c.rank === 1)
  const silver = champions.find((c) => c.rank === 2)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        marginBottom: 12,
      }}
    >
      {gold && (
        <div
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            letterSpacing: '-0.01em',
          }}
        >
          <span style={{ fontSize: 16 }}>🥇</span>
          {gold.player1Name} / {gold.player2Name}
        </div>
      )}
      {silver && (
        <div
          style={{
            fontSize: 12,
            color: MUTED,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            letterSpacing: '-0.005em',
          }}
        >
          <span style={{ fontSize: 13, opacity: 0.8 }}>🥈</span>
          {silver.player1Name} / {silver.player2Name}
        </div>
      )}
    </div>
  )
}

// ── Big countdown (próximo Premier section) ────────────────────────

function CountdownBig({ days }: { days: number }) {
  return (
    <div
      style={{
        fontSize: 28,
        fontWeight: 800,
        color: ORANGE,
        letterSpacing: '-0.02em',
        lineHeight: 1,
        marginBottom: 12,
        fontFamily: 'var(--font-mono, "SF Mono", monospace)',
      }}
    >
      {days}
      <span
        style={{
          fontSize: 13,
          color: MUTED,
          marginLeft: 6,
          letterSpacing: '0.04em',
          fontWeight: 700,
          textTransform: 'uppercase',
        }}
      >
        {days === 1 ? 'día' : 'días'}
      </span>
    </div>
  )
}

// ── Tiny formatters ────────────────────────────────────────────────

function Sep() {
  return <span style={{ color: MUTED, margin: '0 6px' }}>·</span>
}

function formatDateRangeShort(startsAt: string, endsAt: string): string {
  const monthsEs = [
    'ene', 'feb', 'mar', 'abr', 'may', 'jun',
    'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
  ]
  const s = new Date(startsAt)
  const e = new Date(endsAt)
  const sm = monthsEs[s.getUTCMonth()]
  const em = monthsEs[e.getUTCMonth()]
  const sd = s.getUTCDate()
  const ed = e.getUTCDate()
  if (sm === em) return `${sd} — ${ed} ${sm}`
  return `${sd} ${sm} — ${ed} ${em}`
}

function timeAgoShort(endsAt: string): string {
  const days = Math.floor(
    (Date.now() - new Date(endsAt).getTime()) / (24 * 60 * 60 * 1000),
  )
  if (days <= 0) return 'recién'
  if (days === 1) return 'hace 1 día'
  if (days < 30) return `hace ${days} días`
  const months = Math.floor(days / 30)
  return months === 1 ? 'hace 1 mes' : `hace ${months} meses`
}

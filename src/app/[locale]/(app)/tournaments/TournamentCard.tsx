'use client'

// Card variants for the /tournaments timeline.
//
//   live-hero      — top live tournament, full info + extras strip
//   live-compact   — additional live tournaments under the hero
//   upcoming       — orange "EN N DÍAS" pill + countdown
//   completed      — grey pill + champion lines (🥇 + 🥈 if present)
//
// Premier-tier rows get a 3px lime left border so they read as
// headliners in a mixed list. FIP rows stay flat.

import { Link } from '@/i18n/navigation'
import { useFormatter } from 'next-intl'
import { FlagImage } from '@/components/FlagImage'
import {
  GREEN, ORANGE, LIVE_RED, BG_CARD, MUTED, BORDER, CHUNKY,
  titleCase, formatDateRange,
} from '@/components/home/shared'
import { tierShortLabel, type TournamentSummary, type ChampionPair } from './types'

type Variant = 'live-hero' | 'live-compact' | 'upcoming' | 'completed'

function pickVariant(t: TournamentSummary, isHero: boolean): Variant {
  if (t.status === 'live') return isHero ? 'live-hero' : 'live-compact'
  if (t.status === 'upcoming') return 'upcoming'
  return 'completed'
}

interface TournamentCardProps {
  tournament: TournamentSummary
  /** When true on a live tournament, render the rich hero variant. */
  isHero?: boolean
}

export default function TournamentCard({
  tournament: t,
  isHero = false,
}: TournamentCardProps) {
  const format = useFormatter()
  const variant = pickVariant(t, isHero)
  const isPremier = t.tierBucket === 'premier'
  const tierText = tierShortLabel(t.level)

  const baseStyle: React.CSSProperties = {
    margin: '0 16px 10px',
    background: BG_CARD,
    border: `1px solid ${BORDER}`,
    clipPath: CHUNKY.card,
    padding: '13px 16px',
    cursor: 'pointer',
    position: 'relative',
    textDecoration: 'none',
    color: 'inherit',
    display: 'block',
  }
  if (variant === 'live-hero') {
    baseStyle.background = `linear-gradient(180deg, ${BG_CARD} 0%, rgba(255,70,85,0.04) 100%)`
    baseStyle.borderLeft = `3px solid ${LIVE_RED}`
    baseStyle.padding = '14px 16px'
  } else if (variant === 'live-compact') {
    baseStyle.borderLeft = `3px solid ${LIVE_RED}`
  } else if (isPremier) {
    baseStyle.borderLeft = `3px solid ${GREEN}`
  }

  return (
    <Link href={`/tournaments/${t.id}`} style={baseStyle}>
      <StatusRow t={t} variant={variant} />
      <TierBadge level={t.level} text={tierText} />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: variant === 'live-hero' ? 17 : variant === 'live-compact' ? 14 : 16,
          fontWeight: 800,
          letterSpacing: '-0.015em',
          marginBottom: variant === 'live-compact' ? 2 : 4,
          paddingRight: 70, // breathe past tier badge
          color: '#fff',
        }}
      >
        <FlagImage country={t.country} size={20} />
        {titleCase(t.name)}
      </div>
      <Meta t={t} variant={variant} format={format} />
      {variant === 'live-hero' && <HeroExtras />}
      {variant === 'completed' && t.champions && t.champions.length > 0 && (
        <Champions champions={t.champions} />
      )}
    </Link>
  )
}

// ── Status pill ────────────────────────────────────────────────────

function StatusRow({
  t,
  variant,
}: {
  t: TournamentSummary
  variant: Variant
}) {
  const pillBase: React.CSSProperties = {
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    padding: '2px 8px',
    clipPath: CHUNKY.badge,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
  }

  let pill: React.ReactNode = null
  if (variant === 'live-hero' || variant === 'live-compact') {
    pill = (
      <span style={{ ...pillBase, background: LIVE_RED, color: '#fff' }}>
        <span
          style={{
            width: 6,
            height: 6,
            background: '#fff',
            borderRadius: '50%',
            display: 'inline-block',
            animation: 'pulse-dot 1.4s ease-in-out infinite',
          }}
        />
        En vivo
      </span>
    )
  } else if (variant === 'upcoming') {
    const days = t.daysUntilStart ?? 0
    pill = (
      <span
        style={{
          ...pillBase,
          background: 'rgba(245,166,35,0.15)',
          color: ORANGE,
        }}
      >
        En {days === 1 ? '1 día' : `${days} días`}
      </span>
    )
  } else {
    // completed
    pill = (
      <span
        style={{
          ...pillBase,
          background: 'rgba(255,255,255,0.04)',
          color: MUTED,
          border: `1px solid ${BORDER}`,
        }}
      >
        Completado
      </span>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      {pill}
      <style>{`@keyframes pulse-dot {0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
    </div>
  )
}

// ── Tier badge ─────────────────────────────────────────────────────

function TierBadge({
  level,
  text,
}: {
  level: string | null
  text: string
}) {
  if (!level) return null
  const isPremier = ['major', 'p1', 'p2', 'finals'].includes(level)
  return (
    <span
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        fontFamily: 'var(--font-mono, "SF Mono", monospace)',
        fontSize: 9,
        fontWeight: 800,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        padding: '3px 7px',
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

// ── Meta (date / location / day-of-X for live) ─────────────────────

function Meta({
  t,
  variant,
  format,
}: {
  t: TournamentSummary
  variant: Variant
  format: ReturnType<typeof useFormatter>
}) {
  const dateRange = formatDateRange(format, t.starts_at, t.ends_at)
  const sep = (
    <span style={{ color: MUTED, margin: '0 5px' }}>·</span>
  )
  return (
    <div style={{ fontSize: 11, color: '#B5B5B5' }}>
      {dateRange}
      {t.location && (
        <>
          {sep}
          {t.location}
        </>
      )}
      {variant === 'live-hero' && (
        <>
          {sep}
          <span style={{ color: LIVE_RED, fontWeight: 700 }}>en juego</span>
        </>
      )}
    </div>
  )
}

// ── Hero extras (placeholder; Phase 2 will wire match counts) ──────

function HeroExtras() {
  // Phase 2 will populate this from a per-tournament live match count
  // query. For Phase 1 we leave the strip empty so the card height stays
  // consistent without showing fake numbers.
  return null
}

// ── Champions list (completed cards) ───────────────────────────────

function Champions({ champions }: { champions: ChampionPair[] }) {
  // Sort: gold first, then silver. Within rank, men first then women
  // (alphabetical fallback). Stable, no-op for single-category fixtures.
  const sorted = [...champions].sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank
    if (a.category !== b.category) return a.category.localeCompare(b.category)
    return 0
  })

  return (
    <div
      style={{
        marginTop: 10,
        paddingTop: 10,
        borderTop: `1px solid ${BORDER}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        fontSize: 11,
      }}
    >
      {sorted.map((c, i) => (
        <div
          key={`${c.category}-${c.rank}-${i}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            color: c.rank === 1 ? '#fff' : MUTED,
            fontWeight: c.rank === 1 ? 600 : 400,
          }}
        >
          <span style={{ fontSize: 12 }}>{c.rank === 1 ? '🥇' : '🥈'}</span>
          <span>
            {c.player1Name} / {c.player2Name}
            {champions.length > 1 && (
              <span style={{ color: MUTED, marginLeft: 6, fontSize: 10 }}>
                ({c.category === 'men' ? 'M' : 'W'})
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  )
}

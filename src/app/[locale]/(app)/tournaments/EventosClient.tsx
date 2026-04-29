'use client'

// Client-side wrapper for /tournaments. Owns tier-filter state (read
// from URL searchParams via TierChips), filters the tournament list
// accordingly, and composes the page sections.
//
// Server component (page.tsx) does the data fetching and passes the
// full set down here once. We don't refetch on chip change — filtering
// is pure JS over the in-memory list.

import { useMemo } from 'react'
import { Link } from '@/i18n/navigation'
import { useSearchParams } from 'next/navigation'
import { BG_BASE, BORDER, GREEN, MUTED } from '@/components/home/shared'
import PremierSpotlight from './PremierSpotlight'
import TierChips from './TierChips'
import EventTimeline from './EventTimeline'
import type {
  EventosPageData,
  TournamentSummary,
  TierBucket,
} from './types'

interface EventosClientProps {
  data: EventosPageData
}

const VALID_TIERS: TierBucket[] = [
  'all',
  'premier',
  'fip_top',
  'fip_mid',
  'fip_base',
  'following',
]

export default function EventosClient({ data }: EventosClientProps) {
  const searchParams = useSearchParams()
  const rawTier = searchParams.get('tier') ?? 'all'
  const activeBucket: TierBucket = (VALID_TIERS as string[]).includes(rawTier)
    ? (rawTier as TierBucket)
    : 'all'

  // Filter tournaments by the active chip. Spotlight stays untouched —
  // it's always Premier-first and shouldn't disappear when the user
  // narrows to FIP.
  const filtered: TournamentSummary[] = useMemo(() => {
    if (activeBucket === 'all') return data.tournaments
    if (activeBucket === 'following') {
      // Phase 2: read followed tournament IDs from localStorage and
      // filter by them. For now treat as "all" — the chip itself isn't
      // rendered in TierChips yet, so this branch only fires if someone
      // hits ?tier=following manually.
      return data.tournaments
    }
    return data.tournaments.filter((t) => t.tierBucket === activeBucket)
  }, [data.tournaments, activeBucket])

  const totalForChip = filtered.length

  return (
    <div
      style={{
        maxWidth: 500,
        margin: '0 auto',
        background: BG_BASE,
        minHeight: '100vh',
      }}
    >
      <Header year={data.year} />
      <PremierSpotlight data={data.spotlight} />
      <TierChips activeBucket={activeBucket} />
      <FiltersBar count={totalForChip} year={data.year} />

      <EventTimeline tournaments={filtered} />

      <ArchiveFooter
        archiveYears={data.archiveYears}
        currentYear={data.year}
      />
    </div>
  )
}

// ── Header ─────────────────────────────────────────────────────────

function Header({ year }: { year: number }) {
  // Short year suffix to match the mockup ("Eventos '26"). Survives the
  // year boundary fine because the data layer derives `year` from now().
  const yearShort = `'${String(year).slice(-2)}`
  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 5,
        background: BG_BASE,
        borderBottom: `1px solid ${BORDER}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 16px 12px',
      }}
    >
      <h1
        style={{
          fontSize: 18,
          fontWeight: 800,
          letterSpacing: '-0.02em',
          color: '#fff',
          margin: 0,
        }}
      >
        Eventos
        <span
          style={{
            fontFamily: 'var(--font-mono, "SF Mono", monospace)',
            fontWeight: 700,
            color: GREEN,
            marginLeft: 6,
            fontSize: 14,
            letterSpacing: '0.04em',
          }}
        >
          {yearShort}
        </span>
      </h1>
    </header>
  )
}

// ── Filters bar (Phase 1: button is a placeholder; sheet wires up Phase 2) ──

function FiltersBar({ count, year }: { count: number; year: number }) {
  return (
    <div
      style={{
        padding: '8px 16px 12px',
        background: BG_BASE,
        borderBottom: `1px solid ${BORDER}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
      }}
    >
      {/* Phase 2: open the filters bottom sheet here. For now this
          renders disabled-looking so the affordance is visible without
          inviting taps. */}
      <button
        type="button"
        disabled
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '7px 14px',
          background: '#141414',
          border: `1px solid ${BORDER}`,
          color: MUTED,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.02em',
          borderRadius: 8,
          cursor: 'not-allowed',
          opacity: 0.6,
          fontFamily: 'inherit',
        }}
        title="Próximamente — más filtros (país, fechas, categoría)"
      >
        <span style={{ fontSize: 13 }}>⚙</span>
        Filtros
      </button>
      <span
        style={{
          fontFamily: 'var(--font-mono, "SF Mono", monospace)',
          fontSize: 10,
          color: MUTED,
          letterSpacing: '0.05em',
        }}
      >
        {count} {count === 1 ? 'evento' : 'eventos'} en {year}
      </span>
    </div>
  )
}

// ── Archive footer ─────────────────────────────────────────────────

function ArchiveFooter({
  archiveYears,
  currentYear,
}: {
  archiveYears: Array<{ year: number; count: number }>
  currentYear: number
}) {
  if (archiveYears.length === 0) return null

  return (
    <div
      style={{
        padding: '18px 16px 100px',
        borderTop: `1px solid ${BORDER}`,
        marginTop: 18,
        background: 'linear-gradient(180deg, transparent, rgba(126,211,33,0.02))',
      }}
    >
      <div style={{ padding: '0 0 12px' }}>
        <h2
          style={{
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            margin: 0,
          }}
        >
          <span
            style={{
              width: 18,
              height: 2,
              background: GREEN,
              display: 'inline-block',
            }}
          />
          Archivo
        </h2>
      </div>
      {archiveYears.map(({ year, count }) => (
        <Link
          key={year}
          href={`/tournaments?year=${year}` as `/tournaments`}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '13px 12px',
            background: '#141414',
            border: `1px solid ${BORDER}`,
            marginBottom: 8,
            cursor: 'pointer',
            color: 'inherit',
            textDecoration: 'none',
            // Block visited state from greying the row out.
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 30,
                height: 30,
                background: '#1F1F1F',
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 14,
              }}
            >
              📅
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>
                Temporada {year}
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-mono, "SF Mono", monospace)',
                  fontSize: 10,
                  color: MUTED,
                  marginTop: 2,
                  letterSpacing: '0.04em',
                }}
              >
                {count.toString().toUpperCase()} EVENTOS
              </div>
            </div>
          </div>
          <span style={{ color: GREEN, fontSize: 16 }}>→</span>
        </Link>
      ))}
    </div>
  )
}

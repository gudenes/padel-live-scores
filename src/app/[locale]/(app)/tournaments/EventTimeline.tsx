'use client'

// Sectioned timeline for /tournaments.
//
// Three top-level sections in order:
//   - EN VIVO        (rendered as 1 hero + N compact cards)
//   - PRÓXIMAS       (today divider, then month groupings)
//   - COMPLETADAS    (current month expanded, older months collapsed)
//
// All visual treatment lives in TournamentCard. This file just owns
// the section layout + month grouping logic.

import { useState } from 'react'
import { GREEN, BG_BASE, MUTED, BORDER } from '@/components/home/shared'
import TournamentCard from './TournamentCard'
import type { TournamentSummary } from './types'

interface EventTimelineProps {
  tournaments: TournamentSummary[]
}

const MONTHS_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

function monthKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function monthLabel(iso: string): string {
  const d = new Date(iso)
  return MONTHS_ES[d.getUTCMonth()]
}

function todayLabelSpanish(): string {
  const d = new Date()
  const day = d.getDate()
  const month = MONTHS_ES[d.getMonth()]
  return `Hoy · ${day} ${month}`
}

export default function EventTimeline({ tournaments }: EventTimelineProps) {
  const live = tournaments.filter((t) => t.status === 'live')
  const upcoming = tournaments
    .filter((t) => t.status === 'upcoming')
    .sort(
      (a, b) =>
        new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
    )
  const completed = tournaments
    .filter((t) => t.status === 'completed')
    .sort(
      (a, b) =>
        new Date(b.ends_at).getTime() - new Date(a.ends_at).getTime(),
    )

  return (
    <>
      <LiveSection live={live} />
      <UpcomingSection upcoming={upcoming} />
      <CompletedSection completed={completed} />
    </>
  )
}

// ── EN VIVO ────────────────────────────────────────────────────────

function LiveSection({ live }: { live: TournamentSummary[] }) {
  const [expanded, setExpanded] = useState(false)

  if (live.length === 0) {
    return (
      <>
        <SectionHeader title="En vivo" count="sin eventos" />
        <EmptyHint>No hay torneos en juego ahora mismo.</EmptyHint>
      </>
    )
  }

  // Pick the highest-tier live tournament as the hero. Order: premier
  // → fip_top → fip_mid → fip_base. Within tier, latest started wins.
  const tierRank = (b: TournamentSummary['tierBucket']): number =>
    b === 'premier' ? 0 : b === 'fip_top' ? 1 : b === 'fip_mid' ? 2 : 3
  const sorted = [...live].sort((a, b) => {
    const r = tierRank(a.tierBucket) - tierRank(b.tierBucket)
    if (r !== 0) return r
    return new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime()
  })
  const [hero, ...rest] = sorted

  // Show first 2 compact cards by default; fold the rest behind a "ver más".
  const VISIBLE_REST = 2
  const visible = expanded ? rest : rest.slice(0, VISIBLE_REST)
  const hidden = rest.length - visible.length

  return (
    <>
      <SectionHeader
        title="En vivo"
        count={`${live.length} ${live.length === 1 ? 'evento' : 'eventos'}`}
      />
      <TournamentCard tournament={hero} isHero />
      {visible.map((t) => (
        <TournamentCard key={t.id} tournament={t} />
      ))}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          style={{
            margin: '4px 16px 0',
            padding: '9px 14px',
            background: 'transparent',
            border: `1px dashed ${BORDER}`,
            color: '#B5B5B5',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.04em',
            textAlign: 'center',
            cursor: 'pointer',
            borderRadius: 8,
            width: 'calc(100% - 32px)',
            fontFamily: 'inherit',
          }}
        >
          ▾ Ver {hidden} {hidden === 1 ? 'evento' : 'eventos'} más en vivo
        </button>
      )}
    </>
  )
}

// ── PRÓXIMAS ───────────────────────────────────────────────────────

function UpcomingSection({ upcoming }: { upcoming: TournamentSummary[] }) {
  if (upcoming.length === 0) {
    return (
      <>
        <SectionHeader title="Próximas" count="sin eventos próximos" />
        <EmptyHint>No hay próximos torneos en este filtro.</EmptyHint>
      </>
    )
  }

  return (
    <>
      <SectionHeader
        title="Próximas"
        count={`${upcoming.length} ${upcoming.length === 1 ? 'evento' : 'eventos'}`}
      />
      <TodayLine />
      <MonthGroups
        items={upcoming}
        getDate={(t) => t.starts_at}
        // Future months: keep first one expanded by default; collapse later ones.
        defaultExpandedFirst={true}
      />
    </>
  )
}

// ── COMPLETADAS ────────────────────────────────────────────────────

function CompletedSection({ completed }: { completed: TournamentSummary[] }) {
  if (completed.length === 0) {
    return (
      <>
        <SectionHeader title="Completadas" count="ninguna en este año" />
        <EmptyHint>Aún no hay torneos completados en este filtro.</EmptyHint>
      </>
    )
  }

  return (
    <>
      <SectionHeader
        title="Completadas"
        count={`${completed.length} ${completed.length === 1 ? 'evento' : 'eventos'}`}
      />
      <MonthGroups
        items={completed}
        getDate={(t) => t.ends_at}
        // For completed: most recent month expanded; older collapsed.
        defaultExpandedFirst={true}
      />
    </>
  )
}

// ── Section header ─────────────────────────────────────────────────

function SectionHeader({
  title,
  count,
}: {
  title: string
  count: string
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '22px 16px 10px',
      }}
    >
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
        {title}
      </h2>
      <span
        style={{
          fontFamily: 'var(--font-mono, "SF Mono", monospace)',
          fontSize: 10,
          color: MUTED,
          letterSpacing: '0.06em',
        }}
      >
        {count}
      </span>
    </div>
  )
}

// ── Today divider ──────────────────────────────────────────────────

function TodayLine() {
  return (
    <div
      style={{
        margin: '18px 16px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <div
        style={{
          flex: 1,
          height: 1,
          background: `linear-gradient(90deg, transparent, ${GREEN}, transparent)`,
        }}
      />
      <span
        style={{
          fontFamily: 'var(--font-mono, "SF Mono", monospace)',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.18em',
          color: GREEN,
          textTransform: 'uppercase',
        }}
      >
        {todayLabelSpanish()}
      </span>
      <div
        style={{
          flex: 1,
          height: 1,
          background: `linear-gradient(90deg, transparent, ${GREEN}, transparent)`,
        }}
      />
    </div>
  )
}

// ── Month groups ───────────────────────────────────────────────────

interface MonthGroupsProps {
  items: TournamentSummary[]
  getDate: (t: TournamentSummary) => string
  defaultExpandedFirst: boolean
}

function MonthGroups({
  items,
  getDate,
  defaultExpandedFirst,
}: MonthGroupsProps) {
  // Group preserving the input order — caller has already sorted.
  const groups = new Map<string, TournamentSummary[]>()
  for (const t of items) {
    const k = monthKey(getDate(t))
    const arr = groups.get(k) ?? []
    arr.push(t)
    groups.set(k, arr)
  }
  const orderedKeys = Array.from(groups.keys())

  // Initial expanded state — only the first group, others collapsed.
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => {
    const s = new Set<string>()
    if (defaultExpandedFirst && orderedKeys.length > 0) s.add(orderedKeys[0])
    return s
  })

  const toggle = (k: string) =>
    setOpenKeys((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })

  return (
    <>
      {orderedKeys.map((k) => {
        const rows = groups.get(k)!
        const open = openKeys.has(k)
        const label = monthLabel(rows[0]!.starts_at).toUpperCase()
        return (
          <div key={k}>
            <button
              type="button"
              onClick={() => toggle(k)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: open ? '14px 16px 6px' : '16px 16px',
                width: '100%',
                background: 'transparent',
                border: 'none',
                borderTop: open ? 'none' : `1px solid ${BORDER}`,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 800,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: '#B5B5B5',
                }}
              >
                {label}
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-mono, "SF Mono", monospace)',
                  fontSize: 10,
                  color: MUTED,
                  letterSpacing: '0.06em',
                }}
              >
                {!open && `${rows.length} ${rows.length === 1 ? 'evento' : 'eventos'} · `}
                {open ? '▾' : '▸'}
              </span>
            </button>
            {open && rows.map((t) => <TournamentCard key={t.id} tournament={t} />)}
          </div>
        )
      })}
    </>
  )
}

// ── Empty hint ─────────────────────────────────────────────────────

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        margin: '0 16px 8px',
        padding: '18px 16px',
        border: `1px dashed ${BORDER}`,
        borderRadius: 10,
        textAlign: 'center',
        color: MUTED,
        fontSize: 12,
      }}
    >
      {children}
    </div>
  )
}

'use client'
// src/app/ops/tournament/CalendarView.tsx
//
// Horizontal timeline / Gantt-style calendar for the Tournament Explorer.
// Each tournament renders as a colored bar from `starts_at` to `ends_at`,
// stacked into lanes so overlapping events stay readable. Level dictates
// the bar color. Click a bar to drill into the tournament.
//
// Layout strategy:
//   - X-axis is days inside the filter window (from..to, inclusive)
//   - Y-axis is "lanes" — overlapping tournaments get pushed to the next
//     free lane via a sweep-line algorithm
//   - Month headers + a vertical "today" line for orientation
//   - One pixel per day at minimum, scales up with available width
//
// Why a fixed pixel-per-day approach instead of CSS grid: tournaments
// don't align to week boundaries, and we need sub-day positioning when
// the same week has multiple events with different start days. Absolute
// positioning gives precise control without a dependency on a calendar lib.

import { useMemo, useState } from 'react'
import { TIER_COLOR, DEFAULT_TIER_COLOR } from '@/lib/tier-colors'

interface TournamentLite {
  id: string
  name: string
  starts_at: string | null
  ends_at: string | null
  level: string | null
  country: string | null
  fip_id: string | null
  prize_money: string | null
  prize_money_fip: number | null
  draw_size_md: number | null
  draw_size_qd: number | null
  matchCount: number
  finalPlayed: boolean
  entryListCapturedAt: string | null
  oopCapturedAt: string | null
  resultsCapturedAt: string | null
  drawCapturedAt: string | null
}

interface CalendarViewProps {
  tournaments: TournamentLite[]
  fromDate: string  // YYYY-MM-DD inclusive
  toDate: string    // YYYY-MM-DD inclusive
  onSelect: (id: string) => void
}

// ── Level colors ─────────────────────────────────────────────────────────
// Imported from shared lib — see apps/ops/src/lib/tier-colors.ts

// ── Date helpers ─────────────────────────────────────────────────────────

function parseISODate(iso: string): Date {
  // Treat as UTC midnight so day arithmetic stays predictable across timezones.
  return new Date(iso + 'T00:00:00.000Z')
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function diffDays(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000))
}

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// ── Lane assignment ─────────────────────────────────────────────────────
// Greedy sweep — tournaments are pre-sorted by start date. We try the
// lowest-numbered lane that doesn't conflict (doesn't already hold a
// tournament whose end > current start). When all current lanes conflict,
// open a new one. This produces a tight stack with no wasted vertical
// space, which matches operator intent ("see as many as possible at once").

interface LaneAssignment {
  laneIndex: number
  startDay: number
  endDay: number
  tournament: TournamentLite
}

function assignLanes(
  tournaments: TournamentLite[],
  windowStart: Date,
): LaneAssignment[] {
  const laneEnds: number[] = [] // last day occupied per lane
  const out: LaneAssignment[] = []

  for (const t of tournaments) {
    if (!t.starts_at) continue
    const s = parseISODate(t.starts_at.slice(0, 10))
    const e = t.ends_at ? parseISODate(t.ends_at.slice(0, 10)) : s
    const startDay = diffDays(s, windowStart)
    const endDay = diffDays(e, windowStart)

    let lane = laneEnds.findIndex(end => end < startDay)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(endDay)
    } else {
      laneEnds[lane] = endDay
    }
    out.push({ laneIndex: lane, startDay, endDay, tournament: t })
  }

  return out
}

// ── Component ───────────────────────────────────────────────────────────

// Bigger cards for readability — the previous 8px/day made tournament
// names truncate to 2-3 chars on most events. 16px/day fits ~10 chars
// for a 7-day event, enough to read most tournament names without
// hovering. Lane height bumped so we can show 2 rows: name + meta.
const PIXELS_PER_DAY = 16
const LANE_HEIGHT = 38
const LANE_GAP = 5
const HEADER_HEIGHT = 50

export default function CalendarView({ tournaments, fromDate, toDate, onSelect }: CalendarViewProps) {
  // Hover state for the rich tooltip — { tournament, x, y } or null.
  // We track viewport coordinates so the tooltip can be positioned in a
  // fixed overlay instead of inside the scrollable timeline (avoids
  // clipping at the chart edges).
  const [hovered, setHovered] = useState<{ t: TournamentLite; x: number; y: number } | null>(null)

  const windowStart = parseISODate(fromDate)
  const windowEnd = parseISODate(toDate)
  const totalDays = diffDays(windowEnd, windowStart) + 1

  // Sort by start date so lane assignment is deterministic
  const sorted = useMemo(
    () => [...tournaments]
      .filter(t => t.starts_at)
      .sort((a, b) => (a.starts_at ?? '').localeCompare(b.starts_at ?? '')),
    [tournaments],
  )

  const assignments = useMemo(() => assignLanes(sorted, windowStart), [sorted, windowStart])
  const laneCount = assignments.reduce((max, a) => Math.max(max, a.laneIndex + 1), 0)

  // Build month header bands — each starts on the 1st of a month and
  // spans until the next month's start (or window end).
  const monthBands = useMemo(() => {
    const bands: { left: number; width: number; label: string }[] = []
    let cursor = startOfMonth(windowStart)
    if (cursor < windowStart) {
      // Window starts mid-month — first band runs from windowStart to month end
      cursor = startOfDay(windowStart)
    }
    while (cursor <= windowEnd) {
      const monthStart = cursor
      const nextMonth = startOfMonth(addDays(monthStart, 32)) // jump well into next month
      const bandEnd = nextMonth > windowEnd ? windowEnd : addDays(nextMonth, -1)
      const startDay = Math.max(0, diffDays(monthStart, windowStart))
      const endDay = diffDays(bandEnd, windowStart)
      bands.push({
        left: startDay * PIXELS_PER_DAY,
        width: (endDay - startDay + 1) * PIXELS_PER_DAY,
        label: `${MONTH_NAMES[monthStart.getUTCMonth()]} ${monthStart.getUTCFullYear()}`,
      })
      cursor = nextMonth
    }
    return bands
  }, [windowStart, windowEnd])

  // Today marker — only render if today is inside the window
  const today = startOfDay(new Date())
  const todayDay = diffDays(today, windowStart)
  const todayInWindow = todayDay >= 0 && todayDay <= totalDays - 1

  const totalWidth = totalDays * PIXELS_PER_DAY
  const totalHeight = HEADER_HEIGHT + laneCount * (LANE_HEIGHT + LANE_GAP) + 12

  if (assignments.length === 0) {
    return (
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 'var(--r-lg)',
        padding: 32, color: 'var(--text-3)', fontSize: 12, textAlign: 'center',
      }}>
        No tournaments in this window. Try widening the date range.
      </div>
    )
  }

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border-card)',
      borderRadius: 'var(--r-lg)',
      overflow: 'auto',
      // Bound height so a many-laned month doesn't push the page
      maxHeight: 600,
    }}>
      <div style={{ position: 'relative', width: totalWidth, height: totalHeight }}>
        {/* Month header band */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 2,
          height: HEADER_HEIGHT, background: 'var(--bg-card-2)',
          borderBottom: '1px solid var(--border-card)',
        }}>
          {monthBands.map((band, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: band.left,
                width: band.width,
                top: 0,
                height: HEADER_HEIGHT,
                borderRight: '1px solid var(--border-card)',
                padding: '6px 8px',
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--text-2)',
                letterSpacing: '0.4px',
                textTransform: 'uppercase',
                background: i % 2 === 0 ? 'var(--bg-card-2)' : 'var(--bg-hover)',
              }}
            >
              {band.label}
            </div>
          ))}
        </div>

        {/* Month grid lines (vertical, light) */}
        {monthBands.map((band, i) => (
          <div
            key={`grid-${i}`}
            style={{
              position: 'absolute',
              left: band.left + band.width,
              top: HEADER_HEIGHT,
              bottom: 0,
              width: 1,
              background: 'var(--border-inner)',
              pointerEvents: 'none',
            }}
          />
        ))}

        {/* Today marker */}
        {todayInWindow && (
          <>
            <div
              style={{
                position: 'absolute',
                left: todayDay * PIXELS_PER_DAY,
                top: 0,
                bottom: 0,
                width: 2,
                background: 'var(--live)',
                pointerEvents: 'none',
                zIndex: 1,
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: todayDay * PIXELS_PER_DAY - 14,
                top: HEADER_HEIGHT - 16,
                fontSize: 9,
                fontWeight: 800,
                color: 'var(--live)',
                background: 'var(--bg-card)',
                padding: '1px 4px',
                borderRadius: 'var(--r-xs)',
                letterSpacing: '0.4px',
                zIndex: 3,
              }}
            >
              TODAY
            </div>
          </>
        )}

        {/* Tournament bars */}
        {assignments.map(a => {
          const color = TIER_COLOR[a.tournament.level ?? ''] ?? DEFAULT_TIER_COLOR
          const top = HEADER_HEIGHT + 6 + a.laneIndex * (LANE_HEIGHT + LANE_GAP)
          const left = a.startDay * PIXELS_PER_DAY
          const width = Math.max(PIXELS_PER_DAY, (a.endDay - a.startDay + 1) * PIXELS_PER_DAY - 1)
          const isHovered = hovered?.t.id === a.tournament.id

          // ── Operator visual signals ────────────────────────────────
          //
          // 1. PAST events get dimmed — they're context, not action items.
          //    "Past" = either calendar end is in the past, OR the final
          //    has been played (the event is de-facto over even if
          //    `ends_at` hasn't arrived).
          // 2. NEEDS ATTENTION — about to start (within 7 days), has
          //    fip_id so we expect data, but no entry list captured yet.
          //    Skipped when the final is already played — there's no
          //    operator action to take on a finished event.
          const isPast = a.endDay < todayDay || a.tournament.finalPlayed
          const needsAttention =
            !!a.tournament.fip_id
            && !a.tournament.entryListCapturedAt
            && a.startDay <= todayDay + 7  // imminent (within 7 days)
            && a.endDay >= todayDay        // calendar window still active
            && !a.tournament.finalPlayed   // and final hasn't dropped

          return (
            <button
              key={a.tournament.id}
              onClick={() => onSelect(a.tournament.id)}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                setHovered({ t: a.tournament, x: rect.left + rect.width / 2, y: rect.top })
              }}
              onMouseLeave={() => setHovered(prev => (prev?.t.id === a.tournament.id ? null : prev))}
              style={{
                position: 'absolute',
                top,
                left,
                width,
                height: LANE_HEIGHT,
                background: color.bg,
                border: needsAttention ? '2px solid var(--live)' : `1px solid ${color.border}`,
                borderRadius: 5,
                color: color.text,
                fontSize: 11,
                fontWeight: 600,
                padding: '5px 8px',
                textAlign: 'left',
                cursor: 'pointer',
                zIndex: isHovered ? 4 : (needsAttention ? 2 : 1),
                fontFamily: 'inherit',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                gap: 1,
                overflow: 'hidden',
                opacity: isPast ? 0.45 : 1,
                boxShadow: isHovered
                  ? 'var(--shadow-md)'
                  : (needsAttention ? '0 0 0 2px var(--live-border)' : 'none'),
                transform: isHovered ? 'translateY(-1px)' : 'none',
                transition: 'transform 100ms ease-out, box-shadow 100ms ease-out',
              }}
            >
              <div style={{
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                lineHeight: 1.1,
              }}>
                {a.tournament.name}
              </div>
              <div style={{
                fontSize: 9, opacity: 0.85, fontWeight: 600,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                lineHeight: 1.1,
              }}>
                {a.tournament.matchCount > 0 ? `${a.tournament.matchCount} matches` : 'no matches'}
                {a.tournament.country ? ` · ${a.tournament.country}` : ''}
              </div>
            </button>
          )
        })}
      </div>

      {/* Rich hover tooltip — renders OUTSIDE the scrollable timeline as a
          position:fixed overlay so it's never clipped at the chart edges
          and stays readable while the user moves their pointer along a
          long event. */}
      {hovered && <TournamentHoverCard t={hovered.t} x={hovered.x} y={hovered.y} />}
    </div>
  )
}

// ── Hover card (exported so list-view rows reuse it) ──────────────────

export function TournamentHoverCard({ t, x, y }: { t: TournamentLite; x: number; y: number }) {
  const startEnd = [t.starts_at?.slice(0, 10), t.ends_at?.slice(0, 10)]
    .filter(Boolean).join(' → ')
  const prize = t.prize_money
    || (t.prize_money_fip ? `€${t.prize_money_fip.toLocaleString()}` : null)
  const drawSize = [
    t.draw_size_md ? `MD ${t.draw_size_md}` : null,
    t.draw_size_qd ? `QD ${t.draw_size_qd}` : null,
  ].filter(Boolean).join(' · ')
  const color = TIER_COLOR[t.level ?? ''] ?? DEFAULT_TIER_COLOR

  // Card width is fixed; clamp position so it never spills off-screen.
  const CARD_W = 280
  const left = Math.max(8, Math.min(window.innerWidth - CARD_W - 8, x - CARD_W / 2))
  const top = Math.max(8, y - 200)  // float above the bar; 200 covers card height + gap

  return (
    <div
      style={{
        position: 'fixed',
        left,
        top,
        width: CARD_W,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-card)',
        borderRadius: 'var(--r-lg)',
        boxShadow: 'var(--shadow-lg)',
        padding: '12px 14px',
        fontSize: 11,
        color: 'var(--text-2)',
        zIndex: 1000,
        pointerEvents: 'none',
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        marginBottom: 8, fontSize: 13, fontWeight: 700, color: 'var(--text-1)',
        lineHeight: 1.2,
      }}>
        <span style={{
          width: 8, height: 8, borderRadius: 2, background: color.bg, border: `1px solid ${color.border}`,
          flexShrink: 0,
        }} />
        {t.name}
      </div>

      <Row label="Dates" value={startEnd || '—'} />
      <Row label="Country" value={t.country ?? '—'} />
      <Row label="Matches" value={t.matchCount > 0 ? String(t.matchCount) : 'none yet'} accent={t.matchCount > 0 ? 'var(--lime-text)' : 'var(--live-text)'} />
      {prize && <Row label="Prize" value={prize} />}
      {drawSize && <Row label="Draw size" value={drawSize} />}

      {/* Capture-status mini-row */}
      <div style={{
        display: 'flex', gap: 10, marginTop: 8, paddingTop: 8,
        borderTop: '1px solid var(--border-inner)',
        fontSize: 9, color: 'var(--text-3)',
      }}>
        <CaptureBadge label="EL" present={Boolean(t.entryListCapturedAt)} />
        <CaptureBadge label="OOP" present={Boolean(t.oopCapturedAt)} />
        <CaptureBadge label="DR" present={Boolean(t.drawCapturedAt)} />
        <CaptureBadge label="RS" present={Boolean(t.resultsCapturedAt)} />
      </div>

      <div style={{ marginTop: 8, fontSize: 9, color: 'var(--text-3)', textAlign: 'right', fontStyle: 'italic' }}>
        Click to open
      </div>
    </div>
  )
}

function Row({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 3 }}>
      <span style={{ color: 'var(--text-3)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</span>
      <span style={{ color: accent ?? 'var(--text-1)', fontWeight: 600 }}>{value}</span>
    </div>
  )
}

function CaptureBadge({ label, present }: { label: string; present: boolean }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      color: present ? 'var(--lime-text)' : 'var(--live-text)', fontWeight: 700,
      fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: present ? 'var(--lime)' : 'transparent',
        border: present ? 'none' : '1.2px solid var(--live)',
      }} />
      {label}
    </span>
  )
}

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

import { useMemo } from 'react'

interface TournamentLite {
  id: string
  name: string
  starts_at: string | null
  ends_at: string | null
  level: string | null
  matchCount: number
}

interface CalendarViewProps {
  tournaments: TournamentLite[]
  fromDate: string  // YYYY-MM-DD inclusive
  toDate: string    // YYYY-MM-DD inclusive
  onSelect: (id: string) => void
}

// ── Level colors ─────────────────────────────────────────────────────────
// Premier Padel uses warm/saturated colors so the headline events
// (Major / P1 / P2 / Finals) pop against the FIP tour palette which is
// medal-themed (platinum/gold/silver/bronze). Anything else gets a neutral.

const LEVEL_COLOR: Record<string, { bg: string; border: string; text: string }> = {
  major:       { bg: '#FF4655', border: '#C8313D', text: '#fff' },   // red
  p1:          { bg: '#FF6B2B', border: '#CC5A23', text: '#fff' },   // orange
  p2:          { bg: '#F5A623', border: '#C2841C', text: '#000' },   // amber
  finals:      { bg: '#7C2D8E', border: '#5C2169', text: '#fff' },   // purple
  fip_platinum:{ bg: '#9CA3AF', border: '#6B7280', text: '#000' },   // platinum gray
  fip_gold:    { bg: '#D4AF37', border: '#A88A2B', text: '#000' },   // gold
  fip_silver:  { bg: '#C0C0C0', border: '#919191', text: '#000' },   // silver
  fip_bronze:  { bg: '#CD7F32', border: '#9F6325', text: '#fff' },   // bronze
  fip_other:   { bg: '#94A3B8', border: '#64748B', text: '#fff' },   // slate
}
const DEFAULT_COLOR = { bg: '#E5E7EB', border: '#9CA3AF', text: '#444' }

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

const PIXELS_PER_DAY = 8  // Compact: 12 months ≈ 2900px wide, scrolls horizontally
const LANE_HEIGHT = 22
const LANE_GAP = 3
const HEADER_HEIGHT = 44

export default function CalendarView({ tournaments, fromDate, toDate, onSelect }: CalendarViewProps) {
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
        background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
        padding: 32, color: '#888', fontSize: 12, textAlign: 'center',
      }}>
        No tournaments in this window. Try widening the date range.
      </div>
    )
  }

  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: 8,
      overflow: 'auto',
      // Bound height so a many-laned month doesn't push the page
      maxHeight: 600,
    }}>
      <div style={{ position: 'relative', width: totalWidth, height: totalHeight }}>
        {/* Month header band */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 2,
          height: HEADER_HEIGHT, background: '#fafafa',
          borderBottom: '1px solid #e5e7eb',
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
                borderRight: '1px solid #e5e7eb',
                padding: '6px 8px',
                fontSize: 11,
                fontWeight: 700,
                color: '#444',
                letterSpacing: '0.4px',
                textTransform: 'uppercase',
                background: i % 2 === 0 ? '#fafafa' : '#f5f6f8',
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
              background: '#f3f4f6',
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
                background: '#FF4655',
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
                color: '#FF4655',
                background: '#fff',
                padding: '1px 4px',
                borderRadius: 2,
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
          const color = LEVEL_COLOR[a.tournament.level ?? ''] ?? DEFAULT_COLOR
          const top = HEADER_HEIGHT + 6 + a.laneIndex * (LANE_HEIGHT + LANE_GAP)
          const left = a.startDay * PIXELS_PER_DAY
          const width = Math.max(PIXELS_PER_DAY, (a.endDay - a.startDay + 1) * PIXELS_PER_DAY - 1)
          return (
            <button
              key={a.tournament.id}
              onClick={() => onSelect(a.tournament.id)}
              title={`${a.tournament.name} · ${a.tournament.starts_at?.slice(0, 10)} → ${a.tournament.ends_at?.slice(0, 10) ?? '—'} · ${a.tournament.matchCount} matches`}
              style={{
                position: 'absolute',
                top,
                left,
                width,
                height: LANE_HEIGHT,
                background: color.bg,
                border: `1px solid ${color.border}`,
                borderRadius: 4,
                color: color.text,
                fontSize: 10,
                fontWeight: 600,
                padding: '0 6px',
                textAlign: 'left',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                cursor: 'pointer',
                zIndex: 1,
                fontFamily: 'inherit',
              }}
            >
              {a.tournament.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}

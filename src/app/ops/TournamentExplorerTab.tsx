'use client'
// src/app/ops/TournamentExplorerTab.tsx
//
// Tournament-centric ops view. Two modes:
//
//   1. LIST mode (default) — filter bar + scrollable table of every
//      tournament in the date window. Each row shows match count and
//      4 data-quality dots (Entry List / OOP / Draw / Results). Use this
//      to spot tournaments missing data at a glance.
//
//   2. DRILL mode — click a row to load the existing 3 sub-tabs (Entry
//      List, Matches, Draw) for that tournament. "← Back to list" returns.
//
// State is local — selection isn't persisted to the URL or localStorage.
// Filters reset on full reload, which is the right tradeoff for an
// operator-only tool.

import { useEffect, useMemo, useState } from 'react'
import PadelgodEntryListTab from './PadelgodEntryListTab'
import TournamentMatchesSubtab from './tournament/TournamentMatchesSubtab'
import TournamentDrawSubtab from './tournament/TournamentDrawSubtab'
import CalendarView, { TournamentHoverCard } from './tournament/CalendarView'

// ── Types (mirror /api/ops/tournament-explorer response) ────────────────

interface TournamentWithSources {
  // Identity
  id: string
  name: string
  source: string | null
  padelapi_id: string | null
  fip_id: string | null
  matchscorer_url: string | null
  // Calendar
  starts_at: string | null
  ends_at: string | null
  timezone: string | null
  // Geography
  country: string | null
  location: string | null
  venue: string | null
  venue_address: string | null
  venue_type: string | null
  n_courts: number | null
  surface: string | null
  // Format
  level: string | null
  prize_money: string | null
  prize_money_fip: number | null
  draw_size_md: number | null
  draw_size_qd: number | null
  // Status
  status: string | null
  entry_list_status: string | null
  // Visual
  logo_url: string | null
  // Derived
  matchCount: number
  finalPlayed: boolean
  entryListCapturedAt: string | null
  oopCapturedAt: string | null
  resultsCapturedAt: string | null
  drawCapturedAt: string | null
}

type SubTab = 'entryList' | 'matches' | 'draw'
type ViewMode = 'list' | 'calendar'

// Level groupings for the filter chips. The DB stores raw codes (`p1`,
// `fip_gold`, etc.) — we render them with friendly labels and group
// Premier vs FIP visually.
const LEVEL_GROUPS: { label: string; values: { code: string; label: string }[] }[] = [
  {
    label: 'Premier Padel',
    values: [
      { code: 'major', label: 'Major' },
      { code: 'p1', label: 'P1' },
      { code: 'p2', label: 'P2' },
      { code: 'finals', label: 'Finals' },
    ],
  },
  {
    label: 'FIP Tour',
    values: [
      { code: 'fip_platinum', label: 'Platinum' },
      { code: 'fip_gold', label: 'Gold' },
      { code: 'fip_silver', label: 'Silver' },
      { code: 'fip_bronze', label: 'Bronze' },
      { code: 'fip_other', label: 'Other' },
    ],
  },
]

const ALL_LEVEL_CODES = LEVEL_GROUPS.flatMap(g => g.values.map(v => v.code))

// ── Styles ──────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: 'white',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: 12,
}

// ── Helpers ─────────────────────────────────────────────────────────────

function formatAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (!isFinite(ms) || ms < 0) return '—'
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

function formatDateShort(iso: string | null): string {
  // Full YYYY-MM-DD so the year is unambiguous when the filter window
  // crosses a year boundary. Slicing the ISO string is faster + more
  // predictable than Intl.DateTimeFormat for this UTC-only display.
  if (!iso) return '—'
  return iso.slice(0, 10)
}

function defaultDateRange(): { from: string; to: string } {
  // Operator-lens default: tight context window centered on "what's
  // happening now and what's coming next." 7 days of past keeps live
  // / just-finished events visible for follow-up; 60 days of future
  // covers most planning horizons without diluting the screen with
  // distant events. Operators can widen the range manually any time.
  const now = new Date()
  const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const to = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000)
  const fmt = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  return { from: fmt(from), to: fmt(to) }
}

function levelFriendly(code: string | null): string {
  if (!code) return '—'
  for (const group of LEVEL_GROUPS) {
    const hit = group.values.find(v => v.code === code)
    if (hit) return hit.label
  }
  return code
}

// ── Component ───────────────────────────────────────────────────────────

export default function TournamentExplorerTab() {
  // ── Filter state ──
  const initialRange = defaultDateRange()
  const [fromDate, setFromDate] = useState<string>(initialRange.from)
  const [toDate, setToDate] = useState<string>(initialRange.to)
  // Level filter — empty Set means "show all". Toggle codes in/out via
  // the level chips. Storing as a Set keeps lookups O(1) for the chip
  // active-state check.
  const [selectedLevels, setSelectedLevels] = useState<Set<string>>(new Set())

  // ── Data state ──
  const [tournaments, setTournaments] = useState<TournamentWithSources[]>([])
  const [loadingList, setLoadingList] = useState(false)
  const [listError, setListError] = useState<string | null>(null)

  // ── Selection / drill-down ──
  const [selectedId, setSelectedId] = useState<string>('')
  const [subTab, setSubTab] = useState<SubTab>('entryList')

  // ── View mode (List / Calendar) ──
  // Default to list — operators reach for the table first when auditing
  // data quality. Calendar is the "what's coming up?" lens.
  const [viewMode, setViewMode] = useState<ViewMode>('list')

  // Hover card on list-view rows — same component the calendar uses,
  // so the audit summary feels identical across views.
  const [hoveredRow, setHoveredRow] = useState<{ t: TournamentWithSources; x: number; y: number } | null>(null)

  // Refetch whenever filters change. Builds the query string from current
  // state — falsy/default values get dropped so the URL stays clean.
  useEffect(() => {
    let cancelled = false
    setLoadingList(true)
    setListError(null)

    const params = new URLSearchParams()
    if (fromDate) params.set('from', fromDate)
    if (toDate) params.set('to', toDate)
    if (selectedLevels.size > 0) {
      params.set('level', Array.from(selectedLevels).join(','))
    }

    fetch(`/api/ops/tournament-explorer?${params.toString()}`)
      .then(r => r.json())
      .then((data: { tournaments?: TournamentWithSources[]; error?: string }) => {
        if (cancelled) return
        if (data.error) {
          setListError(data.error)
          return
        }
        setTournaments(data.tournaments ?? [])
      })
      .catch(e => {
        if (cancelled) return
        setListError(e instanceof Error ? e.message : 'Failed to load list')
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false)
      })

    return () => { cancelled = true }
  }, [fromDate, toDate, selectedLevels])

  const selected = useMemo(
    () => tournaments.find(t => t.id === selectedId) ?? null,
    [tournaments, selectedId],
  )

  // ── Operator stats — counts derived from the loaded tournaments ──
  // Recomputed whenever the list changes. We want clear, hard numbers
  // an operator can act on: "what's running now" / "what's imminent" /
  // "what's missing data right when it matters."
  const stats = useMemo(() => {
    const todayISO = new Date().toISOString().slice(0, 10)
    const in7DaysISO = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
    const in30DaysISO = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
    let liveNow = 0
    let next7 = 0
    let next30 = 0
    let needsAttention = 0
    for (const t of tournaments) {
      const s = (t.starts_at ?? '').slice(0, 10)
      const e = (t.ends_at ?? t.starts_at ?? '').slice(0, 10)
      // A tournament is "Live now" only if its date window contains today
      // AND its final hasn't been played yet. `ends_at` is just the
      // calendar end — events frequently finish a day or two early when
      // the final is on the penultimate day, and we don't want those
      // showing as live until the calendar date catches up.
      if (s && e && s <= todayISO && todayISO <= e && !t.finalPlayed) liveNow++
      if (s && s > todayISO && s <= in7DaysISO) next7++
      if (s && s > todayISO && s <= in30DaysISO) next30++
      // "Needs attention": starting within 7 days (or already live), has a
      // FIP id (so we expect data), AND no entry list captured yet.
      // Already-finished events don't need attention — operators can't
      // change a played tournament's missing entry list, and showing them
      // would inflate the counter with noise.
      if (
        s && s <= in7DaysISO &&
        (!e || e >= todayISO) &&
        t.fip_id && !t.entryListCapturedAt &&
        !t.finalPlayed
      ) {
        needsAttention++
      }
    }
    return { liveNow, next7, next30, needsAttention }
  }, [tournaments])

  function toggleLevel(code: string) {
    setSelectedLevels(prev => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  function clearFilters() {
    setSelectedLevels(new Set())
    setFromDate(initialRange.from)
    setToDate(initialRange.to)
  }

  // ── Drill-down view ──
  if (selected) {
    return (
      <div>
        <button
          onClick={() => setSelectedId('')}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: '#666', fontSize: 12, fontWeight: 600, padding: 0,
            marginBottom: 12,
          }}
        >
          ← Back to list
        </button>

        <TournamentDetailsHeader t={selected} />

        <div style={{ display: 'flex', gap: 2, marginBottom: 12, borderBottom: '1px solid #e5e7eb' }}>
          <SubTabButton
            label="Entry List"
            active={subTab === 'entryList'}
            onClick={() => setSubTab('entryList')}
            hasData={Boolean(selected.entryListCapturedAt)}
          />
          <SubTabButton
            label="Matches"
            active={subTab === 'matches'}
            onClick={() => setSubTab('matches')}
            hasData={Boolean(selected.oopCapturedAt || selected.resultsCapturedAt)}
          />
          <SubTabButton
            label="Draw"
            active={subTab === 'draw'}
            onClick={() => setSubTab('draw')}
            hasData={Boolean(selected.drawCapturedAt)}
          />
        </div>

        {subTab === 'entryList' && <PadelgodEntryListTab tournamentId={selected.id} />}
        {subTab === 'matches' && <TournamentMatchesSubtab tournamentId={selected.id} />}
        {subTab === 'draw' && <TournamentDrawSubtab tournamentId={selected.id} />}
      </div>
    )
  }

  // ── List view ──
  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: '#111' }}>
          Tournament Explorer
        </h2>
        <p style={{ fontSize: 12, color: '#666', marginTop: 4, maxWidth: 720 }}>
          Every tournament whose dates overlap your selected window. Filter by
          level + date range to focus on what matters. Each row shows the
          match count plus four data-quality dots — Entry List, Order of Play,
          Draw, Results — so you can spot capture gaps at a glance. Click a
          row to drill into the per-tournament audit view.
        </p>
      </div>

      {/* Operator stats strip — pre-computed counts above the filter bar.
          Anchored above the filter so the operator sees "what matters
          today" before deciding which slice of the calendar to view. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
        <StatTile label="Live now" value={stats.liveNow} accent="#16a34a" />
        <StatTile label="Next 7 days" value={stats.next7} accent="#0ea5e9" />
        <StatTile label="Next 30 days" value={stats.next30} accent="#6366f1" />
        <StatTile label="Needs attention" value={stats.needsAttention} accent={stats.needsAttention > 0 ? '#dc2626' : '#9ca3af'} subtitle="Imminent without entry list" />
      </div>

      {/* Filter bar */}
      <div style={{ ...card, marginBottom: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
          {/* Date range */}
          <div>
            <label style={filterLabelStyle}>From</label>
            <input
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              style={dateInputStyle}
            />
          </div>
          <div>
            <label style={filterLabelStyle}>To</label>
            <input
              type="date"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
              style={dateInputStyle}
            />
          </div>

          {/* Level chips, grouped */}
          <div style={{ flex: 1, minWidth: 280 }}>
            <label style={filterLabelStyle}>Level</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {LEVEL_GROUPS.map(group => (
                <div key={group.label} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <span style={{ fontSize: 9, color: '#999', fontWeight: 700, marginRight: 2, marginLeft: 4 }}>
                    {group.label.toUpperCase()}
                  </span>
                  {group.values.map(v => (
                    <LevelChip
                      key={v.code}
                      label={v.label}
                      active={selectedLevels.has(v.code)}
                      onClick={() => toggleLevel(v.code)}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Clear */}
          <div style={{ alignSelf: 'flex-end' }}>
            <button
              onClick={clearFilters}
              style={{
                padding: '6px 12px',
                background: '#fff',
                border: '1px solid #d1d5db',
                borderRadius: 4,
                color: '#666',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Reset
            </button>
          </div>
        </div>

        <div style={{ marginTop: 10, fontSize: 11, color: '#999' }}>
          {loadingList
            ? 'Loading…'
            : `${tournaments.length} tournament${tournaments.length === 1 ? '' : 's'} match${tournaments.length === 1 ? 'es' : ''} the filters`}
          {selectedLevels.size > 0 && ` · ${selectedLevels.size} of ${ALL_LEVEL_CODES.length} levels selected`}
        </div>
      </div>

      {/* View mode toggle (List / Calendar) — sits just above the result
          area so the eye picks it up after reading filter state. The two
          views read the same `tournaments` array, so flipping this is
          instantaneous (no refetch). */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        <ViewModeBtn label="List" active={viewMode === 'list'} onClick={() => setViewMode('list')} />
        <ViewModeBtn label="Calendar" active={viewMode === 'calendar'} onClick={() => setViewMode('calendar')} />
      </div>

      {listError && (
        <div style={{ ...card, color: '#991b1b', marginBottom: 12 }}>
          ❌ {listError}
        </div>
      )}

      {/* Tournament table */}
      {!loadingList && tournaments.length === 0 && !listError && (
        <div style={{ ...card, color: '#666', fontSize: 12 }}>
          No tournaments match the current filters. Try widening the date
          range or clearing level filters.
        </div>
      )}

      {viewMode === 'calendar' && tournaments.length > 0 && (
        <CalendarView
          tournaments={tournaments}
          fromDate={fromDate}
          toDate={toDate}
          onSelect={id => { setSelectedId(id); setSubTab('entryList') }}
        />
      )}

      {viewMode === 'list' && tournaments.length > 0 && (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f9fafb', textAlign: 'left' }}>
                <th style={thStyle}>Starts</th>
                <th style={thStyle}>Tournament</th>
                <th style={thStyle}>Level</th>
                <th style={thStyle}>Country</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Matches</th>
                <th style={{ ...thStyle, textAlign: 'center' }} title="Entry List">EL</th>
                <th style={{ ...thStyle, textAlign: 'center' }} title="Order of Play">OOP</th>
                <th style={{ ...thStyle, textAlign: 'center' }} title="Draw">DR</th>
                <th style={{ ...thStyle, textAlign: 'center' }} title="Results">RS</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {tournaments.map(t => {
                const dataDots = [
                  Boolean(t.entryListCapturedAt),
                  Boolean(t.oopCapturedAt),
                  Boolean(t.drawCapturedAt),
                  Boolean(t.resultsCapturedAt),
                ]
                const completenessPct = dataDots.filter(Boolean).length / dataDots.length
                return (
                  <tr
                    key={t.id}
                    onClick={() => { setSelectedId(t.id); setSubTab('entryList') }}
                    style={{
                      borderBottom: '1px solid #f3f4f6',
                      cursor: 'pointer',
                      background: '#fff',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = '#f9fafb'
                      const rect = e.currentTarget.getBoundingClientRect()
                      // Anchor tooltip to right edge of row, vertically
                      // centered on the row, so it doesn't overlap the
                      // row's own content when the table is full-width.
                      setHoveredRow({ t, x: rect.right + 8, y: rect.top + rect.height / 2 - 100 })
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = '#fff'
                      setHoveredRow(prev => (prev?.t.id === t.id ? null : prev))
                    }}
                  >
                    <td style={{ ...tdStyle, color: '#666', fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>
                      {formatDateShort(t.starts_at)}
                    </td>
                    <td style={{ ...tdStyle, fontWeight: 600, color: '#111' }}>
                      {t.name}
                    </td>
                    <td style={tdStyle}>
                      {levelFriendly(t.level)}
                    </td>
                    <td style={tdStyle}>
                      {t.country ?? '—'}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', color: t.matchCount === 0 ? '#dc2626' : '#111', fontWeight: 600 }}>
                      {t.matchCount}
                    </td>
                    <td style={tdStyleCenter}>
                      <DataDot present={Boolean(t.entryListCapturedAt)} freshAgo={t.entryListCapturedAt} />
                    </td>
                    <td style={tdStyleCenter}>
                      <DataDot present={Boolean(t.oopCapturedAt)} freshAgo={t.oopCapturedAt} />
                    </td>
                    <td style={tdStyleCenter}>
                      <DataDot present={Boolean(t.drawCapturedAt)} freshAgo={t.drawCapturedAt} />
                    </td>
                    <td style={tdStyleCenter}>
                      <DataDot present={Boolean(t.resultsCapturedAt)} freshAgo={t.resultsCapturedAt} />
                    </td>
                    <td style={{ ...tdStyle, color: '#bbb', fontSize: 11 }}>
                      {Math.round(completenessPct * 100)}%
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Rich hover card for list-view rows — reuses the calendar's card so
          the summary feels identical across views. Pointer-events: none on
          the card itself (handled inside the component) so it doesn't
          steal focus from the row underneath. */}
      {viewMode === 'list' && hoveredRow && (
        <TournamentHoverCard t={hoveredRow.t} x={hoveredRow.x} y={hoveredRow.y} />
      )}
    </div>
  )
}

// ── Tournament details header (drill-down view) ─────────────────────────

function TournamentDetailsHeader({ t }: { t: TournamentWithSources }) {
  const startEnd = [t.starts_at?.slice(0, 10), t.ends_at?.slice(0, 10)]
    .filter(Boolean)
    .join(' → ')
  // fip_id is the URL slug (e.g. "fip-bronze-singapore-ii-2026"). Migration
  // 20260407_canonical_source_ids consolidated fip_slug into fip_id.
  const fipUrl = t.fip_id ? `https://www.padelfip.com/events/${t.fip_id}/` : null
  const drawSize = [
    t.draw_size_md ? `MD ${t.draw_size_md}` : null,
    t.draw_size_qd ? `QD ${t.draw_size_qd}` : null,
  ].filter(Boolean).join(' · ')
  const prize = t.prize_money
    || (t.prize_money_fip ? `€${t.prize_money_fip.toLocaleString()}` : null)
  const venueLine = [
    t.venue,
    t.venue_type,
    t.n_courts ? `${t.n_courts} courts` : null,
    t.surface,
  ].filter(Boolean).join(' · ')

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Title row with logo, name, and external link */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 14 }}>
        {t.logo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={t.logo_url}
            alt=""
            style={{
              width: 56, height: 56, objectFit: 'contain',
              borderRadius: 4, background: '#fff',
              border: '1px solid #e5e7eb', flexShrink: 0,
              padding: 4,
            }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: '#111' }}>
            {t.name}
          </h2>
          <div style={{ fontSize: 12, color: '#666', marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            {[
              levelFriendly(t.level),
              t.country,
              t.location,
              startEnd,
              t.timezone,
            ].filter(Boolean).map((v, i) => (
              <span key={i}>
                {i > 0 && <span style={{ color: '#ccc', marginRight: 8 }}>·</span>}
                {v}
              </span>
            ))}
          </div>
        </div>
        {fipUrl && (
          <a
            href={fipUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '6px 14px',
              fontSize: 11,
              fontWeight: 700,
              color: '#fff',
              background: '#111',
              borderRadius: 4,
              textDecoration: 'none',
              flexShrink: 0,
              letterSpacing: '0.4px',
              textTransform: 'uppercase',
            }}
          >
            View on FIP →
          </a>
        )}
      </div>

      {/* Metadata grid — every meaningful field rendered as a labeled tile.
          NULL fields render with em dash so the absence is visible (matters
          for ops because 'no prize_money_fip yet' is itself a data signal). */}
      <div style={{ ...card, marginBottom: 12 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
            fontSize: 11,
            color: '#555',
          }}
        >
          <Field label="Source" value={t.source} />
          <Field label="Status" value={t.status} />
          <Field label="Entry list status" value={t.entry_list_status} />
          <Field label="Prize money" value={prize} />
          <Field label="Draw size" value={drawSize || null} />
          <Field label="Venue" value={venueLine || null} />
          {t.venue_address && <Field label="Address" value={t.venue_address} />}
          <Field label="PadelAPI ID" value={t.padelapi_id} mono />
          <Field label="FIP ID" value={t.fip_id} mono />
          {t.matchscorer_url && <Field label="Matchscorer" value={t.matchscorer_url} mono />}
        </div>
      </div>

      {/* Padelgod capture freshness — kept distinct from the metadata grid
          so the "what scrapers have run" question stays visually separate
          from the "what's in the row" question. */}
      <div style={{ ...card }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 12,
            fontSize: 11,
            color: '#555',
          }}
        >
          <FreshnessTile label="Entry List" at={t.entryListCapturedAt} />
          <FreshnessTile label="OOP" at={t.oopCapturedAt} />
          <FreshnessTile label="Results" at={t.resultsCapturedAt} />
          <FreshnessTile label="Draw" at={t.drawCapturedAt} />
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: '#999', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.5px' }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: value ? '#222' : '#bbb',
          fontFamily: mono ? 'ui-monospace, SFMono-Regular, monospace' : 'inherit',
          marginTop: 2,
          wordBreak: 'break-word',
        }}
      >
        {value || '—'}
      </div>
    </div>
  )
}

// ── Atoms ───────────────────────────────────────────────────────────────

const filterLabelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 9,
  fontWeight: 700,
  color: '#999',
  textTransform: 'uppercase',
  letterSpacing: '0.6px',
  marginBottom: 4,
}

const dateInputStyle: React.CSSProperties = {
  padding: '5px 8px',
  fontSize: 12,
  border: '1px solid #d1d5db',
  borderRadius: 4,
  background: '#fff',
  color: '#333',
}

const thStyle: React.CSSProperties = {
  padding: '8px 10px',
  fontSize: 10,
  fontWeight: 700,
  color: '#666',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  borderBottom: '1px solid #e5e7eb',
}

const tdStyle: React.CSSProperties = {
  padding: '8px 10px',
  color: '#444',
}

const tdStyleCenter: React.CSSProperties = {
  ...tdStyle,
  textAlign: 'center',
}

function StatTile({
  label, value, accent, subtitle,
}: {
  label: string
  value: number
  accent: string
  subtitle?: string
}) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        borderLeft: `4px solid ${accent}`,
        padding: '12px 14px',
      }}
    >
      <div style={{ fontSize: 9, color: '#6b7280', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.5px' }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: accent, lineHeight: 1.05, marginTop: 4 }}>
        {value}
      </div>
      {subtitle && (
        <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 3 }}>
          {subtitle}
        </div>
      )}
    </div>
  )
}

function ViewModeBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 14px',
        fontSize: 11,
        fontWeight: 700,
        background: active ? '#111' : '#fff',
        color: active ? '#fff' : '#666',
        border: '1px solid ' + (active ? '#111' : '#d1d5db'),
        borderRadius: 4,
        cursor: 'pointer',
        letterSpacing: '0.5px',
        textTransform: 'uppercase',
      }}
    >
      {label}
    </button>
  )
}

function LevelChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 10px',
        fontSize: 11,
        fontWeight: 600,
        background: active ? '#111' : '#fff',
        color: active ? '#fff' : '#444',
        border: `1px solid ${active ? '#111' : '#d1d5db'}`,
        borderRadius: 999,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}

function DataDot({ present, freshAgo }: { present: boolean; freshAgo: string | null }) {
  // Two-tier color: green when present + fresh (< 24h), amber when present
  // but stale (> 24h), red filled-circle outline when missing entirely.
  let color = '#dc2626' // missing — red
  let title = 'No data'
  if (present && freshAgo) {
    const ageMs = Date.now() - new Date(freshAgo).getTime()
    const ageH = ageMs / (60 * 60 * 1000)
    if (ageH < 24) {
      color = '#16a34a' // green
      title = `Fresh: ${formatAgo(freshAgo)} ago`
    } else {
      color = '#d97706' // amber
      title = `Stale: ${formatAgo(freshAgo)} ago`
    }
  }
  return (
    <span
      title={title}
      style={{
        display: 'inline-block',
        width: 10, height: 10, borderRadius: '50%',
        background: present ? color : 'transparent',
        border: present ? 'none' : `1.5px solid ${color}`,
      }}
    />
  )
}

function FreshnessTile({ label, at }: { label: string; at: string | null }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: '#999', textTransform: 'uppercase', fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: at ? '#333' : '#bbb' }}>
        {at ? formatAgo(at) : '—'}{at ? ' ago' : ''}
      </div>
    </div>
  )
}

function SubTabButton({
  label,
  active,
  onClick,
  hasData,
}: {
  label: string
  active: boolean
  onClick: () => void
  hasData: boolean
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 16px',
        fontSize: 13,
        fontWeight: active ? 700 : 500,
        color: active ? '#111' : hasData ? '#555' : '#bbb',
        background: 'transparent',
        border: 'none',
        borderBottom: active ? '2px solid #111' : '2px solid transparent',
        cursor: 'pointer',
        marginBottom: -1,
      }}
    >
      {label}
      {!hasData && (
        <span style={{ fontSize: 9, color: '#bbb', marginLeft: 6, fontWeight: 500 }}>
          (no data)
        </span>
      )}
    </button>
  )
}

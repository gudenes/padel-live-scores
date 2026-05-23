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

import React, { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import PadelgodEntryListTab from './PadelgodEntryListTab'
import TournamentMatchesSubtab from './TournamentMatchesSubtab'
import TournamentDrawSubtab from './TournamentDrawSubtab'
import CalendarView, { TournamentHoverCard } from './CalendarView'

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
  prize_money_eur: number | null
  prize_money_eur_source: string | null
  prize_breakdown: Record<string, number | string> | null
  prize_breakdown_by_category: {
    men: Record<string, number | string> | null
    women: Record<string, number | string> | null
  } | null
  signup_fee_eur: number | null
  registration_status: string | null
  schedule_notes: string | null
  draw_size_md: number | null
  draw_size_qd: number | null
  slug: string | null
  // Status
  status: string | null
  entry_list_status: string | null
  // Visual
  logo_url: string | null
  // Derived
  matchCount: number
  finalPlayed: boolean
  phases: Array<{ round: string; category: string | null; firstStartsAt: string; matchCount: number }>
  entryListCapturedAt: string | null
  oopCapturedAt: string | null
  resultsCapturedAt: string | null
  drawCapturedAt: string | null
  widgetId: string | null
  widgetLookupAttempts7d: number
  widgetLookupLastAttemptAt: string | null
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
  // "Needs widget" toggle — when on, the table is filtered to FIP
  // tournaments that don't have a Crionet widget_id yet. Independent of
  // the level chips so the operator can sweep the gap across all tiers.
  const [needsWidgetFilter, setNeedsWidgetFilter] = useState<boolean>(false)

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

  // Bump this key to force a re-fetch without changing filter state
  // (used by EditPrizeButton after a successful save).
  const [reloadKey, setReloadKey] = useState(0)
  const refetch = useCallback(() => setReloadKey(k => k + 1), [])

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

    fetch(`/api/internal/tournament-explorer?${params.toString()}`)
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
  }, [fromDate, toDate, selectedLevels, reloadKey])

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
    // "Needs widget" — FIP tournaments without a Crionet widget_id that
    // are either live now or starting within 7 days. These are the ones
    // where the static-fetcher chain (entry list / OOP / results) can't
    // run because there's nothing to point matchscorerlive at.
    let needsWidget = 0
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
      // Needs widget: FIP-sourced, no widget_id resolved, currently live
      // or starting within 7 days, not already played out. The
      // circuit-breaker keeps these from spinning forever upstream — this
      // tile makes the resulting backlog visible to the operator.
      if (
        s && s <= in7DaysISO &&
        (!e || e >= todayISO) &&
        t.fip_id && !t.widgetId &&
        !t.finalPlayed
      ) {
        needsWidget++
      }
    }
    return { liveNow, next7, next30, needsAttention, needsWidget }
  }, [tournaments])

  // Apply client-side "Needs widget" filter on top of the server-fetched
  // list. Server-side filtering would require a new query param + RPC
  // change; this is a small enough set that filtering in-memory is fine.
  const visibleTournaments = useMemo(() => {
    if (!needsWidgetFilter) return tournaments
    return tournaments.filter(
      t => t.fip_id && !t.widgetId && !t.finalPlayed,
    )
  }, [tournaments, needsWidgetFilter])

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

        <TournamentDetailsHeader t={selected} onRefetch={refetch} />

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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 14 }}>
        <StatTile label="Live now" value={stats.liveNow} accent="#16a34a" />
        <StatTile label="Next 7 days" value={stats.next7} accent="#0ea5e9" />
        <StatTile label="Next 30 days" value={stats.next30} accent="#6366f1" />
        <StatTile label="Needs attention" value={stats.needsAttention} accent={stats.needsAttention > 0 ? '#dc2626' : '#9ca3af'} subtitle="Imminent without entry list" />
        <StatTile
          label="Needs widget"
          value={stats.needsWidget}
          accent={stats.needsWidget > 0 ? '#f59e0b' : '#9ca3af'}
          subtitle="No Crionet widget_id"
          onClick={() => setNeedsWidgetFilter(v => !v)}
          active={needsWidgetFilter}
        />
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
            : needsWidgetFilter
              ? `${visibleTournaments.length} of ${tournaments.length} tournaments need a widget_id`
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

      {viewMode === 'list' && visibleTournaments.length > 0 && (
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
                {needsWidgetFilter && (
                  <>
                    <th style={{ ...thStyle, textAlign: 'right' }} title="Widget-lookup attempts in last 7 days">Tries 7d</th>
                    <th style={thStyle} title="Most recent widget-lookup attempt">Last try</th>
                  </>
                )}
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {visibleTournaments.map(t => {
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
                    {needsWidgetFilter && (
                      <>
                        <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'ui-monospace, SFMono-Regular, monospace', color: t.widgetLookupAttempts7d >= 12 ? '#dc2626' : '#666' }}>
                          {t.widgetLookupAttempts7d}
                        </td>
                        <td style={{ ...tdStyle, color: '#666' }}>
                          {formatAgo(t.widgetLookupLastAttemptAt)}
                        </td>
                      </>
                    )}
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

function TournamentDetailsHeader({ t, onRefetch }: { t: TournamentWithSources; onRefetch: () => void }) {
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
        <RefreshTournamentButton tournamentId={t.id} />
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
          <Field label="Registration" value={t.registration_status} />
          <Field label="Prize money (raw)" value={prize} />
          <Field
            label="Prize money (EUR)"
            value={
              <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                <span>{t.prize_money_eur != null ? `€${t.prize_money_eur.toLocaleString()}` : '—'}</span>
                {t.prize_money_eur_source && (
                  <span style={{
                    fontSize: 9, marginLeft: 6, padding: '1px 5px',
                    background: '#eef', color: '#557', borderRadius: 3,
                    textTransform: 'uppercase', letterSpacing: '0.4px',
                  }}>{t.prize_money_eur_source}</span>
                )}
                <EditPrizeButton
                  tournamentId={t.id}
                  currentValue={t.prize_money_eur}
                  onSaved={onRefetch}
                />
              </span>
            }
          />
          <Field label="Sign-up fee" value={t.signup_fee_eur != null ? `€${t.signup_fee_eur}` : null} />
          <Field label="Draw size" value={drawSize || null} />
          <Field label="Venue" value={venueLine || null} />
          {t.venue_address && <Field label="Address" value={t.venue_address} />}
          <Field label="PadelAPI ID" value={t.padelapi_id} mono />
          <Field label="FIP ID" value={t.fip_id} mono />
          {t.matchscorer_url && <Field label="Matchscorer" value={t.matchscorer_url} mono />}
        </div>
      </div>

      {/* Prize breakdown — per-round payouts when FIP publishes them, or
          synthesized from the Premier rulebook when it doesn't (the norm
          for Premier events). For P1/P2 the men's/women's rulebooks
          diverge, so the ops route ships a `prize_breakdown_by_category`
          companion field that we render as two side-by-side columns.
          Major: men=women so a single column is exact. Each value is
          €/player; pair total = 2x. */}
      {(t.prize_breakdown || t.prize_breakdown_by_category) && (() => {
        const ROWS: Array<[string, string]> = [
          ['winner', 'Winner'],
          ['finalist', 'Finalist'],
          ['sf', 'Semifinal'],
          ['qf', 'Quarterfinal'],
          ['r16', 'Round of 16'],
          ['r32', 'Round of 32'],
        ]
        const byCat = t.prize_breakdown_by_category
        // Two-column path for synthesized P1/P2. Filter to rows where at
        // least one gender has a number so we don't waste a row on a
        // round that wasn't paid in either table.
        if (byCat && (byCat.men || byCat.women)) {
          const rows = ROWS.filter(
            ([k]) => typeof byCat.men?.[k] === 'number' || typeof byCat.women?.[k] === 'number',
          )
          if (rows.length === 0) return null
          const source = String(byCat.men?.source ?? byCat.women?.source ?? 'rulebook')
          const cell = (val: unknown, highlight: boolean) =>
            typeof val === 'number' ? (
              <span style={{ fontWeight: 700, color: highlight ? '#16a34a' : '#111', fontVariantNumeric: 'tabular-nums' }}>
                €{val.toLocaleString()}
              </span>
            ) : (
              <span style={{ color: '#ccc', fontVariantNumeric: 'tabular-nums' }}>—</span>
            )
          return (
            <div style={{ ...card, marginBottom: 12 }}>
              <div style={{ fontSize: 9, color: '#999', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.5px', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                <span>Prize breakdown</span>
                <span style={{ color: '#bbb', fontWeight: 500, letterSpacing: 0 }}>
                  €/player · source: {source}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 10, color: '#999', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                <div style={{ paddingLeft: 10 }}>Men</div>
                <div style={{ paddingLeft: 10 }}>Women</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                {rows.map(([k, label]) => (
                  <React.Fragment key={k}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: '#fafafa', border: '1px solid #eee', borderRadius: 4 }}>
                      <span style={{ color: '#666' }}>{label}</span>
                      {cell(byCat.men?.[k], k === 'winner')}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: '#fafafa', border: '1px solid #eee', borderRadius: 4 }}>
                      <span style={{ color: '#666' }}>{label}</span>
                      {cell(byCat.women?.[k], k === 'winner')}
                    </div>
                  </React.Fragment>
                ))}
              </div>
            </div>
          )
        }
        // Single-column path: Major (men=women), FIP-tier scraped, or
        // anything else where prize_breakdown is set and there's no
        // per-gender split.
        if (!t.prize_breakdown) return null
        const bd = t.prize_breakdown
        const rows = ROWS.filter(([k]) => typeof bd[k] === 'number')
        if (rows.length === 0) return null
        return (
          <div style={{ ...card, marginBottom: 12 }}>
            <div style={{ fontSize: 9, color: '#999', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.5px', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
              <span>Prize breakdown</span>
              <span style={{ color: '#bbb', fontWeight: 500, letterSpacing: 0 }}>
                €/player · source: {String(bd.source ?? 'scraped')}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, fontSize: 12 }}>
              {rows.map(([k, label]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: '#fafafa', border: '1px solid #eee', borderRadius: 4 }}>
                  <span style={{ color: '#666' }}>{label}</span>
                  <span style={{ fontWeight: 700, color: k === 'winner' ? '#16a34a' : '#111', fontVariantNumeric: 'tabular-nums' }}>€{(bd[k] as number).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* Schedule notes — multi-line "Play Order" text from FIP. */}
      {t.schedule_notes && (
        <div style={{ ...card, marginBottom: 12 }}>
          <div style={{ fontSize: 9, color: '#999', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.5px', marginBottom: 8 }}>
            Schedule notes
          </div>
          <pre style={{
            margin: 0,
            fontSize: 11,
            color: '#444',
            fontFamily: 'inherit',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>{t.schedule_notes}</pre>
        </div>
      )}

      {/* Tournament phases — each round + earliest scheduled_at across
          its matches. Tells operators when each phase actually starts
          on the ground (not just the calendar window). Hidden when the
          tournament has no scheduled matches yet. */}
      {t.phases && t.phases.length > 0 && (
        <div style={{ ...card, marginBottom: 12 }}>
          <div style={{ fontSize: 9, color: '#999', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.5px', marginBottom: 8 }}>
            Phases
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 10,
            fontSize: 11,
          }}>
            {t.phases.map(p => {
              // Color-tag the category — orange-ish for men, pink for
              // women, gray fallback when null. Same accent the rest of
              // the app uses on player chips/avatars.
              const catColor = p.category === 'men' ? '#5BA8FF'
                : p.category === 'women' ? '#F472B6'
                : '#9CA3AF'
              const catLabel = p.category === 'men' ? 'Men'
                : p.category === 'women' ? 'Women'
                : null
              return (
                <div
                  key={`${p.round}|${p.category ?? '_'}`}
                  style={{
                    background: '#f9fafb',
                    border: '1px solid #f3f4f6',
                    borderLeft: `3px solid ${catColor}`,
                    borderRadius: 4,
                    padding: '8px 10px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#111' }}>{p.round}</div>
                    {catLabel && (
                      <span style={{
                        fontSize: 9, fontWeight: 800,
                        color: catColor,
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                      }}>{catLabel}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: '#666', marginTop: 2, fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>
                    {p.firstStartsAt.slice(0, 10)} <span style={{ color: '#bbb' }}>·</span> {p.firstStartsAt.slice(11, 16)} UTC
                  </div>
                  <div style={{ fontSize: 9, color: '#9ca3af', marginTop: 2 }}>
                    {p.matchCount} match{p.matchCount === 1 ? '' : 'es'}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

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

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  const isEmpty = value === null || value === undefined || value === ''
  return (
    <div>
      <div style={{ fontSize: 9, color: '#999', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.5px' }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: isEmpty ? '#bbb' : '#222',
          fontFamily: mono ? 'ui-monospace, SFMono-Regular, monospace' : 'inherit',
          marginTop: 2,
          wordBreak: 'break-word',
        }}
      >
        {isEmpty ? '—' : value}
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
  label, value, accent, subtitle, onClick, active,
}: {
  label: string
  value: number
  accent: string
  subtitle?: string
  onClick?: () => void
  active?: boolean
}) {
  const clickable = typeof onClick === 'function'
  return (
    <div
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick!() } } : undefined}
      style={{
        background: active ? '#fffbeb' : '#fff',
        borderTopWidth: 1,
        borderRightWidth: 1,
        borderBottomWidth: 1,
        borderLeftWidth: 4,
        borderStyle: 'solid',
        borderTopColor: active ? accent : '#e5e7eb',
        borderRightColor: active ? accent : '#e5e7eb',
        borderBottomColor: active ? accent : '#e5e7eb',
        borderLeftColor: accent,
        borderRadius: 8,
        padding: '12px 14px',
        cursor: clickable ? 'pointer' : 'default',
        boxShadow: active ? `0 0 0 2px ${accent}33` : 'none',
        transition: 'box-shadow 120ms ease, background 120ms ease',
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

interface RefreshStepResult {
  name: string
  ok: boolean
  durationMs: number
  error?: string
  summary?: unknown
}

function EditPrizeButton({
  tournamentId,
  currentValue,
  onSaved,
}: {
  tournamentId: string
  currentValue: number | null
  onSaved: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState<string>(currentValue?.toString() ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!editing) {
    return (
      <button
        onClick={() => { setEditing(true); setValue(currentValue?.toString() ?? '') }}
        style={{
          fontSize: 10, padding: '2px 6px', marginLeft: 6,
          color: '#444', background: '#f4f4f4', border: '1px solid #ddd',
          borderRadius: 3, cursor: 'pointer',
        }}
      >
        Edit
      </button>
    )
  }

  const handleSave = async (clear: boolean) => {
    setSaving(true)
    setError(null)
    const parsed = clear ? null : Number.parseInt(value, 10)
    if (!clear && (!Number.isInteger(parsed) || (parsed as number) < 0)) {
      setError('Must be a non-negative integer')
      setSaving(false)
      return
    }
    const res = await fetch('/api/internal/tournament-prize', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tournamentId, prizeMoneyEur: clear ? null : parsed }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? `HTTP ${res.status}`)
      setSaving(false)
      return
    }
    setSaving(false)
    setEditing(false)
    onSaved()
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 6 }}>
      <input
        type="number"
        value={value}
        onChange={e => setValue(e.target.value)}
        disabled={saving}
        style={{
          fontSize: 11, padding: '2px 4px', width: 90,
          border: '1px solid #aaa', borderRadius: 3,
        }}
      />
      <button
        onClick={() => handleSave(false)}
        disabled={saving}
        style={{ fontSize: 10, padding: '2px 6px', cursor: 'pointer' }}
      >Save</button>
      <button
        onClick={() => handleSave(true)}
        disabled={saving}
        style={{ fontSize: 10, padding: '2px 6px', cursor: 'pointer', color: '#a00' }}
      >Clear</button>
      <button
        onClick={() => { setEditing(false); setError(null) }}
        disabled={saving}
        style={{ fontSize: 10, padding: '2px 6px', cursor: 'pointer' }}
      >Cancel</button>
      {error && <span style={{ color: '#c00', fontSize: 10 }}>{error}</span>}
    </span>
  )
}

function RefreshTournamentButton({ tournamentId }: { tournamentId: string }) {
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<RefreshStepResult[] | null>(null)
  const [overallOk, setOverallOk] = useState<boolean | null>(null)

  // Reset visible state when the tournament changes (drill into a different row).
  useEffect(() => {
    setResults(null)
    setError(null)
    setOverallOk(null)
  }, [tournamentId])

  async function onClick() {
    if (running) return
    setRunning(true)
    setError(null)
    setResults(null)
    setOverallOk(null)
    try {
      const res = await fetch('/api/internal/refresh-tournament', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tournamentId }),
        credentials: 'same-origin',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        const reason = json?.error?.message || json?.error || `HTTP ${res.status}`
        setError(typeof reason === 'string' ? reason : JSON.stringify(reason))
        return
      }
      const steps = (json?.data?.stepResults ?? []) as RefreshStepResult[]
      setResults(steps)
      setOverallOk(Boolean(json?.data?.ok))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
      <button
        type="button"
        onClick={onClick}
        disabled={running}
        style={{
          padding: '6px 14px',
          fontSize: 11,
          fontWeight: 700,
          color: running ? '#666' : '#fff',
          background: running ? '#e5e7eb' : '#0ea5e9',
          border: 'none',
          borderRadius: 4,
          cursor: running ? 'wait' : 'pointer',
          letterSpacing: '0.4px',
          textTransform: 'uppercase',
        }}
        title="Trigger padelgod ingestion workers for this tournament"
      >
        {running ? 'Refreshing…' : 'Refresh'}
      </button>
      {error && (
        <div style={{ fontSize: 11, color: '#dc2626', maxWidth: 320, textAlign: 'right' }}>
          {error}
        </div>
      )}
      {results && (
        <div
          style={{
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 4,
            padding: 8,
            fontSize: 11,
            color: '#333',
            minWidth: 320,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6, color: overallOk ? '#16a34a' : '#dc2626' }}>
            {overallOk ? 'Refresh OK' : 'Refresh completed with errors'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '2px 10px' }}>
            {results.map((r) => (
              <Fragment key={r.name}>
                <span style={{ color: r.ok ? '#16a34a' : '#dc2626', fontWeight: 700 }}>
                  {r.ok ? '✓' : '✗'}
                </span>
                <span title={r.error ?? undefined}>
                  {r.name}
                  {r.error && (
                    <span style={{ color: '#dc2626', marginLeft: 6, fontWeight: 500 }}>
                      {r.error.slice(0, 80)}
                    </span>
                  )}
                </span>
                <span style={{ color: '#888', fontVariantNumeric: 'tabular-nums' }}>
                  {r.durationMs}ms
                </span>
              </Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

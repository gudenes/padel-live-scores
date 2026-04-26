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

// ── Types (mirror /api/ops/tournament-explorer response) ────────────────

interface TournamentWithSources {
  id: string
  name: string
  starts_at: string | null
  ends_at: string | null
  source: string | null
  level: string | null
  country: string | null
  logo_url: string | null
  fip_id: string | null
  matchCount: number
  entryListCapturedAt: string | null
  oopCapturedAt: string | null
  resultsCapturedAt: string | null
  drawCapturedAt: string | null
}

type SubTab = 'entryList' | 'matches' | 'draw'

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
  const now = new Date()
  const from = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
  const to = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
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

        <div style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: '#111' }}>
            {selected.name}
          </h2>
          <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
            {[
              levelFriendly(selected.level),
              selected.country,
              selected.starts_at?.slice(0, 10),
            ].filter(Boolean).join(' · ')}
          </div>
        </div>

        <div style={{ ...card, marginBottom: 16 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 12,
              fontSize: 11,
              color: '#555',
            }}
          >
            <FreshnessTile label="Entry List" at={selected.entryListCapturedAt} />
            <FreshnessTile label="OOP" at={selected.oopCapturedAt} />
            <FreshnessTile label="Results" at={selected.resultsCapturedAt} />
            <FreshnessTile label="Draw" at={selected.drawCapturedAt} />
          </div>
        </div>

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

      {tournaments.length > 0 && (
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
                    onMouseEnter={e => (e.currentTarget.style.background = '#f9fafb')}
                    onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
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

'use client'
// src/app/ops/tournament/TournamentMatchesSubtab.tsx
//
// Matches subtab of the Tournament Explorer. Shows every match padelgod has
// observed for a tournament (from oop_snapshots + results_snapshots),
// annotated with whether it's linked to a row in public.matches.
//
// This is the key "migration visibility" surface: if a tournament has 60
// padelgod matches and only 20 are linked, we know the reconciler hasn't
// caught up yet — and the UI shows exactly which ones are missing.

import { useEffect, useMemo, useState } from 'react'

// ── Types (mirror /api/ops/tournament-matches response) ─────────────────

interface ExplorerMatch {
  source: 'results' | 'oop' | 'both'
  matchWidgetId: string | null
  dayNumber: number | null
  court: string | null
  courtPosition: number | null
  scheduledLabel: string | null
  category: 'men' | 'women'
  roundLabel: string | null
  team1Player1Name: string | null
  team1Player2Name: string | null
  team2Player1Name: string | null
  team2Player2Name: string | null
  setScores: unknown | null
  winnerTeam: number | null
  status: string | null
  linkedMatchId: string | null
  linkedMatchExternalId: string | null
  capturedAt: string | null
}

interface Stats {
  total: number
  played: number
  scheduled: number
  linked: number
  unlinked: number
}

interface MatchesResponse {
  // `starts_at` is always present in the API response (server selects it
  // unconditionally) but can be null for tournaments whose start date
  // hasn't been synced yet. Used as a fallback for day-pill date labels
  // when dayDates has no entry for a given day_number.
  tournament: { id: string; name: string; starts_at: string | null } | null
  matches: ExplorerMatch[]
  stats: Stats
  capturedAt: { oop: string | null; results: string | null }
  /** Server-derived map of day_number → YYYY-MM-DD — taken from the
   *  scheduled_at of linked public.matches. Correct across qualifier days
   *  that the Crionet OOP numbers BEFORE our stored starts_at. Empty
   *  object when no matches are linked yet (Premier / brand-new).
   *  Optional in the type so older (cached) responses don't crash the UI. */
  dayDates?: Record<number, string>
  error?: string
}

// ── Formatters ──────────────────────────────────────────────────────────

function formatAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (!isFinite(ms) || ms < 0) return '—'
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function renderTeam(
  p1: string | null,
  p2: string | null,
): string {
  if (p1 && p2) return `${p1} / ${p2}`
  return p1 ?? p2 ?? '—'
}

/**
 * Resolve the calendar date for a tournament's `day_number`.
 *
 * Primary source: `dayDates[dayNumber]` — a server-derived YYYY-MM-DD
 * string built from the scheduled_at of linked public.matches. This is
 * the accurate path: it reflects reality including qualifier days that
 * Crionet numbers BEFORE the main-draw starts_at.
 *
 * Fallback: `starts_at + (N-1) days`. Only used when dayDates has no
 * entry (unlinked matches, brand-new tournaments). Known to be off by
 * however many pre-starts_at qualifier days the OOP includes (Brussels
 * P2 2026 was off by one — QF appeared on day 6 → Apr 25 instead of the
 * real Apr 24). We keep the fallback so the UI doesn't just show "Day 6"
 * with no date, but it's second-best.
 *
 * Returns a short "Apr 22" style label. Null when neither source works.
 */
function dateLabelForDay(
  dayDates: Record<number, string> | undefined,
  startsAtIso: string | null,
  dayNumber: number,
): string | null {
  const isoFromDayDates = dayDates?.[dayNumber]
  const iso = isoFromDayDates ?? startsAtOffset(startsAtIso, dayNumber)
  if (!iso) return null
  const d = new Date(`${iso}T00:00:00Z`)
  if (isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function startsAtOffset(startsAtIso: string | null, dayNumber: number): string | null {
  if (!startsAtIso) return null
  const start = new Date(startsAtIso)
  if (isNaN(start.getTime())) return null
  const d = new Date(start.getTime())
  d.setUTCDate(d.getUTCDate() + (dayNumber - 1))
  return d.toISOString().slice(0, 10)
}

function renderSetScores(raw: unknown): string {
  if (!raw) return '—'
  if (Array.isArray(raw)) {
    // Expect shape [[6,3],[7,5]] — render "6-3 7-5".
    return raw
      .map((s) => (Array.isArray(s) ? s.join('-') : String(s)))
      .join(' ')
  }
  if (typeof raw === 'string') return raw
  return JSON.stringify(raw)
}

// ── Styles ──────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: 'white',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: 12,
}

const th: React.CSSProperties = {
  padding: '6px 10px',
  textAlign: 'left',
  color: '#666',
  fontWeight: 600,
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
}

const td: React.CSSProperties = {
  padding: '6px 10px',
  color: '#333',
  verticalAlign: 'top',
}

// ── Component ───────────────────────────────────────────────────────────

type MatchTab = 'oop' | 'results'

export default function TournamentMatchesSubtab({ tournamentId }: { tournamentId: string }) {
  const [data, setData] = useState<MatchesResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filterCategory, setFilterCategory] = useState<'all' | 'men' | 'women'>('all')
  const [filterLinkage, setFilterLinkage] = useState<'all' | 'linked' | 'unlinked'>('all')
  // Tab + day selection. `null` means "auto-pick default" — see the effect
  // below that computes defaults once the data lands. Both are persisted
  // across tab switches inside the session: switching OOP → Results keeps
  // the same `day`.
  const [tab, setTab] = useState<MatchTab>('oop')
  const [day, setDay] = useState<number | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/ops/tournament-matches?tournament_id=${tournamentId}`)
      .then((r) => r.json())
      .then((body: MatchesResponse) => {
        if (body.error) {
          setError(body.error)
          setData(null)
        } else {
          setData(body)
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load matches'))
      .finally(() => setLoading(false))
  }, [tournamentId])

  // ── Derived: list of days + default selection ─────────────────────────
  //
  // `days` is the sorted list of distinct day_numbers across all matches
  // (both sources). `liveDays` is the set of days that have at least one
  // match in a live/on_court status — used to annotate the day pill with
  // a 🟢 indicator.
  //
  // Default day and default tab fire once, when the data first arrives:
  //   - day = the "today" day (highest day with activity) — falls back to
  //     the max day_number if no live day is present
  //   - tab = 'results' when every match is finished (tournament is over),
  //     otherwise 'oop' (in-progress or upcoming view)
  const { days, liveDays, defaultDay, defaultTab } = useMemo(() => {
    if (!data) {
      return { days: [] as number[], liveDays: new Set<number>(), defaultDay: null, defaultTab: 'oop' as MatchTab }
    }
    const dayset = new Set<number>()
    const live = new Set<number>()
    let allFinished = data.matches.length > 0
    for (const m of data.matches) {
      if (m.dayNumber != null) dayset.add(m.dayNumber)
      if (m.status === 'live' || m.status === 'on_court') {
        if (m.dayNumber != null) live.add(m.dayNumber)
        allFinished = false
      }
      if (!['finished', 'retired', 'walkover'].includes(m.status ?? '')) {
        allFinished = false
      }
    }
    const sorted = [...dayset].sort((a, b) => a - b)
    // Prefer the live day; if none, the most recent day with any activity.
    const defDay = live.size > 0 ? Math.min(...live) : sorted[sorted.length - 1] ?? null
    return {
      days: sorted,
      liveDays: live,
      defaultDay: defDay,
      defaultTab: (allFinished ? 'results' : 'oop') as MatchTab,
    }
  }, [data])

  // Apply defaults once the data lands. Guarded so user selections aren't
  // overwritten on refresh — we only fire while `day` is still null (its
  // initial state).
  useEffect(() => {
    if (!data) return
    if (day === null && defaultDay !== null) {
      setDay(defaultDay)
      setTab(defaultTab)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  if (loading) {
    return <div style={{ ...card, color: '#666', fontSize: 12 }}>Loading matches…</div>
  }
  if (error) {
    return (
      <div style={{ ...card, background: '#fee2e2', borderColor: '#fecaca', color: '#991b1b', fontSize: 12 }}>
        ❌ {error}
      </div>
    )
  }
  if (!data) return null
  if (data.matches.length === 0) {
    return (
      <div style={{ ...card, color: '#666', fontSize: 12 }}>
        No padelgod matches captured for this tournament yet. Check the
        Schedule tab or wait for the next OOP/results fetcher tick.
      </div>
    )
  }

  // ── Filter pipeline ────────────────────────────────────────────────
  // 1. Tab: OOP ⇒ source ∈ {oop, both} | Results ⇒ source ∈ {results, both}
  // 2. Day: exact day_number match (null day filter = show all, used while
  //    defaults are resolving).
  // 3. Category + linkage: unchanged from the pre-tab single-view behaviour.
  const tabFiltered = data.matches.filter((m) =>
    tab === 'oop'
      ? m.source === 'oop' || m.source === 'both'
      : m.source === 'results' || m.source === 'both',
  )
  const dayFiltered = day === null
    ? tabFiltered
    : tabFiltered.filter((m) => m.dayNumber === day)
  const filtered = dayFiltered.filter((m) => {
    if (filterCategory !== 'all' && m.category !== filterCategory) return false
    if (filterLinkage === 'linked' && m.linkedMatchId === null) return false
    if (filterLinkage === 'unlinked' && m.linkedMatchId !== null) return false
    return true
  })

  // ── Per-tab stats ─────────────────────────────────────────────────
  // The header `data.stats` is a tournament-wide aggregate. In two-tab
  // mode we want numbers scoped to the current tab × day view so the
  // operator sees what's actually in the table below. `linked / unlinked`
  // are computed from the tab-level slice (ignoring day + user filters)
  // because that matches the mental model "how much of the OOP is linked
  // for this tournament" regardless of which day you're looking at.
  const tabStats = {
    total: tabFiltered.length,
    played: tabFiltered.filter((m) => ['finished', 'retired', 'walkover'].includes(m.status ?? '')).length,
    scheduled: tabFiltered.filter((m) => (m.status ?? 'scheduled') === 'scheduled').length,
    onCourt: tabFiltered.filter((m) => m.status === 'on_court' || m.status === 'live').length,
    linked: tabFiltered.filter((m) => m.linkedMatchId !== null).length,
    unlinked: tabFiltered.filter((m) => m.linkedMatchId === null).length,
  }
  const linkedPct = tabStats.total > 0 ? Math.round((tabStats.linked / tabStats.total) * 100) : 0

  return (
    <div>
      {/* Tab header — OOP / Results */}
      <div style={{ display: 'flex', gap: 2, borderBottom: '2px solid #e5e7eb', marginBottom: 12 }}>
        <TabButton label="OOP" active={tab === 'oop'} onClick={() => setTab('oop')} />
        <TabButton label="Results" active={tab === 'results'} onClick={() => setTab('results')} />
      </div>

      {/* Day picker — one pill per day_number present in the data. 'All'
          option at the start clears the day filter if the operator wants
          a cross-day view. Live-day pills show a 🟢 dot. */}
      {days.length > 1 && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#666', fontWeight: 600, marginRight: 4 }}>Day:</span>
          <DayChip label="All" active={day === null} onClick={() => setDay(null)} />
          {days.map((d) => {
            // Pill label carries both the ordinal (Day N) and the calendar
            // date (Apr 22) when we can derive it from the tournament's
            // starts_at. Dates make it much easier to scan the pills at a
            // glance when the operator is jumping into the middle of a 7-day
            // event ("which day is today?" answered without guessing).
            const dateLabel = dateLabelForDay(data.dayDates, data.tournament?.starts_at ?? null, d)
            return (
              <DayChip
                key={d}
                label={`Day ${d}`}
                subLabel={dateLabel}
                live={liveDays.has(d)}
                active={day === d}
                onClick={() => setDay(d)}
              />
            )
          })}
        </div>
      )}

      {/* Stats + freshness */}
      <div style={{ ...card, display: 'flex', gap: 24, alignItems: 'center', marginBottom: 12 }}>
        <StatTile label={tab === 'oop' ? 'In OOP' : 'In Results'} value={tabStats.total} color="#111" />
        {tab === 'oop' ? (
          <>
            <StatTile label="On court" value={tabStats.onCourt} color="#166534" />
            <StatTile label="Scheduled" value={tabStats.scheduled} color="#92400e" />
            <StatTile label="Played" value={tabStats.played} color="#1e40af" />
          </>
        ) : (
          <StatTile label="Played" value={tabStats.played} color="#1e40af" />
        )}
        <StatTile
          label="Linked"
          value={`${tabStats.linked} (${linkedPct}%)`}
          color={linkedPct === 100 ? '#166534' : linkedPct > 50 ? '#1e40af' : '#991b1b'}
        />
        <StatTile
          label="Unlinked"
          value={tabStats.unlinked}
          color={tabStats.unlinked === 0 ? '#999' : '#991b1b'}
        />
        <div style={{ marginLeft: 'auto', fontSize: 11, color: '#666', textAlign: 'right' }}>
          <div>OOP: {formatAgo(data.capturedAt.oop)}</div>
          <div>Results: {formatAgo(data.capturedAt.results)}</div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
        {(['all', 'men', 'women'] as const).map((cat) => (
          <FilterChip
            key={cat}
            label={cat === 'all' ? 'All categories' : cat}
            active={filterCategory === cat}
            onClick={() => setFilterCategory(cat)}
          />
        ))}
        <span style={{ width: 8 }} />
        {(['all', 'linked', 'unlinked'] as const).map((l) => (
          <FilterChip
            key={l}
            label={l === 'all' ? 'All' : l}
            active={filterLinkage === l}
            onClick={() => setFilterLinkage(l)}
          />
        ))}
      </div>

      {/* Table */}
      <div style={{ ...card, padding: 0, overflow: 'auto' }}>
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb', background: '#f9fafb' }}>
              <th style={th}>Day</th>
              <th style={th}>Court</th>
              <th style={th}>Cat</th>
              <th style={th}>Round</th>
              <th style={th}>Team 1</th>
              <th style={th}>Team 2</th>
              <th style={th}>Score</th>
              <th style={th}>Status</th>
              <th style={th}>Source</th>
              <th style={th}>Link</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m, i) => {
              const winnerStyle = (team: 1 | 2): React.CSSProperties =>
                m.winnerTeam === team ? { fontWeight: 700, color: '#111' } : {}
              return (
                <tr
                  key={(m.matchWidgetId ?? '') + ':' + i}
                  style={{
                    borderBottom: '1px solid #f3f4f6',
                    background: i % 2 === 0 ? '#fff' : '#f9fafb',
                  }}
                >
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 11, color: '#666' }}>
                    {m.dayNumber ?? '—'}
                  </td>
                  <td style={{ ...td, fontSize: 11 }}>
                    <div>{m.court ?? '—'}</div>
                    {m.scheduledLabel && (
                      <div style={{ fontSize: 10, color: '#888' }}>{m.scheduledLabel}</div>
                    )}
                  </td>
                  <td style={{ ...td, fontSize: 11, textTransform: 'capitalize', color: '#555' }}>
                    {m.category}
                  </td>
                  <td style={{ ...td, fontSize: 11, color: '#555' }}>{m.roundLabel ?? '—'}</td>
                  <td style={{ ...td, ...winnerStyle(1) }}>
                    {renderTeam(m.team1Player1Name, m.team1Player2Name)}
                  </td>
                  <td style={{ ...td, ...winnerStyle(2) }}>
                    {renderTeam(m.team2Player1Name, m.team2Player2Name)}
                  </td>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>
                    {renderSetScores(m.setScores)}
                  </td>
                  <td style={td}>
                    <StatusPill status={m.status} />
                  </td>
                  <td style={td}>
                    <SourcePill source={m.source} />
                  </td>
                  <td style={td}>
                    {m.linkedMatchId ? (
                      <a
                        href={`/match/${m.linkedMatchId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: 3,
                          background: '#dcfce7',
                          color: '#166534',
                          textDecoration: 'none',
                        }}
                      >
                        LINKED →
                      </a>
                    ) : (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: 3,
                          background: '#fef3c7',
                          color: '#92400e',
                        }}
                      >
                        UNLINKED
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Small UI atoms ──────────────────────────────────────────────────────

function StatTile({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#999', fontWeight: 600, textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color }}>{value}</div>
    </div>
  )
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  // Tab underline indicator — same visual language as the main ops tabs
  // (see OpsClient.tsx). Active tab gets a blue underline + emphasized
  // text; inactive tabs stay neutral.
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 16px',
        fontSize: 13,
        fontWeight: 700,
        border: 'none',
        background: 'transparent',
        color: active ? '#1e40af' : '#555',
        cursor: 'pointer',
        borderBottom: '2px solid',
        borderColor: active ? '#3b82f6' : 'transparent',
        marginBottom: -2, // align underline with the parent's border-bottom
      }}
    >
      {label}
    </button>
  )
}

function DayChip({
  label,
  subLabel,
  active,
  onClick,
  live = false,
}: {
  label: string
  /** Optional calendar date ("Apr 22"). Rendered in a smaller, dimmer
   *  font next to the ordinal day label. Omit for the "All" pill or
   *  when the tournament has no starts_at. */
  subLabel?: string | null
  active: boolean
  onClick: () => void
  live?: boolean
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 10px',
        fontSize: 11,
        fontWeight: 600,
        border: '1px solid',
        borderColor: active ? '#3b82f6' : '#d1d5db',
        background: active ? '#eff6ff' : '#fff',
        color: active ? '#1e40af' : '#555',
        borderRadius: 999,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
      }}
    >
      {live && (
        <span
          aria-label="has live matches"
          style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: '#16a34a',
            boxShadow: '0 0 0 2px rgba(22,163,74,0.2)',
          }}
        />
      )}
      <span>{label}</span>
      {subLabel && (
        <span
          style={{
            fontSize: 10,
            fontWeight: 500,
            // Same hue family as the label but a touch dimmer so the
            // ordinal still leads visually. On the active pill we pull
            // the color slightly lighter (same opacity step) to maintain
            // contrast without competing with the label.
            color: active ? '#3b82f6' : '#9ca3af',
          }}
        >
          · {subLabel}
        </span>
      )}
    </button>
  )
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '5px 12px',
        fontSize: 11,
        fontWeight: 600,
        border: '1px solid',
        borderColor: active ? '#3b82f6' : '#d1d5db',
        background: active ? '#eff6ff' : '#fff',
        color: active ? '#1e40af' : '#555',
        borderRadius: 4,
        cursor: 'pointer',
        textTransform: 'capitalize',
      }}
    >
      {label}
    </button>
  )
}

function StatusPill({ status }: { status: string | null }) {
  if (!status) return <span style={{ fontSize: 10, color: '#999' }}>—</span>
  const map: Record<string, { bg: string; color: string }> = {
    finished: { bg: '#f3f4f6', color: '#4b5563' },
    retired: { bg: '#fef3c7', color: '#92400e' },
    walkover: { bg: '#fef3c7', color: '#92400e' },
    live: { bg: '#dcfce7', color: '#166534' },
    on_court: { bg: '#dbeafe', color: '#1e40af' },
    scheduled: { bg: '#f3f4f6', color: '#6b7280' },
  }
  const s = map[status] ?? { bg: '#f3f4f6', color: '#333' }
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 700,
        padding: '2px 6px',
        borderRadius: 3,
        background: s.bg,
        color: s.color,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}
    >
      {status.replace('_', ' ')}
    </span>
  )
}

function SourcePill({ source }: { source: 'results' | 'oop' | 'both' }) {
  const map: Record<'results' | 'oop' | 'both', { bg: string; color: string; label: string }> = {
    results: { bg: '#dbeafe', color: '#1e40af', label: 'R' },
    oop: { bg: '#fef3c7', color: '#92400e', label: 'O' },
    both: { bg: '#dcfce7', color: '#166534', label: 'R+O' },
  }
  const s = map[source]
  return (
    <span
      title={
        source === 'results'
          ? 'Results snapshot only'
          : source === 'oop'
            ? 'OOP (scheduled) snapshot only'
            : 'Seen in both results and OOP'
      }
      style={{
        fontSize: 9,
        fontWeight: 700,
        padding: '2px 6px',
        borderRadius: 3,
        background: s.bg,
        color: s.color,
      }}
    >
      {s.label}
    </span>
  )
}

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

import { useEffect, useState } from 'react'

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
  tournament: { id: string; name: string } | null
  matches: ExplorerMatch[]
  stats: Stats
  capturedAt: { oop: string | null; results: string | null }
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

export default function TournamentMatchesSubtab({ tournamentId }: { tournamentId: string }) {
  const [data, setData] = useState<MatchesResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filterCategory, setFilterCategory] = useState<'all' | 'men' | 'women'>('all')
  const [filterLinkage, setFilterLinkage] = useState<'all' | 'linked' | 'unlinked'>('all')

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

  const filtered = data.matches.filter((m) => {
    if (filterCategory !== 'all' && m.category !== filterCategory) return false
    if (filterLinkage === 'linked' && m.linkedMatchId === null) return false
    if (filterLinkage === 'unlinked' && m.linkedMatchId !== null) return false
    return true
  })

  const linkedPct = data.stats.total > 0 ? Math.round((data.stats.linked / data.stats.total) * 100) : 0

  return (
    <div>
      {/* Stats + freshness */}
      <div style={{ ...card, display: 'flex', gap: 24, alignItems: 'center', marginBottom: 12 }}>
        <StatTile label="Total" value={data.stats.total} color="#111" />
        <StatTile label="Played" value={data.stats.played} color="#1e40af" />
        <StatTile label="Scheduled" value={data.stats.scheduled} color="#92400e" />
        <StatTile
          label="Linked"
          value={`${data.stats.linked} (${linkedPct}%)`}
          color={linkedPct === 100 ? '#166534' : linkedPct > 50 ? '#1e40af' : '#991b1b'}
        />
        <StatTile
          label="Unlinked"
          value={data.stats.unlinked}
          color={data.stats.unlinked === 0 ? '#999' : '#991b1b'}
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

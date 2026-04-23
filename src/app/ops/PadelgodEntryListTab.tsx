'use client'
// src/app/ops/PadelgodEntryListTab.tsx
//
// Ops view for padelgod.entry_list_snapshots. Read-only dashboard to help
// us decide whether padelgod's entry-list pipeline is complete enough to
// drive match creation (instead of relying on padelapi for that).
//
// Layout:
//   - Tournament picker (dropdown — tournaments with recent snapshots)
//   - Category tabs (Men / Women)
//   - Per-category stats row: resolved / total, with-FIP-id / total
//   - Teams table — seed · player1 · player2 · country · FIP ids · resolution
//
// Colors mirror the Schedule tab's confidence palette so operators can
// pattern-match across the two ops surfaces.

import { useState, useEffect, useCallback } from 'react'

// ── Types mirror the GET response from /api/ops/padelgod-entry-list ─────

type ResolutionMethod = 'fip_id' | 'name_exact' | 'none'

interface EntryPlayer {
  fipId: string | null
  name: string
  country: string | null
  seed: number | null
  partnerFipId: string | null
  partnerName: string | null
  resolvedPlayerId: string | null
  resolvedPlayerName: string | null
  resolutionMethod: ResolutionMethod
}

interface EntryTeam {
  player1: EntryPlayer
  player2: EntryPlayer | null
  seed: number | null
}

interface CategoryBlock {
  category: 'men' | 'women'
  teams: EntryTeam[]
  stats: {
    playersTotal: number
    playersResolved: number
    playersWithFipId: number
    playersMissingFromDb: number
    teamsTotal: number
    teamsFullyResolved: number
  }
}

interface TournamentRef {
  id: string
  name: string
  starts_at: string | null
  ends_at: string | null
  source: string | null
  level: string | null
  country: string | null
  latestSnapshotAt?: string | null
}

interface DetailResponse {
  tournament: TournamentRef
  capturedAt: string | null
  source: string
  categories: CategoryBlock[]
  message?: string
}

// ── Formatters ───────────────────────────────────────────────────────────

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

function resolutionBadge(method: ResolutionMethod) {
  switch (method) {
    case 'fip_id':
      return { label: 'FIP', bg: '#dcfce7', color: '#166534' }
    case 'name_exact':
      return { label: 'NAME', bg: '#dbeafe', color: '#1e40af' }
    case 'none':
      return { label: 'MISSING', bg: '#fee2e2', color: '#991b1b' }
  }
}

// ── Component ────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: 'white',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: 12,
}

/**
 * Props:
 *   - tournamentId?: when provided, the component skips its internal
 *     tournament picker and just renders entry-list detail for that
 *     tournament. Used by the Tournament Explorer tab which owns the
 *     picker at a higher level.
 */
export interface PadelgodEntryListTabProps {
  tournamentId?: string
}

export default function PadelgodEntryListTab({ tournamentId }: PadelgodEntryListTabProps = {}) {
  const embedded = Boolean(tournamentId)

  const [tournaments, setTournaments] = useState<TournamentRef[]>([])
  const [selectedTournamentId, setSelectedTournamentId] = useState<string>(tournamentId ?? '')
  const [detail, setDetail] = useState<DetailResponse | null>(null)
  const [loadingList, setLoadingList] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeCategory, setActiveCategory] = useState<'men' | 'women'>('men')

  // ── Initial fetch: tournament list (standalone only) ──
  useEffect(() => {
    // When embedded, the parent (TournamentExplorer) already picked a
    // tournament — don't query the padelgod list endpoint at all.
    if (embedded) return
    setLoadingList(true)
    setError(null)
    fetch('/api/ops/padelgod-entry-list')
      .then((r) => r.json())
      .then((data: { tournaments?: TournamentRef[]; error?: string }) => {
        if (data.error) {
          setError(data.error)
          return
        }
        const list = data.tournaments ?? []
        setTournaments(list)
        // Auto-select the most recent snapshot so the page isn't empty on load.
        if (list.length > 0 && !selectedTournamentId) {
          setSelectedTournamentId(list[0]!.id)
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load list'))
      .finally(() => setLoadingList(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded])

  // Reflect prop changes when embedded — parent picker drives selection.
  useEffect(() => {
    if (embedded && tournamentId) setSelectedTournamentId(tournamentId)
  }, [embedded, tournamentId])

  // ── Detail fetch whenever selection changes ──
  const fetchDetail = useCallback(
    async (id: string) => {
      if (!id) return
      setLoadingDetail(true)
      setError(null)
      try {
        const res = await fetch(
          `/api/ops/padelgod-entry-list?tournament_id=${id}`,
        )
        const body = (await res.json()) as DetailResponse & { error?: string }
        if (body.error) throw new Error(body.error)
        setDetail(body)
        // If the selected category has no data but the other does, flip.
        const men = body.categories.find((c) => c.category === 'men')
        const women = body.categories.find((c) => c.category === 'women')
        if (activeCategory === 'men' && men && men.teams.length === 0 && women && women.teams.length > 0) {
          setActiveCategory('women')
        } else if (activeCategory === 'women' && women && women.teams.length === 0 && men && men.teams.length > 0) {
          setActiveCategory('men')
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load detail')
        setDetail(null)
      } finally {
        setLoadingDetail(false)
      }
    },
    [activeCategory],
  )

  useEffect(() => {
    if (selectedTournamentId) {
      void fetchDetail(selectedTournamentId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTournamentId])

  // ── Render ──

  const activeBlock = detail?.categories.find((c) => c.category === activeCategory) ?? null

  return (
    <div>
      {!embedded && (
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: '#111' }}>
            Padelgod Entry Lists
          </h2>
          <p style={{ fontSize: 12, color: '#666', marginTop: 4, maxWidth: 680 }}>
            Read-only view of <code style={{ background: '#f3f4f6', padding: '1px 4px', borderRadius: 3 }}>padelgod.entry_list_snapshots</code>.
            Shows what the hourly padelgod entry-list-fetcher captured from
            matchscorerlive.com, with each player resolved against{' '}
            <code style={{ background: '#f3f4f6', padding: '1px 4px', borderRadius: 3 }}>public.players</code>.
            Use this to judge whether padelgod's view is complete enough to
            drive autonomous match creation.
          </p>
        </div>
      )}

      {/* Tournament picker — hidden when embedded (parent owns the picker) */}
      {!embedded && (
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label
                style={{
                  display: 'block',
                  fontSize: 10,
                  fontWeight: 600,
                  color: '#999',
                  textTransform: 'uppercase',
                  marginBottom: 4,
                }}
              >
                Tournament
              </label>
              <select
                value={selectedTournamentId}
                onChange={(e) => setSelectedTournamentId(e.target.value)}
                disabled={loadingList || tournaments.length === 0}
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  fontSize: 13,
                  border: '1px solid #d1d5db',
                  borderRadius: 4,
                  background: '#fff',
                  color: '#333',
                }}
              >
                {tournaments.length === 0 && <option value="">No snapshots found</option>}
                {tournaments.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.starts_at ? ` — ${t.starts_at.slice(0, 10)}` : ''}
                    {t.level ? ` · ${t.level}` : ''}
                  </option>
                ))}
              </select>
            </div>
            {detail?.capturedAt && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#999', textTransform: 'uppercase' }}>
                  Snapshot
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#333' }}>
                  {formatAgo(detail.capturedAt)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Embedded-mode freshness badge — since the parent picker doesn't know
          about per-subtab snapshot freshness, we show it inline. */}
      {embedded && detail?.capturedAt && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, fontSize: 11, color: '#666' }}>
          <span>Entry-list snapshot: <b style={{ color: '#333' }}>{formatAgo(detail.capturedAt)}</b></span>
        </div>
      )}

      {error && (
        <div style={{ ...card, background: '#fee2e2', borderColor: '#fecaca', color: '#991b1b', fontSize: 12, marginBottom: 16 }}>
          ❌ {error}
        </div>
      )}

      {loadingDetail && (
        <div style={{ ...card, color: '#666', fontSize: 12 }}>Loading snapshot…</div>
      )}

      {detail && !loadingDetail && (
        <>
          {/* Category tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
            {(['men', 'women'] as const).map((cat) => {
              const block = detail.categories.find((c) => c.category === cat)
              const count = block?.stats.teamsTotal ?? 0
              const isActive = activeCategory === cat
              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  style={{
                    padding: '6px 14px',
                    fontSize: 12,
                    fontWeight: 600,
                    border: '1px solid',
                    borderColor: isActive ? '#3b82f6' : '#d1d5db',
                    background: isActive ? '#eff6ff' : '#fff',
                    color: isActive ? '#1e40af' : '#555',
                    borderRadius: 4,
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                  }}
                >
                  {cat} <span style={{ opacity: 0.7, fontWeight: 500 }}>({count})</span>
                </button>
              )
            })}
          </div>

          {activeBlock && <CategoryTable block={activeBlock} />}
        </>
      )}
    </div>
  )
}

// ── Per-category stats + teams table ────────────────────────────────────

function CategoryTable({ block }: { block: CategoryBlock }) {
  const { stats, teams, category } = block

  if (teams.length === 0) {
    return (
      <div style={{ ...card, color: '#666', fontSize: 13 }}>
        No {category} entries in this snapshot.
      </div>
    )
  }

  const resolvedPct = stats.playersTotal > 0 ? Math.round((stats.playersResolved / stats.playersTotal) * 100) : 0
  const fipIdPct = stats.playersTotal > 0 ? Math.round((stats.playersWithFipId / stats.playersTotal) * 100) : 0

  return (
    <div>
      {/* Stats bar */}
      <div style={{ ...card, display: 'flex', gap: 24, alignItems: 'center', marginBottom: 12 }}>
        <StatTile label="Teams" value={`${stats.teamsTotal}`} color="#111" />
        <StatTile
          label="Fully Resolved"
          value={`${stats.teamsFullyResolved} / ${stats.teamsTotal}`}
          color={stats.teamsFullyResolved === stats.teamsTotal ? '#166534' : '#92400e'}
        />
        <StatTile label="Players" value={`${stats.playersTotal}`} color="#111" />
        <StatTile
          label="Resolved"
          value={`${stats.playersResolved} (${resolvedPct}%)`}
          color={resolvedPct === 100 ? '#166534' : resolvedPct > 80 ? '#1e40af' : '#92400e'}
        />
        <StatTile
          label="Have FIP ID"
          value={`${stats.playersWithFipId} (${fipIdPct}%)`}
          color={fipIdPct === 100 ? '#166534' : '#92400e'}
        />
        <StatTile
          label="Missing From DB"
          value={`${stats.playersMissingFromDb}`}
          color={stats.playersMissingFromDb === 0 ? '#999' : '#991b1b'}
        />
      </div>

      {/* Teams table */}
      <div style={{ ...card, padding: 0, overflow: 'auto' }}>
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb', background: '#f9fafb' }}>
              <th style={thStyle}>Seed</th>
              <th style={thStyle}>Player 1</th>
              <th style={thStyle}>Player 2</th>
              <th style={thStyle}>Country</th>
              <th style={thStyle}>FIP IDs</th>
              <th style={thStyle}>Resolution</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((t, i) => (
              <tr
                key={i}
                style={{
                  borderBottom: '1px solid #f3f4f6',
                  background: i % 2 === 0 ? '#fff' : '#f9fafb',
                }}
              >
                <td style={tdStyle}>
                  <span
                    style={{
                      fontFamily: 'monospace',
                      fontWeight: 600,
                      color: t.seed ? '#111' : '#999',
                    }}
                  >
                    {t.seed ?? '—'}
                  </span>
                </td>
                <td style={tdStyle}>
                  <PlayerCell p={t.player1} />
                </td>
                <td style={tdStyle}>
                  {t.player2 ? <PlayerCell p={t.player2} /> : <span style={{ color: '#ccc' }}>—</span>}
                </td>
                <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11, color: '#555' }}>
                  {t.player1.country ?? '—'}
                  {t.player2 && t.player2.country !== t.player1.country ? ` / ${t.player2.country ?? '?'}` : ''}
                </td>
                <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 10, color: '#777' }}>
                  {t.player1.fipId ? t.player1.fipId.replace(/^fip-/, '') : '—'}
                  {t.player2 ? ` / ${t.player2.fipId ? t.player2.fipId.replace(/^fip-/, '') : '—'}` : ''}
                </td>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <ResolutionChip p={t.player1} />
                    {t.player2 && <ResolutionChip p={t.player2} />}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PlayerCell({ p }: { p: EntryPlayer }) {
  return (
    <div>
      <div style={{ fontWeight: 500, color: '#111' }}>{p.name}</div>
      {p.resolvedPlayerId && p.resolvedPlayerName && p.resolvedPlayerName !== p.name && (
        <div style={{ fontSize: 10, color: '#666' }}>→ {p.resolvedPlayerName}</div>
      )}
    </div>
  )
}

function ResolutionChip({ p }: { p: EntryPlayer }) {
  const badge = resolutionBadge(p.resolutionMethod)
  return (
    <span
      title={
        p.resolutionMethod === 'fip_id'
          ? `Resolved via FIP id (${p.fipId})`
          : p.resolutionMethod === 'name_exact'
            ? `Resolved via normalized name match (${p.name})`
            : 'Not resolved — not in public.players, or ambiguous match'
      }
      style={{
        fontSize: 9,
        fontWeight: 700,
        padding: '1px 5px',
        borderRadius: 3,
        background: badge.bg,
        color: badge.color,
        letterSpacing: '0.03em',
      }}
    >
      {badge.label}
    </span>
  )
}

function StatTile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#999', fontWeight: 600, textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color }}>{value}</div>
    </div>
  )
}

const thStyle: React.CSSProperties = {
  padding: '6px 10px',
  textAlign: 'left',
  color: '#666',
  fontWeight: 600,
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
}

const tdStyle: React.CSSProperties = {
  padding: '6px 10px',
  color: '#333',
  verticalAlign: 'top',
}

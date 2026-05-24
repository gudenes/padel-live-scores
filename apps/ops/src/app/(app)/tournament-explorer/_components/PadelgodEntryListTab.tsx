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
import { PlayerLink } from '@/components/PlayerLink'

// ── Types mirror the GET response from /api/ops/padelgod-entry-list ─────

type ResolutionMethod = 'fip_id' | 'name_exact' | 'none'
type DrawType = 'main_draw' | 'qualifying'

interface EntryPlayer {
  fipId: string | null
  name: string
  country: string | null
  seed: number | null
  drawType: DrawType
  partnerFipId: string | null
  partnerName: string | null
  resolvedPlayerId: string | null
  resolvedPlayerName: string | null
  resolutionMethod: ResolutionMethod
  // Enrichment fields used by PlayerLink to colour the status dot.
  resolvedAvatarUrl?: string | null
  resolvedRanking?: number | null
  resolvedPadelapiId?: string | null
}

interface EntryTeam {
  player1: EntryPlayer
  player2: EntryPlayer | null
  seed: number | null
  drawType: DrawType
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
  fip_id: string | null
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

// Twin-matcher response — mirrors GET /api/ops/tournament-fip-twin.
interface TwinResponse {
  target?: {
    id: string
    name: string
    fip_id: string | null
  }
  twin: {
    candidate: {
      id: string
      name: string
      slug: string | null
      fip_id: string | null
    }
    confidence: 'high' | 'medium' | 'low'
    matchedTokens: string[]
    reasons: string[]
  } | null
  alreadyLinked?: boolean
  fip_id?: string
  poolSize?: number
  error?: string
}

// Summary the seed endpoint returns — matches POST /api/ops/seed-fip-entry-list
// response shape so the UI can surface what was inserted.
interface SeedResult {
  ok: boolean
  tournament?: { id: string; name: string; fip_id: string }
  scrapeJobId?: string
  playersInserted?: number
  snapshotsInserted?: number
  stats?: {
    dbMatches?: number
    fipSearchMatches?: number
    unresolved?: number
    teamsParsed?: number
    pdfsDownloaded?: number
  }
  unresolved?: Array<{ name: string; category: string; reason: string }>
  pdfUrls?: Record<string, string | null>
  error?: string
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

  // FIP PDF seed state — dormant unless the operator clicks the button.
  // Tracked per-tournament via the active selectedTournamentId, so switching
  // tournaments clears the banner implicitly via the render guards below.
  const [seeding, setSeeding] = useState(false)
  const [seedResult, setSeedResult] = useState<SeedResult | null>(null)

  // FIP twin linker state — used when the tournament has no fip_id but
  // padelgod's tournament-discovery worker captured an orphan twin. We
  // fetch the candidate once per selected tournament; clicking "Link"
  // copies the fip_id onto the target row.
  const [twin, setTwin] = useState<TwinResponse | null>(null)
  const [linking, setLinking] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)

  // ── Initial fetch: tournament list (standalone only) ──
  useEffect(() => {
    // When embedded, the parent (TournamentExplorer) already picked a
    // tournament — don't query the padelgod list endpoint at all.
    if (embedded) return
    setLoadingList(true)
    setError(null)
    fetch('/api/internal/padelgod-entry-list')
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
          `/api/internal/padelgod-entry-list?tournament_id=${id}`,
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
      // Clear any prior seed banner + twin state — both are tied to the
      // previous tournament.
      setSeedResult(null)
      setTwin(null)
      setLinkError(null)
      void fetchDetail(selectedTournamentId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTournamentId])

  // ── Twin lookup — runs once per selected tournament, only when the
  //    canonical row is missing a fip_id (saves a round-trip for the
  //    common "already linked" case). ──
  useEffect(() => {
    if (!selectedTournamentId || !detail) return
    if (detail.tournament?.fip_id) return // already linked, skip
    let cancelled = false
    fetch(`/api/internal/tournament-fip-twin?tournament_id=${selectedTournamentId}`)
      .then((r) => r.json())
      .then((body: TwinResponse) => {
        if (!cancelled) setTwin(body)
      })
      .catch(() => {
        /* silent — twin is a nice-to-have, failure shouldn't block the page */
      })
    return () => {
      cancelled = true
    }
  }, [selectedTournamentId, detail])

  // ── Link action — POST to /api/ops/link-fip-id, refetch on success ──
  const handleLinkFipId = useCallback(async () => {
    if (!selectedTournamentId || !twin?.twin) return
    setLinking(true)
    setLinkError(null)
    try {
      const res = await fetch('/api/internal/link-fip-id', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          targetTournamentId: selectedTournamentId,
          sourceTournamentId: twin.twin.candidate.id,
        }),
      })
      const body = (await res.json()) as { ok?: boolean; error?: string }
      if (!body.ok) {
        setLinkError(body.error ?? 'Link failed')
        return
      }
      // Success — refetch detail so the fip_id appears and the twin
      // banner auto-dismisses.
      setTwin(null)
      await fetchDetail(selectedTournamentId)
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : 'Link request failed')
    } finally {
      setLinking(false)
    }
  }, [selectedTournamentId, twin, fetchDetail])

  // ── FIP PDF seed action ──
  //
  // POSTs to /api/ops/seed-fip-entry-list which runs the pipeline:
  //   event page → PDF urls → parse → resolve via PlayerResolver →
  //   persist to padelgod.entry_list_snapshots with job_type='fip_pdf_entry_list'.
  // After success we refetch the detail so the freshly-imported rows appear
  // in the table immediately.
  const handleSeedFromFip = useCallback(async () => {
    if (!selectedTournamentId) return
    setSeeding(true)
    setSeedResult(null)
    setError(null)
    try {
      const res = await fetch('/api/internal/seed-fip-entry-list', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tournamentId: selectedTournamentId }),
      })
      const body = (await res.json()) as SeedResult
      setSeedResult(body)
      if (body.ok) {
        await fetchDetail(selectedTournamentId)
      }
    } catch (e) {
      setSeedResult({
        ok: false,
        error: e instanceof Error ? e.message : 'Seed request failed',
      })
    } finally {
      setSeeding(false)
    }
  }, [selectedTournamentId, fetchDetail])

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

      {/* ── FIP twin linker banner ──
          When the canonical tournament has no fip_id, but padelgod's
          tournament-discovery worker has captured an orphan FIP row that
          looks like a twin, we surface it here so the operator can link
          with one click. After linking, the fip_id shows up on the
          canonical row and the FIP PDF seed panel below becomes usable. */}
      {detail && !loadingDetail && !detail.tournament?.fip_id && twin?.twin && (
        <FipTwinBanner
          twin={twin.twin}
          linking={linking}
          error={linkError}
          onLink={handleLinkFipId}
        />
      )}

      {/* ── FIP PDF seed panel ──
          Shows when the selected tournament has a fip_id (i.e. we can scrape
          padelfip.com's entry-list PDF). Renders whether or not snapshots
          already exist — operators may want to force-refresh after the FIP
          event page changes. */}
      {detail && !loadingDetail && detail.tournament?.fip_id && (
        <FipSeedPanel
          tournament={detail.tournament}
          hasExistingSnapshot={Boolean(detail.capturedAt)}
          seeding={seeding}
          onSeed={handleSeedFromFip}
          result={seedResult}
        />
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

  // Split teams by draw_type so MD + Q render under separate headers.
  // Backend already sorts MD before Q, so we just partition.
  const mainDrawTeams = teams.filter(t => t.drawType === 'main_draw')
  const qualifyingTeams = teams.filter(t => t.drawType === 'qualifying')

  return (
    <div>
      {/* Stats bar */}
      <div style={{ ...card, display: 'flex', gap: 24, alignItems: 'center', marginBottom: 12 }}>
        <StatTile label="Teams" value={`${stats.teamsTotal}`} color="#111" />
        {qualifyingTeams.length > 0 && (
          <StatTile
            label="MD / Q"
            value={`${mainDrawTeams.length} / ${qualifyingTeams.length}`}
            color="#111"
          />
        )}
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

      {mainDrawTeams.length > 0 && (
        <DrawSection label="Main Draw" teams={mainDrawTeams} />
      )}
      {qualifyingTeams.length > 0 && (
        <DrawSection label="Qualifying" teams={qualifyingTeams} />
      )}
    </div>
  )
}

function DrawSection({ label, teams }: { label: string; teams: EntryTeam[] }) {
  const isMain = label === 'Main Draw'
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        display: 'inline-block',
        marginBottom: 6,
        padding: '3px 10px',
        fontSize: 11,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
        background: isMain ? '#d1fae5' : '#fef3c7',
        color: isMain ? '#065f46' : '#92400e',
        borderRadius: 4,
      }}>
        {label} · {teams.length} {teams.length === 1 ? 'team' : 'teams'}
      </div>
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
                  {t.player2 ? ` / ${t.player2.country ?? '—'}` : ''}
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
      <div style={{ fontWeight: 500, color: '#111' }}>
        <PlayerLink
          player={{
            id: p.resolvedPlayerId,
            name: p.resolvedPlayerName ?? p.name,
            avatar_url: p.resolvedAvatarUrl ?? null,
            ranking: p.resolvedRanking ?? null,
            padelapi_id: p.resolvedPadelapiId ?? null,
            fip_id: p.fipId,
          }}
        />
      </div>
      {p.resolvedPlayerId && p.resolvedPlayerName && p.resolvedPlayerName !== p.name && (
        <div style={{ fontSize: 10, color: '#666' }}>(scraped as: {p.name})</div>
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

// ── FIP twin linker banner ─────────────────────────────────────────────
// Shown ABOVE the seed panel when the canonical tournament has no fip_id
// but padelgod's tournament-discovery worker has already captured a
// matching padelfip.com event as a separate row. One click copies
// fip_id + slug onto the canonical row so the seed panel becomes usable.

function FipTwinBanner({
  twin,
  linking,
  error,
  onLink,
}: {
  twin: NonNullable<TwinResponse['twin']>
  linking: boolean
  error: string | null
  onLink: () => void
}) {
  const confidenceColor =
    twin.confidence === 'high'
      ? { bg: '#ecfdf5', border: '#a7f3d0', pill: '#065f46', pillBg: '#d1fae5' }
      : twin.confidence === 'medium'
        ? { bg: '#eff6ff', border: '#bfdbfe', pill: '#1e40af', pillBg: '#dbeafe' }
        : { bg: '#fffbeb', border: '#fde68a', pill: '#92400e', pillBg: '#fef3c7' }

  return (
    <div
      style={{
        background: confidenceColor.bg,
        border: `1px solid ${confidenceColor.border}`,
        borderRadius: 8,
        padding: 14,
        marginBottom: 12,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>
              🔗 FIP ID available from padelgod discovery
            </span>
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: confidenceColor.pill,
                background: confidenceColor.pillBg,
                padding: '2px 6px',
                borderRadius: 3,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              {twin.confidence} confidence
            </span>
          </div>
          <div style={{ fontSize: 11, color: '#444', lineHeight: 1.5 }}>
            Padelgod&apos;s tournament-discovery worker captured this event on
            padelfip.com as{' '}
            <code style={{ background: '#fff', padding: '1px 5px', borderRadius: 3, border: '1px solid #eee' }}>
              {twin.candidate.fip_id}
            </code>
            {' '}(
            <a
              href={`https://www.padelfip.com/events/${twin.candidate.slug ?? twin.candidate.fip_id}/`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#3b82f6', textDecoration: 'underline' }}
            >
              padelfip.com ↗
            </a>
            ) but the FIP id isn&apos;t linked to this tournament row yet. Linking enables the FIP PDF entry-list seeding below.
          </div>
          <div style={{ fontSize: 10, color: '#666', marginTop: 6, fontFamily: 'monospace' }}>
            Matched on: {twin.reasons.join(' · ')}
          </div>
          <div style={{ fontSize: 10, color: '#666', marginTop: 4, fontStyle: 'italic' }}>
            Linking will clear the orphan row&apos;s fip_id + slug (releases UNIQUE
            constraint) then copy them here. Non-atomic but safe to retry.
          </div>
        </div>
        <div style={{ flexShrink: 0 }}>
          <button
            onClick={onLink}
            disabled={linking}
            style={{
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: 700,
              background: linking ? '#d1d5db' : '#111',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: linking ? 'wait' : 'pointer',
            }}
          >
            {linking ? 'Linking…' : 'Link fip_id'}
          </button>
        </div>
      </div>
      {error && (
        <div style={{ marginTop: 10, padding: 8, background: '#fee2e2', border: '1px solid #fecaca', borderRadius: 4, fontSize: 11, color: '#991b1b' }}>
          ❌ {error}
        </div>
      )}
    </div>
  )
}

// ── FIP PDF seed panel ─────────────────────────────────────────────────
// Rendered when the selected tournament has a `fip_id`. Gives the operator
// a one-click action to run /api/ops/seed-fip-entry-list — useful for:
//   1. FIP-only tournaments with no Crionet entry list published
//      (e.g. FIP BRONZE IJUÍ, 2026-04-21 test case)
//   2. Tournaments where Crionet's widget still says "Entry list coming
//      soon" but padelfip.com already has the PDF published
//   3. Force-refreshing after the FIP page publishes an updated PDF
//
// The panel is deliberately loud when there's NO existing snapshot (primary
// CTA button with an explainer), and subdued when snapshots already exist
// (small "Re-seed from FIP PDF" link).

function FipSeedPanel({
  tournament,
  hasExistingSnapshot,
  seeding,
  onSeed,
  result,
}: {
  tournament: { id: string; name: string; fip_id: string | null }
  hasExistingSnapshot: boolean
  seeding: boolean
  onSeed: () => void
  result: SeedResult | null
}) {
  const [expanded, setExpanded] = useState(!hasExistingSnapshot)

  // Compact "already have data" mode — show a single-line link that
  // expands on click. Operators rarely need to re-seed, so this keeps
  // the common path quiet.
  if (!expanded) {
    return (
      <div style={{ marginBottom: 12, fontSize: 11, color: '#666' }}>
        FIP id detected (<code style={{ background: '#f3f4f6', padding: '1px 4px', borderRadius: 3 }}>{tournament.fip_id}</code>){' '}
        —{' '}
        <button
          onClick={() => setExpanded(true)}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            color: '#3b82f6',
            fontSize: 11,
            cursor: 'pointer',
            textDecoration: 'underline',
          }}
        >
          re-seed from FIP PDF
        </button>
      </div>
    )
  }

  return (
    <div
      style={{
        background: '#fffbeb',
        border: '1px solid #fde68a',
        borderRadius: 8,
        padding: 14,
        marginBottom: 12,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#92400e', marginBottom: 4 }}>
            {hasExistingSnapshot ? 'Re-seed entry list from FIP PDF' : 'No entry list yet — seed from FIP PDF?'}
          </div>
          <div style={{ fontSize: 11, color: '#78350f', lineHeight: 1.5 }}>
            This tournament has a FIP id (<code style={{ background: '#fef3c7', padding: '1px 4px', borderRadius: 3 }}>{tournament.fip_id}</code>),
            so we can scrape the entry-list PDF from padelfip.com and write
            it into <code style={{ background: '#fef3c7', padding: '1px 4px', borderRadius: 3 }}>padelgod.entry_list_snapshots</code> directly.
            Useful when Crionet&apos;s widget returns &quot;Entry list coming soon&quot; but padelfip.com already has the PDF published.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button
            onClick={onSeed}
            disabled={seeding}
            style={{
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: 700,
              background: seeding ? '#fde68a' : '#f59e0b',
              color: seeding ? '#92400e' : '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: seeding ? 'wait' : 'pointer',
            }}
          >
            {seeding ? 'Scraping PDF…' : hasExistingSnapshot ? 'Re-seed' : 'Seed from FIP PDF'}
          </button>
          {hasExistingSnapshot && !seeding && (
            <button
              onClick={() => setExpanded(false)}
              style={{
                padding: '6px 10px',
                fontSize: 12,
                background: 'transparent',
                color: '#92400e',
                border: '1px solid #fde68a',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Result banner — persists until the next tournament switch */}
      {result && (
        <div
          style={{
            marginTop: 12,
            padding: 10,
            borderRadius: 6,
            fontSize: 11,
            background: result.ok ? '#ecfdf5' : '#fee2e2',
            border: `1px solid ${result.ok ? '#a7f3d0' : '#fecaca'}`,
            color: result.ok ? '#065f46' : '#991b1b',
          }}
        >
          {result.ok ? (
            <>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>
                ✅ Seeded {result.snapshotsInserted ?? 0} entry-list rows
                {result.playersInserted ? ` · ${result.playersInserted} new players created` : ''}
              </div>
              {result.stats && (
                <div style={{ color: '#065f46', fontSize: 10 }}>
                  Teams parsed: {result.stats.teamsParsed ?? 0}
                  {' · '}DB matches: {result.stats.dbMatches ?? 0}
                  {' · '}FIP-search matches: {result.stats.fipSearchMatches ?? 0}
                  {' · '}Unresolved: {result.stats.unresolved ?? 0}
                  {' · '}PDFs: {result.stats.pdfsDownloaded ?? 0}
                </div>
              )}
              {result.unresolved && result.unresolved.length > 0 && (
                <details style={{ marginTop: 6 }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                    {result.unresolved.length} unresolved — click to view
                  </summary>
                  <ul style={{ marginTop: 4, paddingLeft: 16 }}>
                    {result.unresolved.map((u, i) => (
                      <li key={i}>
                        <span style={{ textTransform: 'capitalize' }}>{u.category}</span>:{' '}
                        <b>{u.name}</b> <span style={{ color: '#666' }}>({u.reason})</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          ) : (
            <div>
              <div style={{ fontWeight: 700, marginBottom: 2 }}>❌ Seed failed</div>
              <div style={{ fontFamily: 'monospace', fontSize: 10 }}>{result.error ?? 'unknown error'}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

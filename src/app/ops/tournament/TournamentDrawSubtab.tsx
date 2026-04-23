'use client'
// src/app/ops/tournament/TournamentDrawSubtab.tsx
//
// Draw subtab of the Tournament Explorer. Renders every bracket padelgod
// has captured for a tournament, grouped by (category, draw_type) and
// ordered by round. Within a round each draw_position is a row.
//
// This is a READ-ONLY surface — no seeding edits, no resolution actions.
// The goal is to verify that the draw-fetcher captured the bracket end-
// to-end before we use it as a source of truth for match creation.

import { useEffect, useState } from 'react'

// ── Types (mirror /api/ops/tournament-draw response) ────────────────────

type Category = 'men' | 'women'
type DrawType = 'main_draw' | 'qualifying'

interface DrawMatch {
  drawPosition: number | null
  roundLabel: string | null
  team1Player1Name: string | null
  team1Player2Name: string | null
  team1Country: string | null
  team1Seed: number | null
  team2Player1Name: string | null
  team2Player2Name: string | null
  team2Country: string | null
  team2Seed: number | null
  setScores: unknown | null
  winnerTeam: number | null
  status: string | null
}

interface DrawBlock {
  category: Category
  drawType: DrawType
  rounds: Array<{ roundLabel: string; matches: DrawMatch[] }>
  capturedAt: string | null
  total: number
}

interface DrawResponse {
  tournament: { id: string; name: string } | null
  blocks: DrawBlock[]
  capturedAt: string | null
  error?: string
}

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
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function blockKey(b: DrawBlock): string {
  return `${b.category}::${b.drawType}`
}

function blockLabel(b: DrawBlock): string {
  const cat = b.category === 'men' ? 'Men' : 'Women'
  const type = b.drawType === 'main_draw' ? 'Main Draw' : 'Qualifying'
  return `${cat} · ${type}`
}

function renderTeam(p1: string | null, p2: string | null): string {
  if (p1 && p2) return `${p1} / ${p2}`
  return p1 ?? p2 ?? '—'
}

function renderSetScores(raw: unknown): string {
  if (!raw) return '—'
  if (Array.isArray(raw)) {
    return raw.map((s) => (Array.isArray(s) ? s.join('-') : String(s))).join(' ')
  }
  if (typeof raw === 'string') return raw
  return JSON.stringify(raw)
}

// ── Component ───────────────────────────────────────────────────────────

export default function TournamentDrawSubtab({ tournamentId }: { tournamentId: string }) {
  const [data, setData] = useState<DrawResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeBlockKey, setActiveBlockKey] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/ops/tournament-draw?tournament_id=${tournamentId}`)
      .then((r) => r.json())
      .then((body: DrawResponse) => {
        if (body.error) {
          setError(body.error)
          setData(null)
          return
        }
        setData(body)
        // Default to first block with content.
        if (body.blocks.length > 0) {
          setActiveBlockKey(blockKey(body.blocks[0]!))
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load draw'))
      .finally(() => setLoading(false))
  }, [tournamentId])

  if (loading) return <div style={{ ...card, color: '#666', fontSize: 12 }}>Loading draw…</div>
  if (error) {
    return (
      <div style={{ ...card, background: '#fee2e2', borderColor: '#fecaca', color: '#991b1b', fontSize: 12 }}>
        ❌ {error}
      </div>
    )
  }
  if (!data) return null
  if (data.blocks.length === 0) {
    return (
      <div style={{ ...card, color: '#666', fontSize: 12 }}>
        No draw snapshots captured for this tournament yet. The
        draw-fetcher runs hourly against active tournaments; if a draw
        was just published it may take up to an hour to appear.
      </div>
    )
  }

  const activeBlock = data.blocks.find((b) => blockKey(b) === activeBlockKey) ?? data.blocks[0]!

  return (
    <div>
      {/* Block tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
        {data.blocks.map((b) => {
          const isActive = blockKey(b) === blockKey(activeBlock)
          return (
            <button
              key={blockKey(b)}
              onClick={() => setActiveBlockKey(blockKey(b))}
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
              }}
            >
              {blockLabel(b)} <span style={{ opacity: 0.7, fontWeight: 500 }}>({b.total})</span>
            </button>
          )
        })}
      </div>

      {/* Overall freshness */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 12, fontSize: 11, color: '#666' }}>
        <span>Snapshot: <b style={{ color: '#333' }}>{formatAgo(data.capturedAt)}</b></span>
        <span>Total matches across all blocks: {data.blocks.reduce((s, b) => s + b.total, 0)}</span>
      </div>

      {/* Rounds */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {activeBlock.rounds.map((round) => (
          <div key={round.roundLabel} style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>
                {round.roundLabel || 'Unlabeled round'}
              </div>
              <div style={{ fontSize: 11, color: '#999' }}>{round.matches.length} matches</div>
            </div>
            <div style={{ overflow: 'auto' }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <th style={thSmall}>Pos</th>
                    <th style={thSmall}>Seed 1</th>
                    <th style={thSmall}>Team 1</th>
                    <th style={thSmall}>Seed 2</th>
                    <th style={thSmall}>Team 2</th>
                    <th style={thSmall}>Score</th>
                    <th style={thSmall}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {round.matches.map((m, i) => {
                    const w1: React.CSSProperties = m.winnerTeam === 1 ? { fontWeight: 700, color: '#111' } : {}
                    const w2: React.CSSProperties = m.winnerTeam === 2 ? { fontWeight: 700, color: '#111' } : {}
                    return (
                      <tr
                        key={(m.drawPosition ?? i) + ':' + i}
                        style={{
                          borderBottom: '1px solid #f3f4f6',
                        }}
                      >
                        <td style={{ ...tdSmall, fontFamily: 'monospace', color: '#666' }}>
                          {m.drawPosition ?? '—'}
                        </td>
                        <td style={{ ...tdSmall, textAlign: 'center', color: '#666', fontSize: 10 }}>
                          {m.team1Seed ?? '—'}
                        </td>
                        <td style={{ ...tdSmall, ...w1 }}>
                          {renderTeam(m.team1Player1Name, m.team1Player2Name)}
                          {m.team1Country && (
                            <span style={{ fontSize: 10, color: '#888', marginLeft: 6 }}>({m.team1Country})</span>
                          )}
                        </td>
                        <td style={{ ...tdSmall, textAlign: 'center', color: '#666', fontSize: 10 }}>
                          {m.team2Seed ?? '—'}
                        </td>
                        <td style={{ ...tdSmall, ...w2 }}>
                          {renderTeam(m.team2Player1Name, m.team2Player2Name)}
                          {m.team2Country && (
                            <span style={{ fontSize: 10, color: '#888', marginLeft: 6 }}>({m.team2Country})</span>
                          )}
                        </td>
                        <td style={{ ...tdSmall, fontFamily: 'monospace', fontSize: 11 }}>
                          {renderSetScores(m.setScores)}
                        </td>
                        <td style={tdSmall}>
                          <StatusPill status={m.status} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Small atoms ─────────────────────────────────────────────────────────

function StatusPill({ status }: { status: string | null }) {
  if (!status) return <span style={{ fontSize: 10, color: '#999' }}>—</span>
  const map: Record<string, { bg: string; color: string }> = {
    finished: { bg: '#f3f4f6', color: '#4b5563' },
    retired: { bg: '#fef3c7', color: '#92400e' },
    walkover: { bg: '#fef3c7', color: '#92400e' },
    live: { bg: '#dcfce7', color: '#166534' },
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
      {status}
    </span>
  )
}

const thSmall: React.CSSProperties = {
  padding: '5px 8px',
  textAlign: 'left',
  color: '#666',
  fontWeight: 600,
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
}

const tdSmall: React.CSSProperties = {
  padding: '5px 8px',
  color: '#333',
  verticalAlign: 'top',
}

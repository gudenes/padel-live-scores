'use client'

import { useState, useEffect, useCallback } from 'react'
import ShadowMatchCard from '@/components/ShadowMatchCard'
import PointLog from '@/components/PointLog'
import type { LiveCardsResponse } from '@/lib/padelgod-live-cards'

interface HealthData {
  enrolledCount: number
  livePollSuccessPct: number | null
  unresolvedCount: number
  finalStateMatchPct: number | null
  perPointMatchPct: number | null
  latencyMedianMs: number | null
  latencyP95Ms: number | null
}

interface EnrollmentRow {
  tournament_id: string
  name: string
  starts_at: string | null
  category: string | null
  level: string | null
  live_source: string
  shadow_enabled: boolean
  cutover_ready: boolean
}

interface DivergenceRow {
  id: string
  match_id: string
  comparison_type: string
  computed_at: string
  padelapi_winner_pair: number | null
  padelgod_winner_pair: number | null
  winner_match: boolean | null
  padelapi_final_score: string | null
  padelgod_final_score: string | null
  score_match: boolean | null
  latency_delta_ms: number | null
  padelapi_point_count: number | null
  padelgod_point_count: number | null
  point_sequence_match: boolean | null
  first_divergence_index: number | null
  first_divergence_detail: string | null
  divergence_reason: string | null
}

interface LiveRow {
  match_id: string
  status: string
  round: string | null
  players: Array<string | null>
  publicSetScore: string | null
  publicUpdatedAt: string | null
  shadowSetScore: string | null
  shadowUpdatedAt: string | null
  latencyMs: number | null
  agreement: boolean
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) {
      console.error(`[PadelgodShadow] ${url} → ${res.status}`)
      return null
    }
    return (await res.json()) as T
  } catch (err) {
    console.error(`[PadelgodShadow] ${url} threw:`, err)
    return null
  }
}

export default function PadelgodShadowTab() {
  const [health, setHealth] = useState<HealthData | null>(null)
  const [enrollments, setEnrollments] = useState<EnrollmentRow[] | null>(null)
  const [selectedTournamentId, setSelectedTournamentId] = useState<string | null>(null)
  const [liveCards, setLiveCards] = useState<LiveCardsResponse | null>(null)

  const refreshHealth = useCallback(async () => {
    const data = await fetchJson<HealthData>('/api/ops/padelgod-shadow/health')
    if (data) setHealth(data)
  }, [])

  const refreshEnrollments = useCallback(async () => {
    const data = await fetchJson<EnrollmentRow[]>('/api/ops/padelgod-shadow/enrollments')
    if (data) setEnrollments(data)
  }, [])

  useEffect(() => {
    refreshHealth()
    refreshEnrollments()
    const healthTimer = setInterval(refreshHealth, 30_000)
    const enrollmentsTimer = setInterval(refreshEnrollments, 60_000)
    return () => {
      clearInterval(healthTimer)
      clearInterval(enrollmentsTimer)
    }
  }, [refreshHealth, refreshEnrollments])

  useEffect(() => {
    let cancelled = false
    async function tick() {
      const res = await fetchJson<LiveCardsResponse>(
        '/api/padelgod-shadow/live-cards?scope=live%2Bnext%2Brecent'
      )
      if (!cancelled && res) setLiveCards(res)
    }
    tick()
    const t = window.setInterval(tick, 5_000)
    return () => {
      cancelled = true
      window.clearInterval(t)
    }
  }, [])

  async function handleAction(tournament_id: string, action: 'enroll' | 'unenroll' | 'cutover') {
    if (action === 'cutover') {
      if (!confirm('Cut over this tournament to Padelgod as canonical? Rollback via Unenroll.')) return
    }
    const res = await fetch('/api/ops/padelgod-shadow/enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tournament_id, action }),
    })
    if (!res.ok) {
      const err = await res.text()
      alert(`Action failed: ${err}`)
      return
    }
    refreshEnrollments()
    refreshHealth()
  }

  return (
    <div>
      {/* ── Section 1: Health cards ── */}
      <div style={{ fontSize: 13, fontWeight: 600, color: '#666', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Health (7d / 24h)
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 32 }}>
        <HealthCard label="Enrolled" value={health?.enrolledCount ?? '—'} />
        <HealthCard
          label="Live-poll success (24h)"
          value={fmtPct(health?.livePollSuccessPct)}
          danger={health?.livePollSuccessPct != null && health.livePollSuccessPct < 99}
        />
        <HealthCard
          label="Unresolved names"
          value={health?.unresolvedCount ?? '—'}
          danger={(health?.unresolvedCount ?? 0) > 5}
        />
        <HealthCard
          label="Final score match (7d)"
          value={fmtPct(health?.finalStateMatchPct)}
          danger={health?.finalStateMatchPct != null && health.finalStateMatchPct < 100}
        />
        <HealthCard
          label="Per-point match (7d)"
          value={fmtPct(health?.perPointMatchPct)}
          danger={health?.perPointMatchPct != null && health.perPointMatchPct < 95}
        />
        <HealthCard
          label="Latency median (24h)"
          value={fmtMs(health?.latencyMedianMs)}
          danger={(health?.latencyMedianMs ?? 0) > 0}
        />
        <HealthCard
          label="Latency p95 (24h)"
          value={fmtMs(health?.latencyP95Ms)}
          danger={(health?.latencyP95Ms ?? 0) > 3000}
        />
      </div>

      {/* ── Section 2: Enrollment table ── */}
      <div style={{ fontSize: 13, fontWeight: 600, color: '#666', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Enrollment
      </div>
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', marginBottom: 32 }}>
        {enrollments === null ? (
          <div style={{ padding: 16, color: '#666', fontSize: 13 }}>Loading...</div>
        ) : enrollments.length === 0 ? (
          <div style={{ padding: 16, color: '#666', fontSize: 13 }}>No tournaments in the ±1d window with a cached widget code.</div>
        ) : (
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                <Th>Name</Th>
                <Th>Starts</Th>
                <Th>Category</Th>
                <Th>Level</Th>
                <Th>live_source</Th>
                <Th>shadow</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {enrollments.map((t) => (
                <tr
                  key={t.tournament_id}
                  style={{
                    borderBottom: '1px solid #f0f0f0',
                    cursor: 'pointer',
                    background: selectedTournamentId === t.tournament_id ? '#f0f7ff' : 'transparent',
                  }}
                  onClick={() => setSelectedTournamentId(t.tournament_id === selectedTournamentId ? null : t.tournament_id)}
                >
                  <Td>{t.name}</Td>
                  <Td>{t.starts_at ? new Date(t.starts_at).toLocaleDateString() : '—'}</Td>
                  <Td>{t.category ?? '—'}</Td>
                  <Td>{t.level ?? '—'}</Td>
                  <Td><code style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>{t.live_source}</code></Td>
                  <Td>{t.shadow_enabled ? '✓' : ''}</Td>
                  <td style={{ padding: '8px 12px' }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {!t.shadow_enabled && t.live_source === 'padelapi' && (
                        <ActionButton onClick={() => handleAction(t.tournament_id, 'enroll')} color="#2563eb">Enroll</ActionButton>
                      )}
                      {t.shadow_enabled && (
                        <ActionButton onClick={() => handleAction(t.tournament_id, 'unenroll')} color="#666">Unenroll</ActionButton>
                      )}
                      {t.shadow_enabled && (
                        <ActionButton
                          onClick={() => handleAction(t.tournament_id, 'cutover')}
                          color={t.cutover_ready ? '#22c55e' : '#ccc'}
                          disabled={!t.cutover_ready}
                          title={t.cutover_ready ? 'All criteria met' : 'Criteria not yet met (≥5 matches + 100% final + 95% per-point + low latency + no recent errors)'}
                        >
                          Cutover
                        </ActionButton>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Live cards (padelgod-only, replicated MatchCard look) */}
      <div style={{ marginTop: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 14, color: '#111', fontWeight: 700 }}>
            Live cards
          </h3>
          <a
            href="/x/live-preview"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 11,
              color: '#3b82f6',
              textDecoration: 'none',
              padding: '4px 10px',
              border: '1px solid #3b82f6',
              borderRadius: 4,
              fontWeight: 600,
            }}
          >
            Preview live UI ↗
          </a>
        </div>

        {liveCards && liveCards.matches.length === 0 && (
          <div style={{ color: '#666', fontSize: 12, padding: 16, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 }}>
            No matches in the live / next-up / recent buckets for shadow-enabled tournaments.
          </div>
        )}

        {liveCards?.matches.map(card => (
          <div key={card.id}>
            <ShadowMatchCard card={card} observedAt={liveCards.observedAt}>
              <PointLog points={card.points} collapsible={false} />
            </ShadowMatchCard>
          </div>
        ))}
      </div>

      {/* ── Section 3: Per-tournament drilldown ── */}
      {selectedTournamentId && <DrilldownSection tournamentId={selectedTournamentId} />}
    </div>
  )
}

// ── Drilldown subcomponent ───────────────────────────────────────────

function DrilldownSection({ tournamentId }: { tournamentId: string }) {
  const [live, setLive] = useState<LiveRow[] | null>(null)
  const [finals, setFinals] = useState<DivergenceRow[] | null>(null)
  const [perPoints, setPerPoints] = useState<DivergenceRow[] | null>(null)

  useEffect(() => {
    // Reset state on tournament change
    setLive(null)
    setFinals(null)
    setPerPoints(null)

    const refresh = async () => {
      const [liveData, finalsData, perPointsData] = await Promise.all([
        fetchJson<LiveRow[]>(`/api/ops/padelgod-shadow/live?tournament_id=${tournamentId}`),
        fetchJson<DivergenceRow[]>(`/api/ops/padelgod-shadow/divergences?tournament_id=${tournamentId}&type=final_state&limit=50`),
        fetchJson<DivergenceRow[]>(`/api/ops/padelgod-shadow/divergences?tournament_id=${tournamentId}&type=per_point_sequence&limit=50`),
      ])
      if (liveData) setLive(liveData)
      if (finalsData) setFinals(finalsData)
      if (perPointsData) setPerPoints(perPointsData)
    }

    refresh()
    const timer = setInterval(refresh, 30_000)
    return () => clearInterval(timer)
  }, [tournamentId])

  const perPointByMatchId = new Map((perPoints ?? []).map((p) => [p.match_id, p]))

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#666', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Tournament detail
      </div>

      {/* Live matches */}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ padding: 12, background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontSize: 13, fontWeight: 600 }}>
          Live matches (30s refresh)
        </div>
        {live === null ? (
          <div style={{ padding: 16, color: '#666', fontSize: 13 }}>Loading...</div>
        ) : live.length === 0 ? (
          <div style={{ padding: 16, color: '#666', fontSize: 13 }}>No live matches right now.</div>
        ) : (
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                <Th>Match</Th>
                <Th>padelapi</Th>
                <Th>padelgod</Th>
                <Th>Δms</Th>
                <Th>Agree</Th>
              </tr>
            </thead>
            <tbody>
              {live.map((r) => (
                <tr key={r.match_id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <Td>{r.players.filter(Boolean).join(', ') || r.match_id.slice(0, 8)}</Td>
                  <Td><code style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 4 }}>{r.publicSetScore ?? '—'}</code></Td>
                  <Td><code style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 4 }}>{r.shadowSetScore ?? '—'}</code></Td>
                  <Td>{r.latencyMs ?? '—'}</Td>
                  <Td style={{ color: r.agreement ? '#22c55e' : '#ef4444' }}>{r.agreement ? '✓' : '✗'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Final-state history */}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ padding: 12, background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontSize: 13, fontWeight: 600 }}>
          Final-state history (last 50)
        </div>
        {finals === null ? (
          <div style={{ padding: 16, color: '#666', fontSize: 13 }}>Loading...</div>
        ) : finals.length === 0 ? (
          <div style={{ padding: 16, color: '#666', fontSize: 13 }}>No finished matches with diff rows yet.</div>
        ) : (
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                <Th>Match</Th>
                <Th>Winner</Th>
                <Th>padelapi</Th>
                <Th>padelgod</Th>
                <Th>Per-point</Th>
                <Th>Divergence</Th>
              </tr>
            </thead>
            <tbody>
              {finals.map((d) => {
                const perPoint = perPointByMatchId.get(d.match_id)
                const perPointCell = perPoint == null
                  ? '—'
                  : perPoint.point_sequence_match
                    ? '✓'
                    : `✗ @${perPoint.first_divergence_index ?? '?'}`
                return (
                  <tr key={d.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <Td>{d.match_id.slice(0, 8)}</Td>
                    <Td style={{ color: d.winner_match ? '#22c55e' : '#ef4444' }}>{d.winner_match ? '✓' : '✗'}</Td>
                    <Td><code style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 4 }}>{d.padelapi_final_score ?? '—'}</code></Td>
                    <Td><code style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 4 }}>{d.padelgod_final_score ?? '—'}</code></Td>
                    <Td style={{ color: perPoint?.point_sequence_match ? '#22c55e' : perPoint ? '#ef4444' : '#666' }}>{perPointCell}</Td>
                    <Td style={{ color: '#666', fontSize: 11 }}>{d.divergence_reason ?? ''}</Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ── UI helpers ────────────────────────────────────────────────────────

function HealthCard({ label, value, danger = false }: { label: string; value: string | number; danger?: boolean }) {
  return (
    <div style={{
      background: '#fff',
      border: danger ? '1px solid #fca5a5' : '1px solid #e5e7eb',
      borderRadius: 8,
      padding: 12,
    }}>
      <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: danger ? '#dc2626' : '#111' }}>{value}</div>
    </div>
  )
}

function ActionButton({ onClick, color, children, disabled = false, title }: {
  onClick: () => void
  color: string
  children: React.ReactNode
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        padding: '4px 10px',
        fontSize: 12,
        fontWeight: 600,
        color: disabled ? '#999' : '#fff',
        background: disabled ? '#f3f4f6' : color,
        border: 'none',
        borderRadius: 4,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>
      {children}
    </th>
  )
}

function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <td style={{ padding: '8px 12px', fontSize: 13, color: '#111', ...style }}>
      {children}
    </td>
  )
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—'
  return `${n.toFixed(1)}%`
}

function fmtMs(n: number | null | undefined): string {
  if (n == null) return '—'
  const sign = n > 0 ? '+' : ''
  return `${sign}${Math.round(n)}ms`
}

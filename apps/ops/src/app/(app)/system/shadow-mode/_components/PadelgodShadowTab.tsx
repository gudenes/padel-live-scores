'use client'

import { useState, useEffect, useCallback } from 'react'
import ShadowMatchCard from '@/components/ShadowMatchCard'
import PointLog from '@/components/PointLog'
import { PageHeader, Section, DataTable, EmptyState, Button } from '@/components/ui'
import { LIVE_CARDS_POLL_MS, type LiveCardsResponse } from '@/lib/padelgod-live-cards'

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
      console.error(`[PadelgodShadow] ${url} -> ${res.status}`)
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
    const data = await fetchJson<HealthData>('/api/internal/padelgod-shadow/health')
    if (data) setHealth(data)
  }, [])

  const refreshEnrollments = useCallback(async () => {
    const data = await fetchJson<EnrollmentRow[]>('/api/internal/padelgod-shadow/enrollments')
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
        '/api/internal/padelgod-shadow/live-cards?scope=live%2Bnext%2Brecent'
      )
      if (!cancelled && res) setLiveCards(res)
    }
    tick()
    const t = window.setInterval(tick, LIVE_CARDS_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(t)
    }
  }, [])

  async function handleAction(tournament_id: string, action: 'enroll' | 'unenroll' | 'cutover') {
    if (action === 'cutover') {
      if (!confirm('Cut over this tournament to Padelgod as canonical? Rollback via Unenroll.')) return
    }
    const res = await fetch('/api/internal/padelgod-shadow/enroll', {
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
    <div className="ui-page">
      <PageHeader title="Shadow Mode" />

      {/* Section 1: Health cards */}
      <Section label="Health (7d / 24h)">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
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
      </Section>

      {/* Section 2: Enrollment table */}
      <Section label="Enrollment">
        {enrollments === null ? (
          <EmptyState title="Loading..." />
        ) : enrollments.length === 0 ? (
          <EmptyState title="No tournaments in the ±1d window with a cached widget code." />
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th>Name</th>
                <th>Starts</th>
                <th>Category</th>
                <th>Level</th>
                <th>live_source</th>
                <th>shadow</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {enrollments.map((t) => (
                <tr
                  key={t.tournament_id}
                  style={{
                    cursor: 'pointer',
                    background: selectedTournamentId === t.tournament_id ? 'var(--bg-sel)' : undefined,
                  }}
                  onClick={() => setSelectedTournamentId(t.tournament_id === selectedTournamentId ? null : t.tournament_id)}
                >
                  <td>{t.name}</td>
                  <td>{t.starts_at ? new Date(t.starts_at).toLocaleDateString() : '—'}</td>
                  <td>{t.category ?? '—'}</td>
                  <td>{t.level ?? '—'}</td>
                  <td><code style={{ background: 'var(--bg-card-2)', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>{t.live_source}</code></td>
                  <td>{t.shadow_enabled ? 'yes' : ''}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {!t.shadow_enabled && t.live_source === 'padelapi' && (
                        <Button size="sm" variant="primary" onClick={() => handleAction(t.tournament_id, 'enroll')}>Enroll</Button>
                      )}
                      {t.shadow_enabled && (
                        <Button size="sm" onClick={() => handleAction(t.tournament_id, 'unenroll')}>Unenroll</Button>
                      )}
                      {t.shadow_enabled && (
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => handleAction(t.tournament_id, 'cutover')}
                          disabled={!t.cutover_ready}
                          title={t.cutover_ready ? 'All criteria met' : 'Criteria not yet met (>=5 matches + 100% final + 95% per-point + low latency + no recent errors)'}
                        >
                          Cutover
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Section>

      {/* Live cards (padelgod-only, replicated MatchCard look) */}
      <Section
        label="Live cards"
        actions={
          <a
            href="/x/live-preview"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 11,
              color: 'var(--men)',
              textDecoration: 'none',
              padding: '4px 10px',
              border: '1px solid var(--men-border)',
              borderRadius: 4,
              fontWeight: 600,
            }}
          >
            Preview live UI
          </a>
        }
      >
        {liveCards && liveCards.matches.length === 0 && (
          <EmptyState title="No matches in the live / next-up / recent buckets for shadow-enabled tournaments." />
        )}

        {liveCards?.matches.map(card => (
          <div key={card.id}>
            <ShadowMatchCard card={card} observedAt={liveCards.observedAt}>
              <PointLog points={card.points} collapsible={false} />
            </ShadowMatchCard>
          </div>
        ))}
      </Section>

      {/* Section 3: Per-tournament drilldown */}
      {selectedTournamentId && <DrilldownSection tournamentId={selectedTournamentId} />}
    </div>
  )
}

// Drilldown subcomponent

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
        fetchJson<LiveRow[]>(`/api/internal/padelgod-shadow/live?tournament_id=${tournamentId}`),
        fetchJson<DivergenceRow[]>(`/api/internal/padelgod-shadow/divergences?tournament_id=${tournamentId}&type=final_state&limit=50`),
        fetchJson<DivergenceRow[]>(`/api/internal/padelgod-shadow/divergences?tournament_id=${tournamentId}&type=per_point_sequence&limit=50`),
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
    <Section label="Tournament detail">
      {/* Live matches */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>
          Live matches (30s refresh)
        </div>
        {live === null ? (
          <EmptyState title="Loading..." />
        ) : live.length === 0 ? (
          <EmptyState title="No live matches right now." />
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th>Match</th>
                <th>padelapi</th>
                <th>padelgod</th>
                <th>delta-ms</th>
                <th>Agree</th>
              </tr>
            </thead>
            <tbody>
              {live.map((r) => (
                <tr key={r.match_id}>
                  <td>{r.players.filter(Boolean).join(', ') || r.match_id.slice(0, 8)}</td>
                  <td><code style={{ background: 'var(--bg-card-2)', padding: '2px 6px', borderRadius: 4 }}>{r.publicSetScore ?? '—'}</code></td>
                  <td><code style={{ background: 'var(--bg-card-2)', padding: '2px 6px', borderRadius: 4 }}>{r.shadowSetScore ?? '—'}</code></td>
                  <td>{r.latencyMs ?? '—'}</td>
                  <td style={{ color: r.agreement ? 'var(--lime-text)' : 'var(--live-text)' }}>{r.agreement ? 'yes' : 'no'}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </div>

      {/* Final-state history */}
      <div>
        <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>
          Final-state history (last 50)
        </div>
        {finals === null ? (
          <EmptyState title="Loading..." />
        ) : finals.length === 0 ? (
          <EmptyState title="No finished matches with diff rows yet." />
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th>Match</th>
                <th>Winner</th>
                <th>padelapi</th>
                <th>padelgod</th>
                <th>Per-point</th>
                <th>Divergence</th>
              </tr>
            </thead>
            <tbody>
              {finals.map((d) => {
                const perPoint = perPointByMatchId.get(d.match_id)
                const perPointCell = perPoint == null
                  ? '—'
                  : perPoint.point_sequence_match
                    ? 'ok'
                    : `no @${perPoint.first_divergence_index ?? '?'}`
                return (
                  <tr key={d.id}>
                    <td>{d.match_id.slice(0, 8)}</td>
                    <td style={{ color: d.winner_match ? 'var(--lime-text)' : 'var(--live-text)' }}>{d.winner_match ? 'ok' : 'no'}</td>
                    <td><code style={{ background: 'var(--bg-card-2)', padding: '2px 6px', borderRadius: 4 }}>{d.padelapi_final_score ?? '—'}</code></td>
                    <td><code style={{ background: 'var(--bg-card-2)', padding: '2px 6px', borderRadius: 4 }}>{d.padelgod_final_score ?? '—'}</code></td>
                    <td style={{ color: perPoint?.point_sequence_match ? 'var(--lime-text)' : perPoint ? 'var(--live-text)' : 'var(--text-2)' }}>{perPointCell}</td>
                    <td style={{ color: 'var(--text-2)', fontSize: 11 }}>{d.divergence_reason ?? ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </DataTable>
        )}
      </div>
    </Section>
  )
}

// UI helpers

function HealthCard({ label, value, danger = false }: { label: string; value: string | number; danger?: boolean }) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: danger ? '1px solid var(--live-border)' : '1px solid var(--border-card)',
      borderRadius: 'var(--r-md)',
      padding: 12,
    }}>
      <div style={{ fontSize: 10, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: danger ? 'var(--live-text)' : 'var(--text-1)' }}>{value}</div>
    </div>
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

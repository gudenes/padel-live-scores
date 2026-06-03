'use client'
// apps/ops/src/app/(app)/system/ocr-health/_components/OcrHealthTab.tsx
//
// OCR Health tab — three views over the OCR worker pipeline:
//   1. Top stats (24h diff metrics + snapshot count + mean confidence)
//   2. Per-stream rollup (one row per stream_label, freshness + parsed_ok rate)
//   3. Recent snapshots table (last 30 raw reads — works without a shadow-diff
//      baseline so it's useful for verifying a fresh deploy against any source)
//
// Polls every 30 seconds.

import { useEffect, useState } from 'react'
import { PageHeader, Panel, Section, KpiStrip, Kpi, DataTable, EmptyState } from '@/components/ui'
import SnapshotDrawer from './SnapshotDrawer'

interface ParsedScore {
  pair1_label?: string | null
  pair2_label?: string | null
  sets_completed?: string[]
  current_set_games?: string | null
  current_game?: string | null
  parse_error?: boolean
}

interface StreamRollup {
  stream_label: string
  total: number
  parsed_ok: number
  parsed_error: number
  mean_confidence: number | null
  latest_captured_at: string | null
  seconds_since_latest: number | null
}

interface RecentSnapshot {
  id: number
  captured_at: string
  frame_at: string
  stream_label: string
  youtube_video_id: string
  court_label: string | null
  match_id: string | null
  ocr_confidence: number | null
  parsed_score: ParsedScore
  worker_version: string
}

interface OcrHealthData {
  windowHours: number
  totalDiffs: number
  totalSnapshots: number
  matchRate: number
  agreementCounts: Record<string, number>
  meanLagSeconds: number | null
  meanConfidence: number | null
  streamRollups: StreamRollup[]
  recentSnapshots: RecentSnapshot[]
}

export default function OcrHealthTab() {
  const [data, setData] = useState<OcrHealthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openSnapshotId, setOpenSnapshotId] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    const fetchData = async () => {
      try {
        const res = await fetch('/api/internal/ocr-health')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as OcrHealthData
        if (alive) {
          setData(json)
          setError(null)
        }
      } catch (e: unknown) {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (alive) setLoading(false)
      }
    }
    fetchData()
    const interval = setInterval(fetchData, 30_000)
    return () => {
      alive = false
      clearInterval(interval)
    }
  }, [])

  if (loading)
    return (
      <div className="ui-page">
        <PageHeader title="OCR Health" />
        <div style={{ color: 'var(--text-2)' }}>Loading OCR health…</div>
      </div>
    )
  if (error)
    return (
      <div className="ui-page">
        <PageHeader title="OCR Health" />
        <div style={{ color: 'var(--live-text)' }}>Error: {error}</div>
      </div>
    )
  if (!data) return null

  return (
    <div className="ui-page">
      <PageHeader
        title={`OCR Health — last ${data.windowHours}h`}
        subtitle="Auto-refreshing every 30s. Click any recent snapshot to see the captured frame with calibration overlay. V1 graduation thresholds: sets agreement ≥95%, mean confidence ≥0.85."
      />

      {/* Top stats */}
      <KpiStrip cols={4}>
        <Kpi label="Total snapshots" value={data.totalSnapshots.toLocaleString()} />
        <Kpi label="Total diffs" value={data.totalDiffs.toLocaleString()} />
        <Kpi
          label="Match rate"
          value={`${(data.matchRate * 100).toFixed(1)}%`}
          tone={data.matchRate >= 0.95 ? 'lime' : 'neutral'}
        />
        <Kpi
          label="Mean confidence"
          value={data.meanConfidence != null ? data.meanConfidence.toFixed(2) : '—'}
          tone={data.meanConfidence != null && data.meanConfidence >= 0.85 ? 'lime' : 'neutral'}
        />
      </KpiStrip>

      {/* Per-stream rollups */}
      <Section label="Per-stream activity (24h)">
        {data.streamRollups.length === 0 ? (
          <EmptyState
            title="No snapshots in the last 24 hours."
            hint={
              <>
                If you just deployed the worker, give it a minute and refresh. If the Railway service
                is up but this stays empty, check the worker logs for <code>iteration_failed</code>{' '}
                entries.
              </>
            }
          />
        ) : (
          <Panel padded={false}>
            <DataTable>
              <thead>
                <tr>
                  {['Stream', 'Total', 'OK', 'Error', 'Conf', 'Last', 'Age'].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.streamRollups.map((r) => (
                  <tr key={r.stream_label}>
                    <td>
                      <code>{r.stream_label}</code>
                    </td>
                    <td>{r.total.toLocaleString()}</td>
                    <td style={{ color: 'var(--lime-text)' }}>{r.parsed_ok}</td>
                    <td style={{ color: r.parsed_error > 0 ? 'var(--live-text)' : 'inherit' }}>
                      {r.parsed_error}
                    </td>
                    <td>{r.mean_confidence != null ? r.mean_confidence.toFixed(2) : '—'}</td>
                    <td>{r.latest_captured_at ? formatTime(r.latest_captured_at) : '—'}</td>
                    <td>
                      {r.seconds_since_latest != null ? formatAge(r.seconds_since_latest) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </Panel>
        )}
      </Section>

      {/* Agreement breakdown */}
      <Section label="Agreement breakdown (24h)">
        {data.totalDiffs === 0 ? (
          <EmptyState
            title="No shadow-diff events yet."
            hint={
              <>
                The diff worker only runs when
                <code> ENABLE_SHADOW_DIFF_OCR=true</code> on the padelgod service AND snapshots are
                attached to a live <code>matches.id</code> (resolver requires{' '}
                <code>status=&apos;live&apos;</code>). For a recording-based smoke test, this section
                stays empty — that&apos;s expected.
              </>
            }
          />
        ) : (
          <Panel>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {Object.entries(data.agreementCounts).map(([k, v]) => (
                <div
                  key={k}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    borderBottom: '1px solid var(--border-card)',
                    padding: '6px 0',
                  }}
                >
                  <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-2)' }}>
                    {k}
                  </span>
                  <span style={{ color: 'var(--text-1)' }}>{v}</span>
                </div>
              ))}
            </div>
          </Panel>
        )}
      </Section>

      {/* Recent snapshots — the primary "is it alive?" view */}
      <Section label={`Recent snapshots (last ${data.recentSnapshots.length})`}>
        {data.recentSnapshots.length === 0 ? (
          <EmptyState
            title="No snapshots have ever been written."
            hint={
              <>
                The worker is either not running, crash-looping on env-var validation, or hitting an
                <code> iteration_failed</code> error. Check Railway logs.
              </>
            }
          />
        ) : (
          <Panel padded={false}>
            <DataTable>
              <thead>
                <tr>
                  {[
                    'Captured',
                    'Stream',
                    'Match',
                    'Pair1',
                    'Pair2',
                    'Sets',
                    'Cur set',
                    'Cur game',
                    'Conf',
                    'Status',
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.recentSnapshots.map((s) => {
                  const p = s.parsed_score
                  const isErr = p?.parse_error === true
                  return (
                    <tr
                      key={s.id}
                      onClick={() => setOpenSnapshotId(s.id)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>{formatTime(s.captured_at)}</td>
                      <td>
                        <code>{s.stream_label}</code>
                      </td>
                      <td>
                        {s.match_id ? (
                          <code style={{ fontSize: 11 }}>{s.match_id.slice(0, 8)}…</code>
                        ) : (
                          <span style={{ color: 'var(--text-3)' }}>—</span>
                        )}
                      </td>
                      <td>{p?.pair1_label ?? '—'}</td>
                      <td>{p?.pair2_label ?? '—'}</td>
                      <td>{p?.sets_completed?.length ? p.sets_completed.join(', ') : '—'}</td>
                      <td>{p?.current_set_games ?? '—'}</td>
                      <td>{p?.current_game ?? '—'}</td>
                      <td>{s.ocr_confidence != null ? s.ocr_confidence.toFixed(2) : '—'}</td>
                      <td>
                        {isErr ? (
                          <span style={{ color: 'var(--live-text)', fontSize: 11 }}>parse_error</span>
                        ) : (
                          <span style={{ color: 'var(--lime-text)', fontSize: 11 }}>ok</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </DataTable>
          </Panel>
        )}
      </Section>

      {openSnapshotId !== null && (
        <SnapshotDrawer
          key={openSnapshotId}
          snapshotId={openSnapshotId}
          onClose={() => setOpenSnapshotId(null)}
        />
      )}
    </div>
  )
}

// ─── helpers ──────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return iso
  }
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

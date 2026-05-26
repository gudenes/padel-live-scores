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

  if (loading) return <div style={{ padding: 24 }}>Loading OCR health…</div>
  if (error) return <div style={{ padding: 24, color: 'crimson' }}>Error: {error}</div>
  if (!data) return null

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>
        OCR Health — last {data.windowHours}h
      </h2>

      {/* Top stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <Stat label="Total snapshots" value={data.totalSnapshots.toLocaleString()} />
        <Stat label="Total diffs" value={data.totalDiffs.toLocaleString()} />
        <Stat
          label="Match rate"
          value={`${(data.matchRate * 100).toFixed(1)}%`}
          highlight={data.matchRate >= 0.95}
        />
        <Stat
          label="Mean confidence"
          value={data.meanConfidence != null ? data.meanConfidence.toFixed(2) : '—'}
          highlight={data.meanConfidence != null && data.meanConfidence >= 0.85}
        />
      </div>

      {/* Per-stream rollups */}
      <Section title="Per-stream activity (24h)">
        {data.streamRollups.length === 0 ? (
          <EmptyHint>
            No snapshots in the last 24 hours. If you just deployed the worker,
            give it a minute and refresh. If the Railway service is up but this
            stays empty, check the worker logs for <code>iteration_failed</code> entries.
          </EmptyHint>
        ) : (
          <Table
            headers={['Stream', 'Total', 'OK', 'Error', 'Conf', 'Last', 'Age']}
            rows={data.streamRollups.map((r) => [
              <code key="s">{r.stream_label}</code>,
              r.total.toLocaleString(),
              <span key="ok" style={{ color: 'var(--accent-green, #1a7f37)' }}>
                {r.parsed_ok}
              </span>,
              <span
                key="err"
                style={{ color: r.parsed_error > 0 ? 'crimson' : 'inherit' }}
              >
                {r.parsed_error}
              </span>,
              r.mean_confidence != null ? r.mean_confidence.toFixed(2) : '—',
              r.latest_captured_at ? formatTime(r.latest_captured_at) : '—',
              r.seconds_since_latest != null
                ? formatAge(r.seconds_since_latest)
                : '—',
            ])}
          />
        )}
      </Section>

      {/* Agreement breakdown */}
      <Section title="Agreement breakdown (24h)">
        {data.totalDiffs === 0 ? (
          <EmptyHint>
            No shadow-diff events yet. The diff worker only runs when
            <code> ENABLE_SHADOW_DIFF_OCR=true</code> on the padelgod service AND
            snapshots are attached to a live <code>matches.id</code> (resolver
            requires <code>status=&apos;live&apos;</code>). For a recording-based
            smoke test, this section stays empty — that&apos;s expected.
          </EmptyHint>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {Object.entries(data.agreementCounts).map(([k, v]) => (
              <div
                key={k}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  borderBottom: '1px solid var(--border-subtle, #eee)',
                  padding: '6px 0',
                }}
              >
                <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{k}</span>
                <span>{v}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Recent snapshots — the primary "is it alive?" view */}
      <Section title={`Recent snapshots (last ${data.recentSnapshots.length})`}>
        {data.recentSnapshots.length === 0 ? (
          <EmptyHint>
            No snapshots have ever been written. The worker is either not running,
            crash-looping on env-var validation, or hitting an
            <code> iteration_failed</code> error. Check Railway logs.
          </EmptyHint>
        ) : (
          <Table
            headers={[
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
            ]}
            onRowClick={(i) => setOpenSnapshotId(data.recentSnapshots[i].id)}
            rows={data.recentSnapshots.map((s) => {
              const p = s.parsed_score
              const isErr = p?.parse_error === true
              return [
                formatTime(s.captured_at),
                <code key="s">{s.stream_label}</code>,
                s.match_id ? (
                  <code key="m" style={{ fontSize: 11 }}>
                    {s.match_id.slice(0, 8)}…
                  </code>
                ) : (
                  <span key="m" style={{ color: 'var(--text-muted, #777)' }}>
                    —
                  </span>
                ),
                p?.pair1_label ?? '—',
                p?.pair2_label ?? '—',
                p?.sets_completed?.length ? p.sets_completed.join(', ') : '—',
                p?.current_set_games ?? '—',
                p?.current_game ?? '—',
                s.ocr_confidence != null ? s.ocr_confidence.toFixed(2) : '—',
                isErr ? (
                  <span key="x" style={{ color: 'crimson', fontSize: 11 }}>
                    parse_error
                  </span>
                ) : (
                  <span
                    key="ok"
                    style={{ color: 'var(--accent-green, #1a7f37)', fontSize: 11 }}
                  >
                    ok
                  </span>
                ),
              ]
            })}
          />
        )}
      </Section>

      <div style={{ fontSize: 13, color: 'var(--text-muted, #777)' }}>
        Auto-refreshing every 30s. Click any recent snapshot to see the captured
        frame with calibration overlay. V1 graduation thresholds: sets agreement
        ≥95%, mean confidence ≥0.85.
      </div>

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

function Stat({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div
      style={{
        border: '1px solid var(--border-subtle, #eee)',
        borderRadius: 6,
        padding: 12,
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--text-muted, #777)' }}>{label}</div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 600,
          color: highlight ? 'var(--accent-green, #1a7f37)' : 'inherit',
        }}
      >
        {value}
      </div>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div>
      <h3 style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>{title}</h3>
      {children}
    </div>
  )
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 13,
        color: 'var(--text-muted, #777)',
        border: '1px dashed var(--border-subtle, #ddd)',
        borderRadius: 6,
        padding: 12,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  )
}

function Table({
  headers,
  rows,
  onRowClick,
}: {
  headers: string[]
  rows: React.ReactNode[][]
  /** If provided, each row becomes clickable and the index is passed back. */
  onRowClick?: (rowIndex: number) => void
}) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            {headers.map((h) => (
              <th
                key={h}
                style={{
                  textAlign: 'left',
                  padding: '6px 8px',
                  borderBottom: '1px solid var(--border-subtle, #ddd)',
                  fontWeight: 500,
                  color: 'var(--text-muted, #555)',
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              onClick={onRowClick ? () => onRowClick(i) : undefined}
              style={{
                cursor: onRowClick ? 'pointer' : 'default',
                transition: 'background 80ms ease',
              }}
              onMouseEnter={(e) => {
                if (onRowClick)
                  (e.currentTarget as HTMLTableRowElement).style.background =
                    'var(--bg-subtle, #f6f8fa)'
              }}
              onMouseLeave={(e) => {
                if (onRowClick)
                  (e.currentTarget as HTMLTableRowElement).style.background =
                    'transparent'
              }}
            >
              {row.map((cell, j) => (
                <td
                  key={j}
                  style={{
                    padding: '6px 8px',
                    borderBottom: '1px solid var(--border-subtle, #eee)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

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

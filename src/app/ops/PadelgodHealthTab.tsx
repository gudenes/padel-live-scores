'use client'
// src/app/ops/PadelgodHealthTab.tsx
//
// Fleet-level health view for the padelgod data-acquisition layer. The
// Tournament Explorer answers "is this one tournament OK?"; this tab
// answers "is the discovery + scraping pipeline doing its job?".
//
// Shows:
//   - Per-worker tiles (last run, 24h runs/failures, success rate)
//   - Tournament coverage (fip_id / padelapi_id / both / orphan-twins)
//   - widget_id_cache breakdown by extraction method
//   - Snapshot-table row counts + freshness
//
// Read-only — no triggers here. Operators who need to force-run a worker
// go through the existing `/admin/run-worker` on padelgod's Railway
// service (scoped to specific worker names).

import { useEffect, useState } from 'react'

// ── Types mirror /api/ops/padelgod-health ───────────────────────────────

interface WorkerStats {
  label: string
  jobType: string
  lastRun: string | null
  lastStatus: 'success' | 'failed' | 'running' | null
  runsLast24h: number
  failuresLast24h: number
  successRate24h: number | null
  lastError: string | null
}

interface Coverage {
  tournamentsTotal: number
  withFipId: number
  withPadelapiId: number
  withBoth: number
  orphanFipOnly: number
}

interface WidgetCoverage {
  total: number
  byMethod: Record<string, number>
  mostRecent: string | null
}

interface SnapshotCoverage {
  entryList: number
  oop: number
  results: number
  draw: number
  entryListLatest: string | null
  oopLatest: string | null
  resultsLatest: string | null
  drawLatest: string | null
}

interface HealthResponse {
  workers: WorkerStats[]
  coverage: Coverage
  widgetCoverage: WidgetCoverage
  snapshotCoverage: SnapshotCoverage
  generatedAt: string
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
  return `${Math.floor(hrs / 24)}d ago`
}

// ── Styles ──────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: 'white',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: 14,
}

const sectionHeader: React.CSSProperties = {
  fontSize: 10,
  color: '#999',
  textTransform: 'uppercase',
  fontWeight: 700,
  letterSpacing: 1,
  marginBottom: 8,
  marginTop: 20,
}

// ── Component ───────────────────────────────────────────────────────────

export default function PadelgodHealthTab() {
  const [data, setData] = useState<HealthResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchHealth = () => {
    setLoading(true)
    setError(null)
    fetch('/api/ops/padelgod-health')
      .then((r) => r.json())
      .then((body: HealthResponse) => {
        if (body.error) setError(body.error)
        else setData(body)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load health'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchHealth()
  }, [])

  if (loading && !data) {
    return <div style={{ ...card, color: '#666', fontSize: 12 }}>Loading padelgod health…</div>
  }

  if (error && !data) {
    return (
      <div style={{ ...card, background: '#fee2e2', borderColor: '#fecaca', color: '#991b1b', fontSize: 12 }}>
        ❌ {error}
      </div>
    )
  }

  if (!data) return null

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: '#111' }}>
          Padelgod Health
        </h2>
        <p style={{ fontSize: 12, color: '#666', marginTop: 4, maxWidth: 720 }}>
          Fleet-level view of padelgod&apos;s data-acquisition workers. Covers
          tournament discovery from padelfip.com, widget-id lookup on
          matchscorerlive.com, and the static fetchers feeding{' '}
          <code style={{ background: '#f3f4f6', padding: '1px 4px', borderRadius: 3 }}>padelgod.*_snapshots</code>.
        </p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
          <span style={{ fontSize: 11, color: '#999' }}>
            Generated: {formatAgo(data.generatedAt)}
          </span>
          <button
            onClick={fetchHealth}
            disabled={loading}
            style={{
              fontSize: 11,
              padding: '4px 10px',
              border: '1px solid #d1d5db',
              borderRadius: 4,
              background: '#fff',
              color: '#555',
              cursor: loading ? 'wait' : 'pointer',
            }}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* ── Worker tiles ────────────────────────────────────────────── */}
      <div style={sectionHeader}>Workers (last 24h)</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {data.workers.map((w) => (
          <WorkerTile key={w.jobType + w.label} w={w} />
        ))}
      </div>

      {/* ── Coverage cards ──────────────────────────────────────────── */}
      <div style={sectionHeader}>Cross-Source Coverage</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        <StatCard
          label="Tournaments total"
          value={data.coverage.tournamentsTotal}
          color="#111"
        />
        <StatCard
          label="With fip_id"
          value={`${data.coverage.withFipId} · ${pct(data.coverage.withFipId, data.coverage.tournamentsTotal)}`}
          color={data.coverage.withFipId > data.coverage.tournamentsTotal / 2 ? '#166534' : '#92400e'}
        />
        <StatCard
          label="With padelapi_id"
          value={`${data.coverage.withPadelapiId} · ${pct(data.coverage.withPadelapiId, data.coverage.tournamentsTotal)}`}
          color="#1e40af"
        />
        <StatCard
          label="Linked (both IDs)"
          value={`${data.coverage.withBoth} · ${pct(data.coverage.withBoth, data.coverage.tournamentsTotal)}`}
          color={data.coverage.withBoth < 50 ? '#991b1b' : '#166534'}
          hint={data.coverage.orphanFipOnly > 0 ? `${data.coverage.orphanFipOnly} orphan FIP-only rows` : undefined}
        />
      </div>

      {/* ── Widget cache ────────────────────────────────────────────── */}
      <div style={sectionHeader}>Widget ID Cache (matchscorerlive.com)</div>
      <div style={{ ...card, display: 'flex', gap: 24, alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 10, color: '#999', fontWeight: 600, textTransform: 'uppercase' }}>
            Total resolved
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#111' }}>
            {data.widgetCoverage.total}
          </div>
        </div>
        {Object.entries(data.widgetCoverage.byMethod).map(([method, count]) => (
          <div key={method}>
            <div style={{ fontSize: 10, color: '#999', fontWeight: 600, textTransform: 'uppercase' }}>
              {method}
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#333' }}>{count}</div>
          </div>
        ))}
        <div style={{ marginLeft: 'auto', fontSize: 11, color: '#666' }}>
          Most recent: <b style={{ color: '#333' }}>{formatAgo(data.widgetCoverage.mostRecent)}</b>
        </div>
      </div>

      {/* ── Snapshot tables ─────────────────────────────────────────── */}
      <div style={sectionHeader}>Snapshot Tables</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        <SnapshotCard label="entry_list" count={data.snapshotCoverage.entryList} latest={data.snapshotCoverage.entryListLatest} />
        <SnapshotCard label="oop" count={data.snapshotCoverage.oop} latest={data.snapshotCoverage.oopLatest} />
        <SnapshotCard label="results" count={data.snapshotCoverage.results} latest={data.snapshotCoverage.resultsLatest} />
        <SnapshotCard label="draw" count={data.snapshotCoverage.draw} latest={data.snapshotCoverage.drawLatest} />
      </div>
    </div>
  )
}

// ── Subcomponents ───────────────────────────────────────────────────────

function WorkerTile({ w }: { w: WorkerStats }) {
  const accent =
    w.lastStatus === 'success'
      ? '#22c55e'
      : w.lastStatus === 'failed'
        ? '#ef4444'
        : w.lastStatus === 'running'
          ? '#3b82f6'
          : '#9ca3af'

  return (
    <div style={{ ...card, borderLeft: `3px solid ${accent}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>{w.label}</div>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            padding: '2px 6px',
            borderRadius: 3,
            background: w.lastStatus === 'success' ? '#dcfce7' : w.lastStatus === 'failed' ? '#fee2e2' : '#f3f4f6',
            color: w.lastStatus === 'success' ? '#166534' : w.lastStatus === 'failed' ? '#991b1b' : '#6b7280',
            textTransform: 'uppercase',
          }}
        >
          {w.lastStatus ?? 'idle'}
        </span>
      </div>
      <div style={{ fontSize: 10, color: '#999', marginTop: 2 }}>
        Last run: {formatAgo(w.lastRun)}
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
        <div>
          <div style={{ fontSize: 9, color: '#999', textTransform: 'uppercase', fontWeight: 600 }}>Runs 24h</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#111' }}>{w.runsLast24h}</div>
        </div>
        <div>
          <div style={{ fontSize: 9, color: '#999', textTransform: 'uppercase', fontWeight: 600 }}>Failures</div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: w.failuresLast24h > 0 ? '#991b1b' : '#999',
            }}
          >
            {w.failuresLast24h}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 9, color: '#999', textTransform: 'uppercase', fontWeight: 600 }}>Success rate</div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              color:
                w.successRate24h === null
                  ? '#999'
                  : w.successRate24h === 100
                    ? '#166534'
                    : w.successRate24h >= 80
                      ? '#92400e'
                      : '#991b1b',
            }}
          >
            {w.successRate24h === null ? '—' : `${w.successRate24h}%`}
          </div>
        </div>
      </div>
      {w.lastError && (
        <div
          style={{
            marginTop: 8,
            padding: '6px 8px',
            background: '#fee2e2',
            borderRadius: 4,
            fontSize: 10,
            fontFamily: 'monospace',
            color: '#991b1b',
            wordBreak: 'break-word',
          }}
        >
          {w.lastError.slice(0, 200)}
        </div>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  color,
  hint,
}: {
  label: string
  value: string | number
  color: string
  hint?: string
}) {
  return (
    <div style={card}>
      <div style={{ fontSize: 10, color: '#999', fontWeight: 600, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, marginTop: 4 }}>{value}</div>
      {hint && <div style={{ fontSize: 10, color: '#92400e', marginTop: 2 }}>{hint}</div>}
    </div>
  )
}

function SnapshotCard({
  label,
  count,
  latest,
}: {
  label: string
  count: number
  latest: string | null
}) {
  return (
    <div style={card}>
      <div style={{ fontSize: 10, color: '#999', fontWeight: 600, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: count === 0 ? '#991b1b' : '#111', marginTop: 4 }}>
        {count.toLocaleString()}
      </div>
      <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>
        Latest: <b>{formatAgo(latest)}</b>
      </div>
    </div>
  )
}

function pct(n: number, total: number): string {
  if (total === 0) return '—'
  return `${Math.round((n / total) * 100)}%`
}

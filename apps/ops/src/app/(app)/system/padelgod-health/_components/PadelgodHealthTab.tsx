'use client'
// apps/ops/src/app/(app)/system/padelgod-health/_components/PadelgodHealthTab.tsx
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
import { PageHeader, Section, Button } from '@/components/ui'

// ── Types mirror /api/internal/padelgod-health ───────────────────────────

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
  background: 'var(--bg-card)',
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--r-md)',
  padding: 14,
}

// ── Component ───────────────────────────────────────────────────────────

export default function PadelgodHealthTab() {
  const [data, setData] = useState<HealthResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchHealth = () => {
    setLoading(true)
    setError(null)
    fetch('/api/internal/padelgod-health')
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
    return (
      <div className="ui-page">
        <PageHeader title="Padelgod Health" />
        <div style={{ ...card, color: 'var(--text-2)', fontSize: 12 }}>Loading padelgod health…</div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="ui-page">
        <PageHeader title="Padelgod Health" />
        <div style={{ ...card, background: 'var(--live-bg)', borderColor: 'var(--live-border)', color: 'var(--live-text)', fontSize: 12 }}>
          Error: {error}
        </div>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="ui-page">
      <PageHeader
        title="Padelgod Health"
        subtitle={
          <>
            Fleet-level view of padelgod&apos;s data-acquisition workers. Covers
            tournament discovery from padelfip.com, widget-id lookup on
            matchscorerlive.com, and the static fetchers feeding{' '}
            <code style={{ background: 'var(--bg-card-2)', padding: '1px 4px', borderRadius: 3 }}>padelgod.*_snapshots</code>.
          </>
        }
        actions={
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
              Generated: {formatAgo(data.generatedAt)}
            </span>
            <Button size="sm" onClick={fetchHealth} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>
        }
      />

      {/* ── Worker tiles ────────────────────────────────────────────── */}
      <Section label="Workers (last 24h)">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {data.workers.map((w) => (
            <WorkerTile key={w.jobType + w.label} w={w} />
          ))}
        </div>
      </Section>

      {/* ── Coverage cards ──────────────────────────────────────────── */}
      <Section label="Cross-Source Coverage">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          <StatCard
            label="Tournaments total"
            value={data.coverage.tournamentsTotal}
            color="var(--text-1)"
          />
          <StatCard
            label="With fip_id"
            value={`${data.coverage.withFipId} · ${pct(data.coverage.withFipId, data.coverage.tournamentsTotal)}`}
            color={data.coverage.withFipId > data.coverage.tournamentsTotal / 2 ? 'var(--lime-text)' : 'var(--orange-text)'}
          />
          <StatCard
            label="With padelapi_id"
            value={`${data.coverage.withPadelapiId} · ${pct(data.coverage.withPadelapiId, data.coverage.tournamentsTotal)}`}
            color="var(--men)"
          />
          <StatCard
            label="Linked (both IDs)"
            value={`${data.coverage.withBoth} · ${pct(data.coverage.withBoth, data.coverage.tournamentsTotal)}`}
            color={data.coverage.withBoth < 50 ? 'var(--live-text)' : 'var(--lime-text)'}
            hint={data.coverage.orphanFipOnly > 0 ? `${data.coverage.orphanFipOnly} orphan FIP-only rows` : undefined}
          />
        </div>
      </Section>

      {/* ── Widget cache ────────────────────────────────────────────── */}
      <Section label="Widget ID Cache (matchscorerlive.com)">
        <div style={{ ...card, display: 'flex', gap: 24, alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase' }}>
              Total resolved
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-1)' }}>
              {data.widgetCoverage.total}
            </div>
          </div>
          {Object.entries(data.widgetCoverage.byMethod).map(([method, count]) => (
            <div key={method}>
              <div style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase' }}>
                {method}
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-2)' }}>{count}</div>
            </div>
          ))}
          <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-2)' }}>
            Most recent: <b style={{ color: 'var(--text-1)' }}>{formatAgo(data.widgetCoverage.mostRecent)}</b>
          </div>
        </div>
      </Section>

      {/* ── Snapshot tables ─────────────────────────────────────────── */}
      <Section label="Snapshot Tables">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          <SnapshotCard label="entry_list" count={data.snapshotCoverage.entryList} latest={data.snapshotCoverage.entryListLatest} />
          <SnapshotCard label="oop" count={data.snapshotCoverage.oop} latest={data.snapshotCoverage.oopLatest} />
          <SnapshotCard label="results" count={data.snapshotCoverage.results} latest={data.snapshotCoverage.resultsLatest} />
          <SnapshotCard label="draw" count={data.snapshotCoverage.draw} latest={data.snapshotCoverage.drawLatest} />
        </div>
      </Section>
    </div>
  )
}

// ── Subcomponents ───────────────────────────────────────────────────────

function WorkerTile({ w }: { w: WorkerStats }) {
  const accent =
    w.lastStatus === 'success'
      ? 'var(--lime)'
      : w.lastStatus === 'failed'
        ? 'var(--live)'
        : w.lastStatus === 'running'
          ? 'var(--men)'
          : 'var(--text-3)'

  return (
    <div style={{ ...card, borderLeft: `3px solid ${accent}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>{w.label}</div>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            padding: '2px 6px',
            borderRadius: 3,
            background: w.lastStatus === 'success' ? 'var(--lime-bg)' : w.lastStatus === 'failed' ? 'var(--live-bg)' : 'var(--bg-hover)',
            color: w.lastStatus === 'success' ? 'var(--lime-text)' : w.lastStatus === 'failed' ? 'var(--live-text)' : 'var(--text-3)',
            textTransform: 'uppercase',
          }}
        >
          {w.lastStatus ?? 'idle'}
        </span>
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>
        Last run: {formatAgo(w.lastRun)}
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
        <div>
          <div style={{ fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', fontWeight: 600 }}>Runs 24h</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)' }}>{w.runsLast24h}</div>
        </div>
        <div>
          <div style={{ fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', fontWeight: 600 }}>Failures</div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: w.failuresLast24h > 0 ? 'var(--live-text)' : 'var(--text-3)',
            }}
          >
            {w.failuresLast24h}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', fontWeight: 600 }}>Success rate</div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              color:
                w.successRate24h === null
                  ? 'var(--text-3)'
                  : w.successRate24h === 100
                    ? 'var(--lime-text)'
                    : w.successRate24h >= 80
                      ? 'var(--orange-text)'
                      : 'var(--live-text)',
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
            background: 'var(--live-bg)',
            borderRadius: 4,
            fontSize: 10,
            fontFamily: 'monospace',
            color: 'var(--live-text)',
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
      <div style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, marginTop: 4 }}>{value}</div>
      {hint && <div style={{ fontSize: 10, color: 'var(--orange-text)', marginTop: 2 }}>{hint}</div>}
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
      <div style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: count === 0 ? 'var(--live-text)' : 'var(--text-1)', marginTop: 4 }}>
        {count.toLocaleString()}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-2)', marginTop: 2 }}>
        Latest: <b>{formatAgo(latest)}</b>
      </div>
    </div>
  )
}

function pct(n: number, total: number): string {
  if (total === 0) return '—'
  return `${Math.round((n / total) * 100)}%`
}

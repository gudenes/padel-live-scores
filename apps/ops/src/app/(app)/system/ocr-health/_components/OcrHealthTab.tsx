'use client'
// apps/ops/src/app/(app)/system/ocr-health/_components/OcrHealthTab.tsx
//
// V1 OCR Health tab — reads /api/internal/ocr-health and renders the
// graduation-decision metrics for the OCR worker shadow-diff pipeline.
//
// Polls every 30 seconds. No write operations from this file (the
// operator labeling buttons that POST to /api/internal/ocr-diff-label
// live alongside the disagreements table in V2 — out of scope here).

import { useEffect, useState } from 'react'

interface OcrHealthData {
  windowHours: number
  totalDiffs: number
  totalSnapshots: number
  matchRate: number
  agreementCounts: Record<string, number>
  meanLagSeconds: number | null
  meanConfidence: number | null
}

export default function OcrHealthTab() {
  const [data, setData] = useState<OcrHealthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

      <div>
        <h3 style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>
          Agreement breakdown
        </h3>
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
      </div>

      <div style={{ fontSize: 13, color: 'var(--text-muted, #777)' }}>
        Auto-refreshing every 30s. V1 thresholds for graduation: sets agreement ≥95%, confidence ≥0.85.
      </div>
    </div>
  )
}

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

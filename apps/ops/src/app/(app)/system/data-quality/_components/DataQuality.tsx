'use client'

import { useEffect, useState } from 'react'
import {
  type DashboardData,
  timeAgo,
  card,
  sectionLabel,
  bigNumber,
  dimText,
  tileLabel,
} from '../../_shared/ops-status-types'

// ── Main component ────────────────────────────────────────────────

export function DataQuality() {
  const [data, setData] = useState<DashboardData | null>(null)

  useEffect(() => {
    let cancelled = false
    async function pull() {
      try {
        const res = await fetch('/api/internal/ops-status', { cache: 'no-store' })
        if (!res.ok) return
        const json = (await res.json()) as DashboardData
        if (!cancelled) setData(json)
      } catch {
        // network blip — silently retry on next interval
      }
    }
    void pull()
    const id = setInterval(() => void pull(), 30_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  if (!data) {
    return <div style={{ padding: 32, color: 'var(--status-neutral, #9ca3af)' }}>Loading...</div>
  }

  return (
    <div style={{ padding: 32 }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#111', marginBottom: 16 }}>Data Quality</div>

      <div style={sectionLabel}>Data Freshness</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 20 }}>
        <div style={card}>
          <div style={tileLabel}>Live Matches</div>
          <div style={bigNumber}>{data.freshness.live_matches}</div>
        </div>
        <div style={card}>
          <div style={tileLabel}>Last Score Update</div>
          <div style={bigNumber}>{timeAgo(data.freshness.last_score_update)}</div>
        </div>
        <div style={card}>
          <div style={tileLabel}>Stale Matches</div>
          <div style={{ ...bigNumber, color: data.freshness.stale_matches.length > 0 ? '#dc2626' : undefined }}>
            {data.freshness.stale_matches.length}
          </div>
          {data.freshness.stale_matches.length > 0 && (
            <div style={{ ...dimText, color: '#dc2626' }}>
              #{data.freshness.stale_matches[0]?.external_id} · no update in {timeAgo(data.freshness.stale_matches[0]?.updated_at ?? null)}
            </div>
          )}
        </div>
      </div>

      <div style={sectionLabel}>Data Quality</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 20 }}>
        <div style={card}>
          <div style={tileLabel}>Total Matches</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{data.quality.total_matches.toLocaleString()}</div>
          <div style={dimText}>across {data.quality.total_tournaments} tournaments</div>
        </div>
        <div style={card}>
          <div style={tileLabel}>With PBP Data</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#166534', marginTop: 4 }}>
            {data.quality.total_matches > 0 ? Math.round((data.quality.with_pbp / data.quality.total_matches) * 100) : 0}%
          </div>
          <div style={dimText}>{data.quality.with_pbp.toLocaleString()} matches</div>
        </div>
        <div style={card}>
          <div style={tileLabel}>Missing Scores</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: data.quality.missing_scores > 0 ? '#f59e0b' : undefined, marginTop: 4 }}>
            {data.quality.missing_scores}
          </div>
          <div style={dimText}>finished, no winner</div>
        </div>
        <div style={card}>
          <div style={tileLabel}>Unresolved Players</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: data.quality.unresolved_players > 0 ? '#f59e0b' : undefined, marginTop: 4 }}>
            {data.quality.unresolved_players}
          </div>
          <div style={dimText}>missing external_id</div>
        </div>
        <div style={{ ...card, borderLeft: '3px solid #8b5cf6' }}>
          <div style={tileLabel}>Ongoing Events</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#5b21b6', marginTop: 4 }}>
            {data.quality.ongoing_events}
          </div>
          <div style={dimText}>tournaments with active matches</div>
        </div>
        <div style={{ ...card, borderLeft: '3px solid #22c55e' }}>
          <div style={tileLabel}>Live Matches</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#166534', marginTop: 4 }}>
            {data.quality.ongoing_live_matches}
          </div>
          <div style={dimText}>in progress right now</div>
        </div>
        <div style={{ ...card, borderLeft: '3px solid #3b82f6' }}>
          <div style={tileLabel}>Scheduled Matches</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#1e40af', marginTop: 4 }}>
            {data.quality.ongoing_scheduled_matches}
          </div>
          <div style={dimText}>upcoming in ongoing events</div>
        </div>
      </div>
    </div>
  )
}

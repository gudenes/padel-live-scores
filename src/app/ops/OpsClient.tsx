'use client'
// src/app/ops/OpsClient.tsx
// Client component: renders the ops dashboard and polls every 30s.

import { useEffect, useState, useCallback } from 'react'

// ── Types ───────────────────────────────────────────────────────

interface HealthEntry {
  status: string
  started_at: string | null
  duration_ms: number | null
  meta: Record<string, any> | null
  error_message: string | null
}

interface RelayStatus {
  ok: boolean
  pusher_state: string
  active_channels: number
  uptime: number
}

interface StaleMatch {
  id: string
  external_id: string
  updated_at: string
}

interface DashboardData {
  health: Record<string, HealthEntry>
  relay: RelayStatus
  freshness: {
    live_matches: number
    last_score_update: string | null
    stale_matches: StaleMatch[]
  }
  quality: {
    total_matches: number
    with_pbp: number
    missing_scores: number
    unresolved_players: number
    total_tournaments: number
  }
  usage: null
  recent_events: Array<{
    source: string
    status: string
    started_at: string
    duration_ms: number | null
    meta: Record<string, any> | null
    error_message: string | null
  }>
  fetched_at: string
}

// ── Config ──────────────────────────────────────────────────────

const TILES = [
  { key: 'cron:scores', label: 'Scores', schedule: 'Every 2 min' },
  { key: 'cron:sync-matches', label: 'Sync Matches', schedule: 'Every 1h' },
  { key: 'cron:sync', label: 'Full Sync', schedule: 'Mon 4am UTC' },
  { key: 'cron:rankings', label: 'Rankings', schedule: 'Daily 5am UTC' },
  { key: 'cron:articles', label: 'Articles', schedule: 'Hourly :40' },
  { key: 'cron:highlights', label: 'Highlights', schedule: 'Hourly :20' },
] as const

// ── Helpers ─────────────────────────────────────────────────────

function timeAgo(iso: string | null): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function statusColor(status: string): string {
  switch (status) {
    case 'ok': return '#22c55e'
    case 'partial': return '#f59e0b'
    case 'error': case 'timeout': return '#ef4444'
    default: return '#9ca3af'
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'ok': return 'OK'
    case 'partial': return 'Partial'
    case 'error': return 'Error'
    case 'timeout': return 'Timeout'
    default: return 'Unknown'
  }
}

function statusBorder(status: string): string {
  switch (status) {
    case 'ok': return '1px solid #e5e7eb'
    case 'partial': return '1px solid #fde68a'
    case 'error': case 'timeout': return '1px solid #fecaca'
    default: return '1px solid #e5e7eb'
  }
}

function metaSummary(source: string, meta: Record<string, any> | null): string {
  if (!meta) return ''
  switch (source) {
    case 'cron:scores': return `${meta.synced ?? 0} updated · ${meta.stale ?? 0} stale`
    case 'cron:sync-matches': return `${meta.matches_synced ?? 0} matches`
    case 'cron:sync': return `${meta.tournaments_synced ?? 0} tournaments · ${meta.players_synced ?? 0} players`
    case 'cron:rankings': return `Official: ${meta.official ?? 0} · Race: ${meta.race ?? 0}`
    case 'cron:articles': return `${meta.new ?? 0} new from ${meta.sources_checked ?? 0} sources`
    case 'cron:highlights': return `${meta.new ?? 0} new videos`
    default: return ''
  }
}

const SOURCE_COLORS: Record<string, { bg: string; text: string }> = {
  'cron:scores': { bg: '#dbeafe', text: '#1e40af' },
  'cron:sync': { bg: '#d1fae5', text: '#065f46' },
  'cron:sync-matches': { bg: '#d1fae5', text: '#065f46' },
  'cron:rankings': { bg: '#fef3c7', text: '#92400e' },
  'cron:articles': { bg: '#fce7f3', text: '#9d174d' },
  'cron:highlights': { bg: '#ede9fe', text: '#5b21b6' },
  'relay': { bg: '#fee2e2', text: '#991b1b' },
}

// ── Shared styles ───────────────────────────────────────────────

const card: React.CSSProperties = {
  background: 'white',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: 12,
}

const sectionLabel: React.CSSProperties = {
  fontSize: 10,
  color: '#999',
  textTransform: 'uppercase' as const,
  fontWeight: 700,
  letterSpacing: 1,
  marginBottom: 8,
}

const bigNumber: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  marginTop: 4,
}

const dimText: React.CSSProperties = {
  fontSize: 10,
  color: '#666',
  marginTop: 2,
}

const tileLabel: React.CSSProperties = {
  fontSize: 9,
  color: '#888',
  textTransform: 'uppercase' as const,
  fontWeight: 600,
}

// ── Component ───────────────────────────────────────────────────

export default function OpsClient({ initialData }: { initialData: DashboardData | null }) {
  const [data, setData] = useState<DashboardData | null>(initialData)
  const [lastFetched, setLastFetched] = useState<Date | null>(initialData ? new Date() : null)
  const [fetchAgo, setFetchAgo] = useState('just now')

  const poll = useCallback(async () => {
    try {
      const res = await fetch('/ops/api/status')
      if (!res.ok) return
      const json = await res.json()
      setData(json)
      setLastFetched(new Date())
    } catch { /* silent */ }
  }, [])

  // Poll every 30s
  useEffect(() => {
    const interval = setInterval(poll, 30000)
    return () => clearInterval(interval)
  }, [poll])

  // Update "ago" display every 5s
  useEffect(() => {
    const interval = setInterval(() => {
      if (!lastFetched) return
      const secs = Math.floor((Date.now() - lastFetched.getTime()) / 1000)
      if (secs < 5) setFetchAgo('just now')
      else if (secs < 60) setFetchAgo(`${secs}s ago`)
      else setFetchAgo(`${Math.floor(secs / 60)}m ago`)
    }, 5000)
    return () => clearInterval(interval)
  }, [lastFetched])

  if (!data) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#f8f9fa', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#999' }}>Loading dashboard...</p>
      </div>
    )
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#f8f9fa', overflow: 'auto' }}>
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#111' }}>PadelNacho Ops</div>
          <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>Auto-refreshes every 30s</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e' }} />
          <span style={{ fontSize: 11, color: '#888' }}>Updated {fetchAgo}</span>
        </div>
      </div>

      {/* Section 1: Integration Health */}
      <div style={sectionLabel}>Integration Health</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 20 }}>
        {TILES.map(tile => {
          const h = data.health[tile.key]
          const color = statusColor(h?.status ?? 'unknown')
          return (
            <div key={tile.key} style={{ ...card, border: statusBorder(h?.status ?? 'unknown'), borderLeft: `3px solid ${color}` }}>
              <div style={tileLabel}>{tile.label}</div>
              <div style={{ fontSize: 10, color: '#bbb', marginBottom: 6 }}>{tile.schedule}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
                <span style={{ fontSize: 13, fontWeight: 600, color }}>{statusLabel(h?.status ?? 'unknown')}</span>
              </div>
              <div style={{ fontSize: 10, color: '#999', marginTop: 4 }}>
                {timeAgo(h?.started_at ?? null)} · {formatDuration(h?.duration_ms ?? null)}
              </div>
              <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>
                {h?.error_message ? <span style={{ color: '#dc2626' }}>{h.error_message.slice(0, 60)}</span> : metaSummary(tile.key, h?.meta ?? null)}
              </div>
            </div>
          )
        })}

        {/* Relay tile */}
        {(() => {
          const r = data.relay
          const color = r.ok ? '#22c55e' : '#ef4444'
          const label = r.ok ? 'Connected' : r.pusher_state === 'unreachable' ? 'Unreachable' : 'Disconnected'
          return (
            <div style={{ ...card, border: r.ok ? '1px solid #e5e7eb' : '1px solid #fecaca', borderLeft: `3px solid ${color}` }}>
              <div style={tileLabel}>Relay (Pusher)</div>
              <div style={{ fontSize: 10, color: '#bbb', marginBottom: 6 }}>Always-on</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
                <span style={{ fontSize: 13, fontWeight: 600, color }}>{label}</span>
              </div>
              <div style={{ fontSize: 10, color: '#999', marginTop: 4 }}>
                {r.active_channels} channels · {r.pusher_state}
              </div>
            </div>
          )
        })()}

        {/* API Budget tile */}
        {(() => {
          const scoresMeta = data.health['cron:scores']?.meta
          const remaining = scoresMeta?.api_requests ?? 0
          const daily = 2000
          const used = daily - remaining
          const pct = Math.min(100, Math.round((used / daily) * 100))
          return (
            <div style={{ ...card, borderLeft: '3px solid #3b82f6' }}>
              <div style={tileLabel}>API Budget</div>
              <div style={{ fontSize: 10, color: '#bbb', marginBottom: 6 }}>padelapi.org</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#1e40af' }}>{used.toLocaleString()}</div>
              <div style={{ height: 4, background: '#f0f0f0', borderRadius: 2, marginTop: 4 }}>
                <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, #3b82f6, #60a5fa)', borderRadius: 2 }} />
              </div>
              <div style={{ fontSize: 10, color: '#999', marginTop: 4 }}>/ {daily.toLocaleString()} daily</div>
            </div>
          )
        })()}
      </div>

      {/* Section 2: Data Freshness */}
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
              #{data.freshness.stale_matches[0]?.external_id} · no update in {timeAgo(data.freshness.stale_matches[0]?.updated_at)}
            </div>
          )}
        </div>
      </div>

      {/* Section 3: Data Quality */}
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
      </div>

      {/* Section 4: App Usage — placeholder for v2 */}
      {data.usage && (
        <>
          <div style={sectionLabel}>App Usage (24h)</div>
          <div style={{ ...card, marginBottom: 20, color: '#999', fontSize: 12 }}>
            Analytics integration coming in v2
          </div>
        </>
      )}

      {/* Section 5: Recent Events */}
      <div style={sectionLabel}>Recent Events</div>
      <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
              <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Time</th>
              <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Source</th>
              <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Status</th>
              <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Duration</th>
              <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Details</th>
            </tr>
          </thead>
          <tbody>
            {data.recent_events.map((evt, i) => {
              const sc = SOURCE_COLORS[evt.source] ?? { bg: '#f3f4f6', text: '#374151' }
              const shortSource = evt.source.replace('cron:', '')
              return (
                <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '6px 12px', color: '#999' }}>{timeAgo(evt.started_at)}</td>
                  <td style={{ padding: '6px 12px' }}>
                    <span style={{ background: sc.bg, color: sc.text, padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 500 }}>
                      {shortSource}
                    </span>
                  </td>
                  <td style={{ padding: '6px 12px', color: statusColor(evt.status) }}>
                    {evt.status === 'ok' ? '\u2713' : evt.status === 'error' ? '\u2717' : '\u26A0'} {evt.status}
                  </td>
                  <td style={{ padding: '6px 12px', color: '#666' }}>{formatDuration(evt.duration_ms)}</td>
                  <td style={{ padding: '6px 12px', color: evt.error_message ? '#dc2626' : '#666' }}>
                    {evt.error_message ?? metaSummary(evt.source, evt.meta)}
                  </td>
                </tr>
              )
            })}
            {data.recent_events.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: '20px 12px', textAlign: 'center', color: '#999' }}>
                  No events yet. Events will appear after cron jobs run.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
    </div>
  )
}

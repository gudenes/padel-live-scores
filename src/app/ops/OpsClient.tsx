'use client'
// src/app/ops/OpsClient.tsx
// Client component: renders the ops dashboard and polls every 30s.

import { useEffect, useState, useCallback } from 'react'
import EntryListTab from './EntryListTab'
import SimulatorTab from './SimulatorTab'

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

interface OngoingEvent {
  tournament_id: string
  name: string
  level: string | null
  country: string | null
  categories: string[]
  live: number
  scheduled: number
  finished: number
  total: number
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
    ongoing_events: number
    ongoing_live_matches: number
    ongoing_scheduled_matches: number
  }
  ongoing: OngoingEvent[]
  cron_stats: Record<string, { runs: number; ok_runs: number; datapoints: number }>
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
  { key: 'cron:scores', label: 'Scores', schedule: 'Every 2 min', description: 'Polls padelapi.org for live match scores, upserts point/game/set data, detects stale matches stuck as live' },
  { key: 'cron:sync-matches', label: 'Sync Matches', schedule: 'Every 1h', description: 'Syncs match metadata (players, courts, rounds) for all active tournaments from padelapi.org' },
  { key: 'cron:sync', label: 'Full Sync', schedule: 'Mon 4am UTC', description: 'Weekly full sync: tournaments, players, seasons, and FIP logos from padelapi.org' },
  { key: 'cron:rankings', label: 'Rankings', schedule: 'Daily 5am UTC', description: 'Fetches FIP official and race rankings (top 1000, men & women) from the FIP website' },
  { key: 'cron:articles', label: 'Articles', schedule: 'Hourly :40', description: 'Fetches padel news from Google News RSS feeds and FIP WordPress API, deduplicates and upserts' },
  { key: 'cron:highlights', label: 'Highlights', schedule: 'Hourly :20', description: 'Fetches recent match highlight videos from YouTube padel channels, filters duplicates' },
  { key: 'cron:fip-tournaments', label: 'FIP Tournaments', schedule: 'Every 12h', description: 'Syncs FIP tournament data including draws, brackets, and scheduling from the FIP API' },
  { key: 'cron:fip-scores', label: 'FIP Scores', schedule: 'Every 2h', description: 'Polls FIP API for live match scores in FIP-sourced tournaments, upserts results' },
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
    case 'cron:fip-tournaments': return `${meta.upserted ?? 0} upserted · ${meta.enriched ?? 0} enriched`
    case 'cron:fip-scores': return `${meta.matches_upserted ?? 0} matches · ${meta.active_tournaments ?? 0} tournaments`
    default: return ''
  }
}

function InfoTooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false)
  return (
    <span
      style={{ position: 'relative', display: 'inline-block', marginLeft: 4, cursor: 'help' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <span style={{ fontSize: 10, color: '#aaa', fontWeight: 400, border: '1px solid #ddd', borderRadius: '50%', width: 14, height: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>?</span>
      {show && (
        <span style={{
          position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 6,
          background: '#1f2937', color: '#fff', fontSize: 11, lineHeight: '1.4', padding: '6px 10px',
          borderRadius: 6, whiteSpace: 'normal', width: 220, zIndex: 10, boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          pointerEvents: 'none',
        }}>
          {text}
        </span>
      )}
    </span>
  )
}

const SOURCE_COLORS: Record<string, { bg: string; text: string }> = {
  'cron:scores': { bg: '#dbeafe', text: '#1e40af' },
  'cron:sync': { bg: '#d1fae5', text: '#065f46' },
  'cron:sync-matches': { bg: '#d1fae5', text: '#065f46' },
  'cron:rankings': { bg: '#fef3c7', text: '#92400e' },
  'cron:articles': { bg: '#fce7f3', text: '#9d174d' },
  'cron:highlights': { bg: '#ede9fe', text: '#5b21b6' },
  'cron:fip-tournaments': { bg: '#ccfbf1', text: '#115e59' },
  'cron:fip-scores': { bg: '#ccfbf1', text: '#115e59' },
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
  const [tab, setTab] = useState<'ongoing' | 'health' | 'data' | 'entry-lists' | 'simulator'>('ongoing')

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

  const liveCount = data.ongoing.reduce((n, e) => n + e.live, 0)

  const navGroups = [
    {
      label: null,
      items: [
        { key: 'ongoing' as const, label: 'Ongoing Events', badge: liveCount > 0 ? `${liveCount} live` : data.ongoing.length > 0 ? `${data.ongoing.length}` : null },
      ],
    },
    {
      label: 'Platform Health',
      items: [
        { key: 'health' as const, label: 'Integration Health', badge: null },
        { key: 'data' as const, label: 'Data Quality', badge: null },
      ],
    },
    {
      label: 'Tournament Manager',
      items: [
        { key: 'entry-lists' as const, label: 'Entry Lists', badge: null },
        { key: 'simulator' as const, label: 'Simulator', badge: null },
      ],
    },
  ]

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#f8f9fa', display: 'flex' }}>
      {/* ── Sidebar ── */}
      <nav style={{
        width: 220, flexShrink: 0, background: '#fff', borderRight: '1px solid #e5e7eb',
        display: 'flex', flexDirection: 'column', overflow: 'auto',
      }}>
        {/* Logo / Title */}
        <div style={{ padding: '20px 16px 12px' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#111' }}>PadelNacho Ops</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#22c55e' }} />
            <span style={{ fontSize: 10, color: '#999' }}>Updated {fetchAgo}</span>
          </div>
        </div>

        {/* Nav groups */}
        <div style={{ flex: 1, padding: '4px 0' }}>
          {navGroups.map((group, gi) => (
            <div key={gi} style={{ marginBottom: 4 }}>
              {group.label && (
                <div style={{
                  fontSize: 9, fontWeight: 700, color: '#999', textTransform: 'uppercase',
                  letterSpacing: '0.8px', padding: '12px 16px 4px',
                }}>
                  {group.label}
                </div>
              )}
              {group.items.map(item => {
                const active = tab === item.key
                return (
                  <button
                    key={item.key}
                    onClick={() => setTab(item.key)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      width: '100%', padding: '8px 16px', border: 'none', cursor: 'pointer',
                      fontSize: 13, fontWeight: active ? 600 : 400,
                      color: active ? '#111' : '#555',
                      background: active ? '#f3f4f6' : 'transparent',
                      borderLeft: active ? '3px solid #111' : '3px solid transparent',
                      textAlign: 'left',
                    }}
                  >
                    {item.label}
                    {item.badge && (
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 8,
                        background: item.badge.includes('live') ? '#dcfce7' : '#f3f4f6',
                        color: item.badge.includes('live') ? '#166534' : '#666',
                      }}>
                        {item.badge}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </nav>

      {/* ── Main content ── */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px 28px' }}>
      <div style={{ maxWidth: 1000 }}>

      {/* Ongoing Events page */}
      {tab === 'ongoing' && (
        <>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#111', marginBottom: 16 }}>Ongoing Events</div>
          {data.ongoing.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
              {data.ongoing.map(evt => {
                const progress = evt.total > 0 ? Math.round(((evt.finished) / evt.total) * 100) : 0
                const hasLive = evt.live > 0
                const isQualifying = (evt as any).qualifying === true
                return (
                  <div key={evt.tournament_id} style={{
                    ...card,
                    borderLeft: hasLive ? '3px solid #22c55e' : isQualifying ? '3px solid #f59e0b' : '3px solid #3b82f6',
                    padding: 14,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#111', lineHeight: 1.3 }}>{evt.name}</div>
                        <div style={{ fontSize: 10, color: '#999', marginTop: 2 }}>
                          {[evt.level, evt.country, ...evt.categories].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      {hasLive ? (
                        <span style={{
                          fontSize: 9, fontWeight: 700, color: '#fff', background: '#22c55e',
                          padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase', flexShrink: 0, marginLeft: 8,
                        }}>LIVE</span>
                      ) : isQualifying ? (
                        <span style={{
                          fontSize: 9, fontWeight: 700, color: '#92400e', background: 'rgba(245,158,11,0.15)',
                          padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase', flexShrink: 0, marginLeft: 8,
                        }}>QUALIFYING</span>
                      ) : null}
                    </div>
                    <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
                      <div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: hasLive ? '#166534' : '#666' }}>{evt.live}</div>
                        <div style={{ fontSize: 9, color: '#999', textTransform: 'uppercase' }}>Live</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: '#1e40af' }}>{evt.scheduled}</div>
                        <div style={{ fontSize: 9, color: '#999', textTransform: 'uppercase' }}>Scheduled</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: '#666' }}>{evt.finished}</div>
                        <div style={{ fontSize: 9, color: '#999', textTransform: 'uppercase' }}>Finished</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: '#111' }}>{evt.total}</div>
                        <div style={{ fontSize: 9, color: '#999', textTransform: 'uppercase' }}>Total</div>
                      </div>
                    </div>
                    <div style={{ height: 4, background: '#f0f0f0', borderRadius: 2, marginTop: 8 }}>
                      <div style={{
                        height: '100%', borderRadius: 2,
                        width: `${progress}%`,
                        background: progress === 100 ? '#22c55e' : 'linear-gradient(90deg, #3b82f6, #60a5fa)',
                      }} />
                    </div>
                    <div style={{ fontSize: 9, color: '#999', marginTop: 3, textAlign: 'right' }}>{progress}% complete</div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div style={{ ...card, textAlign: 'center', color: '#999', fontSize: 12 }}>
              No ongoing events — all tournaments are between rounds
            </div>
          )}
        </>
      )}

      {tab === 'health' && <>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#111', marginBottom: 16 }}>Integration Health</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 20 }}>
        {TILES.map(tile => {
          const h = data.health[tile.key]
          const stats = data.cron_stats?.[tile.key]
          const color = statusColor(h?.status ?? 'unknown')
          return (
            <div key={tile.key} style={{ ...card, border: statusBorder(h?.status ?? 'unknown'), borderLeft: `3px solid ${color}` }}>
              <div style={{ ...tileLabel, display: 'flex', alignItems: 'center' }}>{tile.label}<InfoTooltip text={tile.description} /></div>
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
              {stats && (
                <div style={{ fontSize: 10, color: '#999', marginTop: 4, borderTop: '1px solid #f3f4f6', paddingTop: 4, display: 'flex', justifyContent: 'space-between' }}>
                  <span>{stats.runs} runs ({stats.ok_runs} ok)</span>
                  <span>{stats.datapoints.toLocaleString()} datapoints</span>
                </div>
              )}
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
              <div style={{ ...tileLabel, display: 'flex', alignItems: 'center' }}>Relay (Pusher)<InfoTooltip text="Railway Node.js service with persistent Pusher WebSocket connection. Receives real-time point-by-point updates and writes them to Supabase." /></div>
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
              <div style={{ ...tileLabel, display: 'flex', alignItems: 'center' }}>API Budget<InfoTooltip text="Daily API request budget for padelapi.org. Limit: 2,000/day, 10/min. The scores cron tracks remaining requests per run." /></div>
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
      </>}

      {tab === 'data' && <>
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

      </>}

      {tab === 'entry-lists' && <>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#111', marginBottom: 16 }}>Entry Lists</div>
        <EntryListTab />
      </>}

      {tab === 'simulator' && <>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#111', marginBottom: 16 }}>Simulator</div>
        <SimulatorTab />
      </>}

      </div>
      </div>
    </div>
  )
}

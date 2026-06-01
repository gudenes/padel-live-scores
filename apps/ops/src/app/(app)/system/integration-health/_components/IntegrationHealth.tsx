'use client'

import { useEffect, useState } from 'react'
import { PageHeader, Section, DataTable, Skeleton } from '@/components/ui'
import {
  type DashboardData,
  TILES,
  timeAgo,
  formatDuration,
  statusColor,
  statusLabel,
  statusBorder,
  metaSummary,
  SOURCE_COLORS,
  card,
  tileLabel,
} from '../../_shared/ops-status-types'

// ── InfoTooltip sub-component ─────────────────────────────────────

function InfoTooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false)
  return (
    <span
      style={{ position: 'relative', display: 'inline-block', marginLeft: 4, cursor: 'help' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <span style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 400, border: '1px solid var(--border-card)', borderRadius: '50%', width: 14, height: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>?</span>
      {show && (
        <span style={{
          position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 6,
          background: 'var(--bg-surface)', color: 'var(--text-1)', fontSize: 11, lineHeight: '1.4', padding: '6px 10px',
          border: '1px solid var(--border-card)',
          borderRadius: 6, whiteSpace: 'normal', width: 220, zIndex: 10, boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          pointerEvents: 'none',
        }}>
          {text}
        </span>
      )}
    </span>
  )
}

// ── Main component ────────────────────────────────────────────────

export function IntegrationHealth() {
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
    return (
      <div className="ui-page">
        <PageHeader title="Integration Health" />
        <Skeleton rows={4} />
      </div>
    )
  }

  return (
    <div className="ui-page">
      <PageHeader title="Integration Health" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 20 }}>
        {TILES.map(tile => {
          const h = data.health[tile.key]
          const stats = data.cron_stats?.[tile.key]
          const isPaused = tile.paused === true
          const color = isPaused ? 'var(--text-3)' : statusColor(h?.status ?? 'unknown')
          const borderStyle = isPaused
            ? '1px dashed var(--border-strong)'
            : statusBorder(h?.status ?? 'unknown')
          return (
            <div key={tile.key} style={{ ...card, border: borderStyle, borderLeft: `3px solid ${color}`, opacity: isPaused ? 0.75 : 1, background: isPaused ? 'var(--bg-card-2)' : 'var(--bg-card)' }}>
              <div style={{ ...tileLabel, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ display: 'flex', alignItems: 'center' }}>
                  {tile.label}
                  <InfoTooltip text={isPaused && tile.pauseReason ? `${tile.description}\n\nPAUSED: ${tile.pauseReason}` : tile.description} />
                </span>
                {isPaused && (
                  <span style={{ fontSize: 8, fontWeight: 700, color: 'var(--text-3)', background: 'var(--bg-hover)', padding: '1px 5px', borderRadius: 3, letterSpacing: 0.3 }}>PAUSED</span>
                )}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 6 }}>{tile.schedule}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
                <span style={{ fontSize: 13, fontWeight: 600, color }}>{isPaused ? 'Paused' : statusLabel(h?.status ?? 'unknown')}</span>
              </div>
              {!isPaused && (
                <>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>
                    {timeAgo(h?.started_at ?? null)} · {formatDuration(h?.duration_ms ?? null)}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-2)', marginTop: 2 }}>
                    {h?.error_message ? <span style={{ color: 'var(--live-text)' }}>{h.error_message.slice(0, 60)}</span> : metaSummary(tile.key, h?.meta ?? null)}
                  </div>
                  {stats && (
                    <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4, borderTop: '1px solid var(--border-inner)', paddingTop: 4, display: 'flex', justifyContent: 'space-between' }}>
                      <span>{stats.runs} runs ({stats.ok_runs} ok)</span>
                      <span>{stats.datapoints.toLocaleString()} datapoints</span>
                    </div>
                  )}
                </>
              )}
              {isPaused && tile.pauseReason && (
                <div style={{ fontSize: 9, color: 'var(--text-3)', marginTop: 4, fontStyle: 'italic', lineHeight: 1.3 }}>
                  {tile.pauseReason}
                </div>
              )}
            </div>
          )
        })}

        {/* Relay tile */}
        {(() => {
          const r = data.relay
          const color = r.ok ? 'var(--lime)' : 'var(--live)'
          const label = r.ok ? 'Connected' : r.pusher_state === 'unreachable' ? 'Unreachable' : 'Disconnected'
          return (
            <div style={{ ...card, border: r.ok ? '1px solid var(--border-card)' : '1px solid var(--live-border)', borderLeft: `3px solid ${color}` }}>
              <div style={{ ...tileLabel, display: 'flex', alignItems: 'center' }}>Relay (Pusher)<InfoTooltip text="Railway Node.js service with persistent Pusher WebSocket connection. Receives real-time point-by-point updates and writes them to Supabase." /></div>
              <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 6 }}>Always-on</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
                <span style={{ fontSize: 13, fontWeight: 600, color }}>{label}</span>
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>
                {r.active_channels} channels · {r.pusher_state}
              </div>
            </div>
          )
        })()}

        {/* API Budget tile */}
        {(() => {
          const scoresMeta = data.health['cron:scores']?.meta
          const remaining = (scoresMeta?.api_requests as number) ?? 0
          const daily = 2000
          const used = daily - remaining
          const pct = Math.min(100, Math.round((used / daily) * 100))
          return (
            <div style={{ ...card, borderLeft: '3px solid var(--men)' }}>
              <div style={{ ...tileLabel, display: 'flex', alignItems: 'center' }}>API Budget<InfoTooltip text="Daily API request budget for padelapi.org. Limit: 2,000/day, 10/min. The scores cron tracks remaining requests per run." /></div>
              <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 6 }}>padelapi.org</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--men)' }}>{used.toLocaleString()}</div>
              <div style={{ height: 4, background: 'var(--bg-hover)', borderRadius: 2, marginTop: 4 }}>
                <div style={{ height: '100%', width: `${pct}%`, background: 'var(--men)', borderRadius: 2 }} />
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>/ {daily.toLocaleString()} daily</div>
            </div>
          )
        })()}
      </div>

      {/* Recent Events */}
      <Section label="Recent Events">
        <DataTable>
          <thead>
            <tr>
              <th>Time</th>
              <th>Source</th>
              <th>Status</th>
              <th>Duration</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {data.recent_events.map((evt, i) => {
              const sc = SOURCE_COLORS[evt.source] ?? { bg: 'var(--bg-hover)', text: 'var(--text-2)' }
              const shortSource = evt.source.replace('cron:', '')
              return (
                <tr key={i}>
                  <td style={{ color: 'var(--text-3)' }}>{timeAgo(evt.started_at)}</td>
                  <td>
                    <span style={{ background: sc.bg, color: sc.text, padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 500 }}>
                      {shortSource}
                    </span>
                  </td>
                  <td style={{ color: statusColor(evt.status) }}>
                    {evt.status === 'ok' ? '✓' : evt.status === 'error' ? '✗' : '⚠'} {evt.status}
                  </td>
                  <td style={{ color: 'var(--text-2)' }}>{formatDuration(evt.duration_ms)}</td>
                  <td style={{ color: evt.error_message ? 'var(--live-text)' : 'var(--text-2)' }}>
                    {evt.error_message ?? metaSummary(evt.source, evt.meta)}
                  </td>
                </tr>
              )
            })}
            {data.recent_events.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: '20px 12px', textAlign: 'center', color: 'var(--text-3)' }}>
                  No events yet. Events will appear after cron jobs run.
                </td>
              </tr>
            )}
          </tbody>
        </DataTable>
      </Section>
    </div>
  )
}

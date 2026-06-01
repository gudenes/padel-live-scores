'use client'

import { useEffect, useState } from 'react'
import { PageHeader, Section, KpiStrip, Kpi, Skeleton } from '@/components/ui'
import {
  type DashboardData,
  timeAgo,
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
    return (
      <div className="ui-page">
        <PageHeader title="Data Quality" />
        <Skeleton rows={4} />
      </div>
    )
  }

  const staleCount = data.freshness.stale_matches.length

  return (
    <div className="ui-page">
      <PageHeader title="Data Quality" />

      <Section label="Data Freshness">
        <KpiStrip cols={3}>
          <Kpi label="Live Matches" value={data.freshness.live_matches} />
          <Kpi label="Last Score Update" value={timeAgo(data.freshness.last_score_update)} />
          <Kpi
            label="Stale Matches"
            value={
              <span style={{ color: staleCount > 0 ? 'var(--live-text)' : undefined }}>
                {staleCount}
                {staleCount > 0 && (
                  <span style={{ display: 'block', fontSize: 10, fontWeight: 400, color: 'var(--live-text)', marginTop: 4 }}>
                    #{data.freshness.stale_matches[0]?.external_id} · no update in {timeAgo(data.freshness.stale_matches[0]?.updated_at ?? null)}
                  </span>
                )}
              </span>
            }
            tone={staleCount > 0 ? 'urgent' : 'neutral'}
          />
        </KpiStrip>
      </Section>

      <Section label="Data Quality">
        <KpiStrip cols={4}>
          <Kpi
            label="Total Matches"
            value={
              <span>
                {data.quality.total_matches.toLocaleString()}
                <span style={{ display: 'block', fontSize: 10, fontWeight: 400, color: 'var(--text-2)', marginTop: 4 }}>
                  across {data.quality.total_tournaments} tournaments
                </span>
              </span>
            }
          />
          <Kpi
            label="With PBP Data"
            value={
              <span style={{ color: 'var(--lime-text)' }}>
                {data.quality.total_matches > 0 ? Math.round((data.quality.with_pbp / data.quality.total_matches) * 100) : 0}%
                <span style={{ display: 'block', fontSize: 10, fontWeight: 400, color: 'var(--text-2)', marginTop: 4 }}>
                  {data.quality.with_pbp.toLocaleString()} matches
                </span>
              </span>
            }
            tone="lime"
          />
          <Kpi
            label="Missing Scores"
            value={
              <span style={{ color: data.quality.missing_scores > 0 ? 'var(--orange-text)' : undefined }}>
                {data.quality.missing_scores}
                <span style={{ display: 'block', fontSize: 10, fontWeight: 400, color: 'var(--text-2)', marginTop: 4 }}>
                  finished, no winner
                </span>
              </span>
            }
            tone={data.quality.missing_scores > 0 ? 'warn' : 'neutral'}
          />
          <Kpi
            label="Unresolved Players"
            value={
              <span style={{ color: data.quality.unresolved_players > 0 ? 'var(--orange-text)' : undefined }}>
                {data.quality.unresolved_players}
                <span style={{ display: 'block', fontSize: 10, fontWeight: 400, color: 'var(--text-2)', marginTop: 4 }}>
                  missing external_id
                </span>
              </span>
            }
            tone={data.quality.unresolved_players > 0 ? 'warn' : 'neutral'}
          />
          <Kpi
            label="Ongoing Events"
            value={
              <span style={{ color: 'var(--women)' }}>
                {data.quality.ongoing_events}
                <span style={{ display: 'block', fontSize: 10, fontWeight: 400, color: 'var(--text-2)', marginTop: 4 }}>
                  tournaments with active matches
                </span>
              </span>
            }
            tone="neutral"
          />
          <Kpi
            label="Live Matches"
            value={
              <span style={{ color: 'var(--lime-text)' }}>
                {data.quality.ongoing_live_matches}
                <span style={{ display: 'block', fontSize: 10, fontWeight: 400, color: 'var(--text-2)', marginTop: 4 }}>
                  in progress right now
                </span>
              </span>
            }
            tone="lime"
          />
          <Kpi
            label="Scheduled Matches"
            value={
              <span style={{ color: 'var(--men)' }}>
                {data.quality.ongoing_scheduled_matches}
                <span style={{ display: 'block', fontSize: 10, fontWeight: 400, color: 'var(--text-2)', marginTop: 4 }}>
                  upcoming in ongoing events
                </span>
              </span>
            }
            tone="neutral"
          />
        </KpiStrip>
      </Section>
    </div>
  )
}

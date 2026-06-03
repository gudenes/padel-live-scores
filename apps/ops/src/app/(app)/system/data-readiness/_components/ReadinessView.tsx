'use client'

import { useEffect, useMemo, useState } from 'react'
import { PageHeader, KpiStrip, Kpi, Button, EmptyState, Skeleton } from '@/components/ui'
import type { ReadinessRow, ViewMode, GroupBy, Verdict, Stage } from './types'
import ReadinessList from './ReadinessList'
import ReadinessCalendar from './ReadinessCalendar'

const TIER_FILTERS: Array<{ code: string; label: string }> = [
  { code: 'major', label: 'Major' }, { code: 'p1', label: 'P1' }, { code: 'p2', label: 'P2' }, { code: 'finals', label: 'Finals' },
  { code: 'fip_platinum', label: 'Platinum' }, { code: 'fip_gold', label: 'Gold' }, { code: 'fip_silver', label: 'Silver' }, { code: 'fip_bronze', label: 'Bronze' },
]

export default function ReadinessView() {
  const [rows, setRows] = useState<ReadinessRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<ViewMode>('list')
  const [groupBy, setGroupBy] = useState<GroupBy>('tier')
  const [tierFilter, setTierFilter] = useState<Set<string>>(new Set())
  const [stageFilter, setStageFilter] = useState<Stage | null>(null)
  const [verdictFilter, setVerdictFilter] = useState<Verdict | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/internal/tournament-readiness')
      .then(r => r.json())
      .then((d: { rows?: ReadinessRow[]; error?: string }) => {
        if (cancelled) return
        if (d.error) { setError(d.error); return }
        setRows(d.rows ?? [])
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'failed') })
    return () => { cancelled = true }
  }, [])

  const filtered = useMemo(() => (rows ?? []).filter(r =>
    (tierFilter.size === 0 || (r.level !== null && tierFilter.has(r.level))) &&
    (stageFilter === null || r.stage === stageFilter) &&
    (verdictFilter === null || r.verdict === verdictFilter),
  ), [rows, tierFilter, stageFilter, verdictFilter])

  const counts = useMemo(() => {
    const c = { total: filtered.length, broken: 0, gaps: 0, ok: 0, divergent: 0 }
    for (const r of filtered) { c[r.verdict] += 1; if (r.divergent) c.divergent += 1 }
    return c
  }, [filtered])

  const toggleTier = (code: string) => setTierFilter(prev => {
    const next = new Set(prev)
    if (next.has(code)) next.delete(code); else next.add(code)
    return next
  })

  return (
    <div className="ui-page">
      <PageHeader
        title="Tournament Data Readiness"
        subtitle="2026 · main tiers. Each tournament is scored against status- & tier-aware expectations, measured against the public tables. Red = data the app needs is missing or was scraped-but-not-populated."
        actions={
          <div style={{ display: 'flex', gap: 4 }}>
            <Button variant={view === 'list' ? 'primary' : 'ghost'} size="sm" onClick={() => setView('list')}>List</Button>
            <Button variant={view === 'calendar' ? 'primary' : 'ghost'} size="sm" onClick={() => setView('calendar')}>Calendar</Button>
          </div>
        }
      />

      <KpiStrip cols={5}>
        <Kpi label="In scope" value={counts.total} />
        <Kpi label="Broken" value={counts.broken} tone="urgent" />
        <Kpi label="Gaps" value={counts.gaps} tone="warn" />
        <Kpi label="OK" value={counts.ok} tone="lime" />
        <Kpi label="Scraped, not populated" value={counts.divergent} tone="urgent" pulse={counts.divergent > 0} />
      </KpiStrip>

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center', margin: '14px 0' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text-3)' }}>Tier</span>
          {TIER_FILTERS.map(t => (
            <button key={t.code} onClick={() => toggleTier(t.code)} className="ui-chip" data-on={tierFilter.has(t.code)}>{t.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text-3)' }}>Stage</span>
          {(['upcoming', 'ongoing', 'completed'] as Stage[]).map(s => (
            <button key={s} onClick={() => setStageFilter(stageFilter === s ? null : s)} className="ui-chip" data-on={stageFilter === s}>{s}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text-3)' }}>Verdict</span>
          {(['broken', 'gaps', 'ok'] as Verdict[]).map(v => (
            <button key={v} onClick={() => setVerdictFilter(verdictFilter === v ? null : v)} className="ui-chip" data-on={verdictFilter === v}>{v}</button>
          ))}
        </div>
        {view === 'list' && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
            <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text-3)' }}>Group by</span>
            {(['tier', 'stage', 'verdict'] as GroupBy[]).map(g => (
              <button key={g} onClick={() => setGroupBy(g)} className="ui-chip" data-on={groupBy === g}>{g}</button>
            ))}
          </div>
        )}
      </div>

      {error && <EmptyState title="Couldn't load readiness" hint={error} />}
      {!error && rows === null && <Skeleton rows={8} />}
      {!error && rows !== null && filtered.length === 0 && <EmptyState title="No tournaments match" hint="Adjust the filters." />}
      {!error && rows !== null && filtered.length > 0 && (
        view === 'list'
          ? <ReadinessList rows={filtered} groupBy={groupBy} />
          : <ReadinessCalendar rows={filtered} />
      )}
    </div>
  )
}

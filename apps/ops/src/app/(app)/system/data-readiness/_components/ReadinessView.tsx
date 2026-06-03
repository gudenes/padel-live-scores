'use client'

import { useEffect, useMemo, useState } from 'react'
import { PageHeader, KpiStrip, Kpi, Button, EmptyState, Skeleton } from '@/components/ui'
import type { ReadinessRow, ViewMode, GroupBy, Verdict, Stage } from './types'
import ReadinessList from './ReadinessList'
import ReadinessCalendar from './ReadinessCalendar'
import BulkRefreshBar from './BulkRefreshBar'
import { useBulkRefresh } from './useBulkRefresh'

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
  const [year, setYear] = useState<number>(new Date().getUTCFullYear())
  const [years, setYears] = useState<number[]>([])

  useEffect(() => {
    let cancelled = false
    setRows(null)
    fetch(`/api/internal/tournament-readiness?year=${year}`)
      .then(r => r.json())
      .then((d: { rows?: ReadinessRow[]; years?: number[]; error?: string }) => {
        if (cancelled) return
        if (d.error) { setError(d.error); return }
        const yrs = d.years ?? []
        setYears(yrs)
        // Fallback: selected year has no in-scope data → jump to the most recent year that does.
        if (yrs.length > 0 && !yrs.includes(year)) { setYear(yrs[0]); return }
        setRows(d.rows ?? [])
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'failed') })
    return () => { cancelled = true }
  }, [year])

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

  // Replace a single row in place after a per-row refresh + re-check.
  const onRowUpdate = (updated: ReadinessRow) =>
    setRows(prev => (prev ? prev.map(r => (r.id === updated.id ? updated : r)) : prev))

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const toggleSelect = (id: string) => setSelectedIds(prev => {
    const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n
  })
  const bulk = useBulkRefresh(onRowUpdate)

  const startBulk = () => {
    const ids = [...selectedIds]
    if (ids.length > 50 && !window.confirm(`Refresh ${ids.length} tournaments? This hits padelgod/Crionet for each.`)) return
    bulk.start(ids)
  }
  const clearSel = () => { setSelectedIds(new Set()); bulk.reset() }
  // Switching year invalidates any current selection / in-flight bulk state.
  const onYearChange = (y: number) => { setYear(y); setSelectedIds(new Set()); bulk.reset() }

  return (
    <div className="ui-page">
      <PageHeader
        title="Tournament Data Readiness"
        subtitle="Main tiers, by year. Each tournament is scored against status- & tier-aware expectations, measured against the public tables. Red = data the app needs is missing or was scraped-but-not-populated."
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
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text-3)' }}>Year</span>
          <select
            value={year}
            onChange={(e) => onYearChange(Number(e.target.value))}
            className="ui-chip"
            style={{ paddingRight: 8 }}
            aria-label="Year"
          >
            {(years.length > 0 ? years : [year]).map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
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
        <>
          {view === 'list' && (
            <BulkRefreshBar
              selectedCount={selectedIds.size}
              running={bulk.running}
              tally={bulk.tally}
              onRefresh={startBulk}
              onStop={bulk.stop}
              onClear={clearSel}
            />
          )}
          {view === 'list'
            ? <ReadinessList
                rows={filtered}
                groupBy={groupBy}
                onRowUpdate={onRowUpdate}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                statusById={bulk.statusById}
              />
            : <ReadinessCalendar key={year} rows={filtered} initialYear={year} />
          }
        </>
      )}
    </div>
  )
}

'use client'
// apps/ops/src/app/(app)/needs-review/_components/TournamentDedupTab.tsx
//
// Cross-source tournament dedup workspace. Calls /api/internal/tournament-dedup
// (GET = dry-run plan, POST = execute). Operator can preview the entire
// plan, then click "Execute" to apply. Manual-review groups (multiple
// rows with FK refs) are listed separately so they don't silently skip.

import { useEffect, useState } from 'react'
import { PageHeader, KpiStrip, Kpi, DataTable, Button, EmptyState, Section } from '@/components/ui'

interface TournamentRow {
  id: string
  name: string
  source: string | null
  padelapi_id: string | null
  fip_id: string | null
  level: string | null
  starts_at: string | null
  ends_at: string | null
  [key: string]: unknown
}

interface DedupAction {
  groupKey: string
  reason: 'ok' | 'manual_review' | string
  survivor: TournamentRow | null
  dying: TournamentRow[]
  updates: Record<string, unknown>
  fkCounts: Record<string, Record<string, number>>
}

interface PlanResponse {
  ok: boolean
  groupCount?: number
  autoMergeable?: number
  manualReview?: number
  groups?: DedupAction[]
  error?: string
}

interface ExecuteResponse {
  ok: boolean
  merged?: number
  skipped?: number
  failed?: number
  errors?: Array<{ groupKey: string; error: string }>
  error?: string
}

const card: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--r-lg)',
  padding: 14,
}

export default function TournamentDedupTab() {
  const [plan, setPlan] = useState<PlanResponse | null>(null)
  const [loadingPlan, setLoadingPlan] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [executeResult, setExecuteResult] = useState<ExecuteResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadPlan = () => {
    setLoadingPlan(true)
    setError(null)
    setExecuteResult(null)
    fetch('/api/internal/tournament-dedup', { cache: 'no-store' })
      .then(r => r.json())
      .then((j: PlanResponse) => {
        if (!j.ok) setError(j.error ?? 'Failed to load plan')
        else setPlan(j)
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load plan'))
      .finally(() => setLoadingPlan(false))
  }

  useEffect(() => { loadPlan() }, [])

  const execute = () => {
    if (!plan?.autoMergeable) return
    if (!confirm(`Merge ${plan.autoMergeable} duplicate group${plan.autoMergeable === 1 ? '' : 's'}? This deletes the dying tournament rows and copies their fields to the survivors. Manual-review groups are skipped.`)) return
    setExecuting(true)
    fetch('/api/internal/tournament-dedup', { method: 'POST', cache: 'no-store' })
      .then(r => r.json())
      .then((j: ExecuteResponse) => {
        setExecuteResult(j)
        if (j.ok) loadPlan()  // refresh plan after a successful run
      })
      .catch(e => setExecuteResult({ ok: false, error: e instanceof Error ? e.message : String(e) }))
      .finally(() => setExecuting(false))
  }

  const okGroups = (plan?.groups ?? []).filter(g => g.reason === 'ok')
  const manualGroups = (plan?.groups ?? []).filter(g => g.reason === 'manual_review')

  return (
    <div>
      <PageHeader
        title="Tournament Dedup"
        subtitle="Detects same-event tournaments split across sources (padelapi vs FIP) using normalized name + year + level family. The row with FK refs (matches, draws, etc.) survives; the other gets its fields merged in and is deleted. Groups where multiple rows have FK refs are flagged for manual review — those need direct SQL."
      />

      {/* Summary tiles */}
      <KpiStrip cols={3}>
        <Kpi label="Duplicate groups" value={plan?.groupCount ?? '—'} tone="neutral" />
        <Kpi label="Auto-mergeable" value={plan?.autoMergeable ?? '—'} tone="lime" />
        <Kpi label="Manual review" value={plan?.manualReview ?? '—'} tone="urgent" />
      </KpiStrip>

      {/* Action bar */}
      <div style={{ ...card, margin: '16px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button size="sm" onClick={loadPlan} disabled={loadingPlan}>
          {loadingPlan ? 'Loading...' : 'Refresh plan'}
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={execute}
          disabled={executing || !plan?.autoMergeable}
        >
          {executing ? 'Merging...' : `Execute merge (${plan?.autoMergeable ?? 0})`}
        </Button>
        <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 'auto' }}>
          Manual-review groups stay untouched
        </span>
      </div>

      {error && (
        <div style={{ ...card, color: 'var(--live-text)', marginBottom: 16 }}>Error: {error}</div>
      )}

      {executeResult && (
        <div
          style={{
            ...card,
            marginBottom: 16,
            background: executeResult.ok ? 'var(--lime-bg)' : 'var(--live-bg)',
            borderColor: executeResult.ok ? 'var(--lime-border)' : 'var(--live-border)',
          }}
        >
          {executeResult.ok ? (
            <div style={{ fontSize: 12, color: 'var(--lime-text)', fontWeight: 600 }}>
              Merged {executeResult.merged ?? 0} · Skipped {executeResult.skipped ?? 0} · Failed {executeResult.failed ?? 0}
              {executeResult.errors && executeResult.errors.length > 0 && (
                <ul style={{ marginTop: 6, color: 'var(--live-text)', fontSize: 11 }}>
                  {executeResult.errors.map((e, i) => (
                    <li key={i}><strong>{e.groupKey}:</strong> {e.error}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--live-text)' }}>Error: {executeResult.error}</div>
          )}
        </div>
      )}

      {/* Auto-mergeable groups */}
      {okGroups.length > 0 && (
        <Section label={`Auto-mergeable (${okGroups.length})`}>
          <DataTable>
            <thead>
              <tr>
                <th>Survivor</th>
                <th>Dying</th>
                <th>Year</th>
                <th>Updates</th>
              </tr>
            </thead>
            <tbody>
              {okGroups.map((g, i) => (
                <tr key={i}>
                  <td style={td}>
                    <div style={{ fontWeight: 600, color: 'var(--text-1)' }}>{g.survivor?.name ?? '—'}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>
                      {g.survivor?.source ?? '—'} · {g.survivor?.fip_id ? `fip_id ok` : 'no fip_id'}
                    </div>
                  </td>
                  <td style={td}>
                    {g.dying.map((d, j) => (
                      <div key={j}>
                        <div style={{ color: 'var(--text-2)' }}>{d.name}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 1 }}>{d.source ?? '—'}</div>
                      </div>
                    ))}
                  </td>
                  <td style={{ ...td, fontFamily: 'ui-monospace, monospace' }}>
                    {g.groupKey.split('|')[1]}
                  </td>
                  <td style={td}>
                    {Object.keys(g.updates).length === 0
                      ? <span style={{ color: 'var(--text-4)' }}>—</span>
                      : (
                        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10, color: 'var(--text-2)' }}>
                          {Object.entries(g.updates).map(([k, v]) => (
                            <div key={k}>{k}: {String(v).slice(0, 40)}</div>
                          ))}
                        </div>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Section>
      )}

      {/* Manual-review groups */}
      {manualGroups.length > 0 && (
        <Section label={`Needs manual review (${manualGroups.length})`}>
          <p style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8, maxWidth: 720 }}>
            Multiple rows in these groups have FK references (matches /
            articles / etc.) — picking a survivor automatically would orphan
            data. Resolve via direct SQL after deciding which row to keep.
          </p>
          <DataTable>
            <thead>
              <tr>
                <th>Group</th>
                <th>Rows + FK refs</th>
              </tr>
            </thead>
            <tbody>
              {manualGroups.map((g, i) => (
                <tr key={i}>
                  <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>
                    {g.groupKey}
                  </td>
                  <td style={td}>
                    {[g.survivor, ...g.dying].filter(Boolean).map((r, j) => {
                      const counts = g.fkCounts[(r as TournamentRow).id] ?? {}
                      const fkSummary = Object.entries(counts)
                        .filter(([, n]) => n > 0)
                        .map(([k, n]) => `${k}:${n}`)
                        .join(' · ') || 'no FKs'
                      return (
                        <div key={j} style={{ marginBottom: 4 }}>
                          <div style={{ fontWeight: 600, color: 'var(--text-1)' }}>{(r as TournamentRow).name}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-3)' }}>
                            {(r as TournamentRow).source ?? '—'} · {fkSummary}
                          </div>
                        </div>
                      )
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Section>
      )}

      {plan && plan.groupCount === 0 && (
        <EmptyState
          title="No duplicates detected."
          hint="The DB is clean (or matching rules need tightening — try widening the year window or relaxing tokens)."
        />
      )}
    </div>
  )
}

const td: React.CSSProperties = { verticalAlign: 'top' }

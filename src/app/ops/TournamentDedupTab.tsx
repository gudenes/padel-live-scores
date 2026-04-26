'use client'
// src/app/ops/TournamentDedupTab.tsx
//
// Cross-source tournament dedup workspace. Calls /api/ops/tournament-dedup
// (GET = dry-run plan, POST = execute). Operator can preview the entire
// plan, then click "Execute" to apply. Manual-review groups (multiple
// rows with FK refs) are listed separately so they don't silently skip.

import { useEffect, useState } from 'react'

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
  background: 'white',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
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
    fetch('/api/ops/tournament-dedup', { cache: 'no-store' })
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
    fetch('/api/ops/tournament-dedup', { method: 'POST', cache: 'no-store' })
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
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: '#111' }}>Tournament Dedup</h2>
        <p style={{ fontSize: 12, color: '#666', marginTop: 4, maxWidth: 720 }}>
          Detects same-event tournaments split across sources (padelapi vs FIP)
          using normalized name + year + level family. The row with FK refs
          (matches, draws, etc.) survives; the other gets its fields merged in
          and is deleted. Groups where multiple rows have FK refs are flagged
          for manual review — those need direct SQL.
        </p>
      </div>

      {/* Summary tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
        <Tile label="Duplicate groups" value={plan?.groupCount ?? '—'} accent="#6366f1" />
        <Tile label="Auto-mergeable" value={plan?.autoMergeable ?? '—'} accent="#16a34a" />
        <Tile label="Manual review" value={plan?.manualReview ?? '—'} accent="#dc2626" />
      </div>

      {/* Action bar */}
      <div style={{ ...card, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={loadPlan}
          disabled={loadingPlan}
          style={{
            padding: '7px 14px', fontSize: 12, fontWeight: 700,
            background: '#fff', color: '#333',
            border: '1px solid #d1d5db', borderRadius: 4,
            cursor: loadingPlan ? 'wait' : 'pointer',
          }}
        >
          {loadingPlan ? 'Loading…' : 'Refresh plan'}
        </button>
        <button
          onClick={execute}
          disabled={executing || !plan?.autoMergeable}
          style={{
            padding: '7px 14px', fontSize: 12, fontWeight: 700,
            background: plan?.autoMergeable ? '#dc2626' : '#9ca3af',
            color: '#fff', border: 'none', borderRadius: 4,
            cursor: executing ? 'wait' : (plan?.autoMergeable ? 'pointer' : 'not-allowed'),
          }}
        >
          {executing ? 'Merging…' : `Execute merge (${plan?.autoMergeable ?? 0})`}
        </button>
        <span style={{ fontSize: 11, color: '#666', marginLeft: 'auto' }}>
          Manual-review groups stay untouched
        </span>
      </div>

      {error && (
        <div style={{ ...card, color: '#991b1b', marginBottom: 16 }}>❌ {error}</div>
      )}

      {executeResult && (
        <div
          style={{
            ...card,
            marginBottom: 16,
            background: executeResult.ok ? '#f0fdf4' : '#fef2f2',
            borderColor: executeResult.ok ? '#bbf7d0' : '#fecaca',
          }}
        >
          {executeResult.ok ? (
            <div style={{ fontSize: 12, color: '#166534', fontWeight: 600 }}>
              ✓ Merged {executeResult.merged ?? 0} · Skipped {executeResult.skipped ?? 0} · Failed {executeResult.failed ?? 0}
              {executeResult.errors && executeResult.errors.length > 0 && (
                <ul style={{ marginTop: 6, color: '#991b1b', fontSize: 11 }}>
                  {executeResult.errors.map((e, i) => (
                    <li key={i}><strong>{e.groupKey}:</strong> {e.error}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: '#991b1b' }}>❌ {executeResult.error}</div>
          )}
        </div>
      )}

      {/* Auto-mergeable groups */}
      {okGroups.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#111', marginBottom: 8 }}>
            Auto-mergeable ({okGroups.length})
          </h3>
          <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f9fafb', textAlign: 'left' }}>
                  <th style={th}>Survivor</th>
                  <th style={th}>Dying</th>
                  <th style={th}>Year</th>
                  <th style={th}>Updates</th>
                </tr>
              </thead>
              <tbody>
                {okGroups.map((g, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={td}>
                      <div style={{ fontWeight: 600, color: '#111' }}>{g.survivor?.name ?? '—'}</div>
                      <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>
                        {g.survivor?.source ?? '—'} · {g.survivor?.fip_id ? `fip_id ✓` : 'no fip_id'}
                      </div>
                    </td>
                    <td style={td}>
                      {g.dying.map((d, j) => (
                        <div key={j}>
                          <div style={{ color: '#444' }}>{d.name}</div>
                          <div style={{ fontSize: 10, color: '#999', marginTop: 1 }}>{d.source ?? '—'}</div>
                        </div>
                      ))}
                    </td>
                    <td style={{ ...td, fontFamily: 'ui-monospace, monospace' }}>
                      {g.groupKey.split('|')[1]}
                    </td>
                    <td style={td}>
                      {Object.keys(g.updates).length === 0
                        ? <span style={{ color: '#bbb' }}>—</span>
                        : (
                          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10, color: '#444' }}>
                            {Object.entries(g.updates).map(([k, v]) => (
                              <div key={k}>{k}: {String(v).slice(0, 40)}</div>
                            ))}
                          </div>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Manual-review groups */}
      {manualGroups.length > 0 && (
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#111', marginBottom: 8 }}>
            Needs manual review ({manualGroups.length})
          </h3>
          <p style={{ fontSize: 11, color: '#666', marginBottom: 8, maxWidth: 720 }}>
            Multiple rows in these groups have FK references (matches /
            articles / etc.) — picking a survivor automatically would orphan
            data. Resolve via direct SQL after deciding which row to keep.
          </p>
          <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#fef2f2', textAlign: 'left' }}>
                  <th style={th}>Group</th>
                  <th style={th}>Rows + FK refs</th>
                </tr>
              </thead>
              <tbody>
                {manualGroups.map((g, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
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
                            <div style={{ fontWeight: 600, color: '#111' }}>{(r as TournamentRow).name}</div>
                            <div style={{ fontSize: 10, color: '#999' }}>
                              {(r as TournamentRow).source ?? '—'} · {fkSummary}
                            </div>
                          </div>
                        )
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {plan && plan.groupCount === 0 && (
        <div style={{ ...card, color: '#666', fontSize: 12 }}>
          No duplicates detected. The DB is clean (or matching rules need
          tightening — try widening the year window or relaxing tokens).
        </div>
      )}
    </div>
  )
}

const th: React.CSSProperties = {
  padding: '8px 12px', fontSize: 10, fontWeight: 700, color: '#666',
  textTransform: 'uppercase', letterSpacing: '0.5px',
  borderBottom: '1px solid #e5e7eb',
}
const td: React.CSSProperties = { padding: '8px 12px', color: '#444', verticalAlign: 'top' }

function Tile({ label, value, accent }: { label: string; value: number | string; accent: string }) {
  return (
    <div style={{ ...card, borderLeft: `4px solid ${accent}` }}>
      <div style={{ fontSize: 9, color: '#6b7280', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.5px' }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: accent, lineHeight: 1.05, marginTop: 4 }}>
        {value}
      </div>
    </div>
  )
}

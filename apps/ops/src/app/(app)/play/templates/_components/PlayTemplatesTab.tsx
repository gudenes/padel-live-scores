'use client'

// Play → Templates. Reads market_templates live and exposes the one field an
// operator should be able to change from a list screen: enabled.
//
// Everything else (question text, resolver, gates, subsidy) is frozen onto
// every market at creation, so editing it here would imply a retroactive
// effect it does not have. See the spec's "A market freezes its configuration
// at creation".

import { useCallback, useEffect, useState } from 'react'
import { PageHeader, Panel, Pill, DataTable, EmptyState, Skeleton } from '@/components/ui'

type Template = {
  id: string
  key: string
  question_i18n: Record<string, string> | null
  horizon: string
  trigger: string
  lock_rule: string
  resolver_key: string
  seed_source: string
  max_loss_guacas: number
  params: Record<string, unknown> | null
  gates: Record<string, unknown> | null
  enabled: boolean
  updated_at: string | null
  produced: number
}

type Season = { name: string; status: string; starts_at: string; ends_at: string } | null
type Limits = {
  max_open_markets: number
  max_new_per_day: number
  max_subsidy_per_day: number
} | null

/** Shape returned by padelgod's market-generator when run dry. */
type DryRunResult = {
  dryRun: boolean
  templatesConsidered: number
  candidates: number
  gateDrops: { reason: string; count: number }[]
  capDrops: { reason: string; count: number }[]
  created: number
  errors: number
  durationMs: number
}

const dim = { fontSize: 11.5, color: 'var(--text-3)', marginTop: 3 }

function sum(drops: { count: number }[]): number {
  return drops.reduce((a, d) => a + d.count, 0)
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
        {label}
      </div>
      <div className="tabular" style={{ fontFamily: 'var(--display)', fontSize: 24, fontWeight: 700, marginTop: 4 }}>
        {value}
      </div>
    </div>
  )
}

/** Drops are itemised deliberately: a generator that discards work silently
 *  looks identical to one that covered everything. */
function DropList({ title, drops }: { title: string; drops: { reason: string; count: number }[] }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 }}>
        {title} ({sum(drops)})
      </div>
      {drops.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-4)' }}>none</div>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 12.5, lineHeight: 1.9, color: 'var(--text-2)' }}>
          {drops.map((d) => (
            <li key={d.reason}>
              <span className="tabular" style={{ color: 'var(--live-text)', fontWeight: 700, marginRight: 8 }}>
                −{d.count}
              </span>
              {d.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function PlayTemplatesTab() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [season, setSeason] = useState<Season>(null)
  const [limits, setLimits] = useState<Limits>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [dryRunning, setDryRunning] = useState(false)
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null)
  const [dryRunError, setDryRunError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/internal/play-templates', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setTemplates(json.templates ?? [])
      setSeason(json.season ?? null)
      setLimits(json.limits ?? null)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function toggle(key: string, next: boolean) {
    setPending(key)
    // Optimistic, then reconciled by the reload. A failed PATCH restores the
    // previous value rather than leaving the switch lying about the database.
    setTemplates((prev) => prev.map((t) => (t.key === key ? { ...t, enabled: next } : t)))
    try {
      const res = await fetch(`/api/internal/play-templates/${encodeURIComponent(key)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setTemplates((prev) => prev.map((t) => (t.key === key ? { ...t, enabled: !next } : t)))
    } finally {
      setPending(null)
    }
  }

  async function runDryRun() {
    setDryRunning(true)
    setDryRunError(null)
    setDryRun(null)
    try {
      const res = await fetch('/api/internal/play-dry-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worker: 'market-generator' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : JSON.stringify(json.error))
      // padelgod wraps the worker's return value; tolerate either shape.
      setDryRun((json.result?.result ?? json.result) as DryRunResult)
    } catch (e) {
      setDryRunError(e instanceof Error ? e.message : String(e))
    } finally {
      setDryRunning(false)
    }
  }

  const enabledCount = templates.filter((t) => t.enabled).length

  return (
    <div className="ui-page">
      <PageHeader
        title="Market Templates"
        subtitle="Templates are generators, not markets. Each one watches the calendar and instantiates markets automatically — nobody authors a market by hand."
        actions={
          <button className="ui-btn" data-size="sm" disabled={dryRunning} onClick={() => void runDryRun()}>
            {dryRunning ? 'Running…' : 'Dry run'}
          </button>
        }
      />

      {/* The most important thing on this screen: enabling a template does
          nothing while the worker flag is off. Saying so plainly stops an
          operator concluding the system is broken. */}
      <Panel>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <Pill tone="warn" dot>
            Workers off
          </Pill>
          <div style={{ fontSize: 12.5, lineHeight: 1.65, color: 'var(--text-2)' }}>
            Enabling a template marks it eligible, but no market is created until{' '}
            <code style={{ fontFamily: 'var(--mono)' }}>ENABLE_MARKET_GENERATOR</code> is set on
            Railway — and while{' '}
            <code style={{ fontFamily: 'var(--mono)' }}>MARKET_GENERATOR_DRY_RUN</code> stays true
            the generator only logs what it would do. Both default off, deliberately.{' '}
            {season ? (
              <>
                Active season: <strong>{season.name}</strong>.
              </>
            ) : (
              <>
                <strong>No active season</strong> — the generator exits immediately.
              </>
            )}{' '}
            {limits ? (
              <>
                Caps: {limits.max_open_markets} open · {limits.max_new_per_day}/day ·{' '}
                {limits.max_subsidy_per_day.toLocaleString('en-US')} G subsidy/day.
              </>
            ) : null}
          </div>
        </div>
      </Panel>

      <div style={{ height: 18 }} />

      {dryRunError ? (
        <>
          <Panel title="Dry run failed">
            <div style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-2)' }}>
              <div style={{ color: 'var(--live-text)', marginBottom: 8 }}>{dryRunError}</div>
              {/* The overwhelmingly likely cause, stated so nobody debugs the
                  wrong layer: the worker exists on this branch but padelgod on
                  Railway is still running the previously deployed build. */}
              {dryRunError.includes('Unknown worker') ? (
                <>
                  padelgod does not know this worker yet. It is registered on this branch but
                  the deployed service is running an older build — deploy padelgod
                  (<code style={{ fontFamily: 'var(--mono)' }}>railway up</code>) and try again.
                </>
              ) : null}
            </div>
          </Panel>
          <div style={{ height: 18 }} />
        </>
      ) : null}

      {dryRun ? (
        <>
          <Panel
            title="Dry run · what the generator would create right now"
            actions={<Pill tone={dryRun.created === 0 ? 'lime' : 'warn'}>nothing written</Pill>}
          >
            <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', marginBottom: 14 }}>
              <Stat label="Templates considered" value={dryRun.templatesConsidered} />
              <Stat label="Candidates" value={dryRun.candidates} />
              <Stat
                label="Would create"
                value={Math.max(
                  0,
                  dryRun.candidates -
                    sum(dryRun.gateDrops) -
                    sum(dryRun.capDrops),
                )}
              />
              <Stat label="Errors" value={dryRun.errors} />
              <Stat label="Took" value={`${dryRun.durationMs}ms`} />
            </div>

            {dryRun.candidates === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.65 }}>
                No candidates. Between Premier events this is the <strong>correct</strong> answer,
                not a fault — the generator only looks at Premier-tier tournaments with future
                scheduled matches. Check whether a Premier event is actually in window before
                treating this as a bug.
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr' }}>
                <DropList title="Dropped by gates" drops={dryRun.gateDrops} />
                <DropList title="Dropped by caps" drops={dryRun.capDrops} />
              </div>
            )}
          </Panel>
          <div style={{ height: 18 }} />
        </>
      ) : null}

      {error ? (
        <>
          <Panel>
            <div style={{ color: 'var(--live-text)', fontSize: 13 }}>{error}</div>
          </Panel>
          <div style={{ height: 18 }} />
        </>
      ) : null}

      {loading ? (
        <Panel>
          <Skeleton rows={4} />
        </Panel>
      ) : templates.length === 0 ? (
        <EmptyState
          title="No templates"
          hint="Seeded by supabase/migrations/20260923120300_play_market_seed.sql"
        />
      ) : (
        <DataTable>
          <thead>
            <tr>
              <th>
                Template ({enabledCount}/{templates.length} enabled)
              </th>
              <th>Horizon</th>
              <th>Resolver</th>
              <th>Gates</th>
              <th style={{ textAlign: 'right' }}>Subsidy</th>
              <th style={{ textAlign: 'right' }}>Markets</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => {
              const rounds = (t.gates?.rounds as string[] | undefined) ?? null
              const minRanking = t.gates?.minRanking as number | undefined
              const band = t.gates?.competitiveness as [number, number] | undefined
              return (
                <tr key={t.key}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{t.key}</div>
                    <div style={dim}>{t.question_i18n?.en ?? '—'}</div>
                  </td>
                  <td>
                    <Pill tone="neutral">{t.horizon}</Pill>
                  </td>
                  <td>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{t.resolver_key}</div>
                    <div style={dim}>
                      seed: {t.seed_source} · locks: {t.lock_rule}
                    </div>
                  </td>
                  <td style={{ fontSize: 11.5, color: 'var(--text-2)', lineHeight: 1.6 }}>
                    <div>{rounds ? `rounds ${rounds.join(', ')}` : 'all rounds'}</div>
                    {minRanking ? <div>top {minRanking}</div> : null}
                    {band ? (
                      <div>
                        prob {band[0]}–{band[1]}
                      </div>
                    ) : null}
                  </td>
                  <td className="tabular" style={{ textAlign: 'right' }}>
                    {t.max_loss_guacas.toLocaleString('en-US')} G
                  </td>
                  <td className="tabular" style={{ textAlign: 'right' }}>
                    {t.produced || '—'}
                  </td>
                  <td>
                    <button
                      className="ui-btn"
                      data-size="sm"
                      data-variant={t.enabled ? 'primary' : undefined}
                      disabled={pending === t.key}
                      onClick={() => void toggle(t.key, !t.enabled)}
                    >
                      {pending === t.key ? '…' : t.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </DataTable>
      )}
    </div>
  )
}

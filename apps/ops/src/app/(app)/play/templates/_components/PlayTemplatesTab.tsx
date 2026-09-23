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

/** Tolerates undefined — an unexpected payload shape must degrade to 0, not
 *  take the whole page down. It did exactly that once. */
function sum(drops?: { count: number }[] | null): number {
  if (!Array.isArray(drops)) return 0
  return drops.reduce((a, d) => a + (Number(d?.count) || 0), 0)
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
function DropList({ title, drops }: { title: string; drops?: { reason: string; count: number }[] | null }) {
  const list = Array.isArray(drops) ? drops : []
  return (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 }}>
        {title} ({sum(list)})
      </div>
      {list.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-4)' }}>none</div>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 12.5, lineHeight: 1.9, color: 'var(--text-2)' }}>
          {list.map((d) => (
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


/** Read-only detail. Only `enabled` is mutable anywhere in this page: a
 *  template's question, resolver, gates and subsidy are FROZEN onto every
 *  market at creation, so editing them here would imply a retroactive effect
 *  they do not have. */
function TemplateDrawer({
  t, onClose, onToggle, pending,
}: {
  t: Template | null
  onClose: () => void
  onToggle: (key: string, next: boolean) => void
  pending: boolean
}) {
  const gates = (t?.gates ?? {}) as Record<string, unknown>
  const rounds = gates.rounds as string[] | undefined
  const minRanking = gates.minRanking as number | undefined
  const band = gates.competitiveness as [number, number] | undefined
  const locales = t?.question_i18n ? Object.keys(t.question_i18n) : []

  return (
    <>
      <div className="ui-drawer-scrim" data-on={!!t} onClick={onClose} />
      <aside className="ui-drawer" data-on={!!t} aria-hidden={!t}>
        {t ? (
          <>
            <div className="ui-drawer-head">
              <div>
                <h3 className="ui-drawer-title">{t.key}</h3>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
                  {t.question_i18n?.en ?? '—'}
                </div>
              </div>
              <button className="ui-btn" data-variant="ghost" data-size="sm" onClick={onClose} aria-label="Close">
                ✕
              </button>
            </div>

            <div className="ui-drawer-body">
              <button
                className="ui-switch"
                data-on={t.enabled}
                disabled={pending}
                onClick={() => onToggle(t.key, !t.enabled)}
              >
                <span className="ui-switch-track" />
                {pending ? 'saving…' : t.enabled
                  ? 'Enabled — the generator will use this template'
                  : 'Disabled — the generator ignores this template'}
              </button>

              <div>
                <div className="ui-section-label" style={{ marginBottom: 8 }}>Generation</div>
                <dl className="ui-dl">
                  <dt>Horizon</dt><dd>{t.horizon}</dd>
                  <dt>Trigger</dt><dd style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{t.trigger}</dd>
                  <dt>Locks at</dt><dd style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{t.lock_rule}</dd>
                  <dt>Seed price</dt><dd>{t.seed_source}</dd>
                  <dt>Markets made</dt><dd className="tabular">{t.produced}</dd>
                </dl>
              </div>

              <div>
                <div className="ui-section-label" style={{ marginBottom: 8 }}>Eligibility gates</div>
                <dl className="ui-dl">
                  <dt>Rounds</dt><dd>{rounds?.length ? rounds.join(', ') : 'all rounds'}</dd>
                  <dt>Ranking</dt><dd>{minRanking ? `at least one top-${minRanking} player` : 'any'}</dd>
                  <dt>Competitiveness</dt>
                  <dd>
                    {band ? `model probability ${band[0]}–${band[1]}` : 'any'}
                    {band ? (
                      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3 }}>
                        excludes foregone conclusions — nobody trades a 92% certainty
                      </div>
                    ) : null}
                  </dd>
                </dl>
              </div>

              <div>
                <div className="ui-section-label" style={{ marginBottom: 8 }}>Resolution &amp; cost</div>
                <dl className="ui-dl">
                  <dt>Resolver</dt>
                  <dd style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{t.resolver_key}</dd>
                  <dt>Params</dt>
                  <dd style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>
                    {JSON.stringify(t.params ?? {})}
                  </dd>
                  <dt>Subsidy</dt>
                  <dd className="tabular">
                    {t.max_loss_guacas.toLocaleString('en-US')} G
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3 }}>
                      worst-case maker loss, bounded at b·ln(2) — knowable before any trade
                    </div>
                  </dd>
                </dl>
              </div>

              <div>
                <div className="ui-section-label" style={{ marginBottom: 8 }}>
                  Question ({locales.length} locales)
                </div>
                <dl className="ui-dl">
                  {locales.map((loc) => (
                    <FragmentRow key={loc} k={loc} v={t.question_i18n?.[loc] ?? ''} />
                  ))}
                </dl>
              </div>

              <p style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.6, margin: 0 }}>
                Everything above except the switch is read-only. Each market freezes this
                configuration at the moment it is created, so changing it here could never
                affect a market that already exists — only future ones.
              </p>
            </div>
          </>
        ) : null}
      </aside>
    </>
  )
}

function FragmentRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd style={{ fontSize: 12 }}>{v}</dd>
    </>
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
  const [selected, setSelected] = useState<Template | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/internal/play-templates', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      const list: Template[] = json.templates ?? []
      setTemplates(list)
      // Re-point the drawer at the reloaded row so it never shows stale state.
      setSelected((cur) => (cur ? (list.find((t) => t.key === cur.key) ?? null) : null))
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
      // The route already unwraps padelgod's { data: { result } }. Tolerate the
      // older nestings too, then REFUSE anything that isn't actually a result —
      // silently rendering a wrong-shaped object is what crashed this page.
      const r = (json?.result?.result ?? json?.result ?? json) as DryRunResult
      if (!r || typeof r.candidates !== 'number') {
        throw new Error(`unexpected response shape: ${JSON.stringify(json).slice(0, 200)}`)
      }
      setDryRun(r)
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
          {/* Ground truth, not a guess: `dryRun` comes back from the worker
              itself. Before a run we know nothing about the Railway flags and
              must not claim otherwise — this banner previously asserted
              "Workers off" while the generator was in fact enabled. */}
          {dryRun ? (
            dryRun.dryRun ? (
              <Pill tone="lime" dot>
                Dry-run · writes nothing
              </Pill>
            ) : (
              <Pill tone="live" dot>
                LIVE · creates markets
              </Pill>
            )
          ) : (
            <Pill tone="neutral">Run to check</Pill>
          )}
          <div style={{ fontSize: 12.5, lineHeight: 1.65, color: 'var(--text-2)' }}>
            Enabling a template only marks it eligible. Whether a market is actually created
            depends on two Railway variables —{' '}
            <code style={{ fontFamily: 'var(--mono)' }}>ENABLE_MARKET_GENERATOR</code> (does the
            cron run at all) and{' '}
            <code style={{ fontFamily: 'var(--mono)' }}>MARKET_GENERATOR_DRY_RUN</code> (if true,
            it only logs). This page cannot read Railway, so hit <strong>Dry run</strong> and the
            pill will show what the worker itself reports.{' '}
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
            actions={
              dryRun.created === 0 ? (
                <Pill tone="lime">nothing written</Pill>
              ) : (
                // Must never claim "nothing written" when rows were created.
                <Pill tone="live">{dryRun.created} market(s) CREATED</Pill>
              )
            }
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
                <tr
                  key={t.key}
                  onClick={() => setSelected(t)}
                  style={{ cursor: 'pointer' }}
                >
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
                      className="ui-switch"
                      data-on={t.enabled}
                      disabled={pending === t.key}
                      aria-label={`${t.enabled ? 'Disable' : 'Enable'} ${t.key}`}
                      onClick={(e) => {
                        e.stopPropagation() // don't also open the drawer
                        void toggle(t.key, !t.enabled)
                      }}
                    >
                      <span className="ui-switch-track" />
                      {pending === t.key ? '…' : t.enabled ? 'On' : 'Off'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </DataTable>
      )}

      <TemplateDrawer
        t={selected}
        pending={pending === selected?.key}
        onClose={() => setSelected(null)}
        onToggle={(k, n) => void toggle(k, n)}
      />
    </div>
  )
}

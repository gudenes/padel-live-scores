'use client'
import Link from 'next/link'
import { IngestionHistory } from './IngestionHistory'
import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/ui'
import { formatBytes, type IntegrationMonitor, type Signal } from '@/lib/integration-monitor'
import styles from './monitor.module.css'

const labels: Record<Signal, string> = { healthy: 'Healthy', warning: 'Attention', error: 'Issue', unknown: 'Unknown / idle' }
const categories: Record<string,string> = { event_page: 'Event pages', admin_ajax_draw: 'Draws & entry-list requests', player_profile: 'Player profiles', rest_ranking: 'Rankings', rest_player_search: 'Player search', rest_discover: 'Tournament discovery', rest_other: 'Other API requests', other_fip: 'PDFs, images & other FIP' }
function Badge({ status, label }: { status: Signal; label?: string }) { return <span className={`${styles.badge} ${styles[status]}`}><span aria-hidden="true" className={styles.dot} />{label ?? labels[status]}</span> }
function when(value: string | null) { return value ? `${new Date(value).toISOString().slice(0, 19).replace('T', ' ')} UTC` : 'No observation yet' }
function routeName(id: string) { return id === 'residential' ? 'Residential fallback' : `Fixed proxy ${id.replace('fixed_', '')}` }

export function IntegrationMonitorView({ initialData, embedded = false, compact = false, polling = true }: { initialData?: IntegrationMonitor; embedded?: boolean; compact?: boolean; polling?: boolean }) {
  const [data, setData] = useState<IntegrationMonitor | null>(initialData ?? null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!initialData)
  const [refresh, setRefresh] = useState(0)
  const [clock, setClock] = useState(() => Date.now())
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 15_000); return () => clearInterval(timer) }, [])
  useEffect(() => {
    if (!polling) return
    let alive = true; let timer: ReturnType<typeof setTimeout>; let controller: AbortController
    const pull = async () => {
      controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 15_000)
      setLoading(true)
      try {
        const response = await fetch('/api/internal/integration-monitor', { cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw new Error(response.status === 401 ? 'Sign in with an operator account to view integrations.' : 'Monitoring data is unavailable. Retrying automatically.')
        const next = await response.json() as IntegrationMonitor
        if (alive) { setData(next); setError(null); setClock(Date.now()) }
      } catch (e) { if (alive) setError(e instanceof Error && e.name !== 'AbortError' ? e.message : 'Monitoring request timed out. Retrying automatically.') }
      finally { clearTimeout(timeout); if (alive) { setLoading(false); timer = setTimeout(() => void pull(), 60_000) } }
    }
    void pull()
    return () => { alive = false; clearTimeout(timer); controller?.abort() }
  }, [refresh, polling])
  const stale = Boolean(error) || Boolean(polling && data && clock - Date.parse(data.fetchedAt) > 90_000)
  const signal = (status: Signal): Signal => stale ? 'unknown' : status
  const totalBytes = data?.routes.reduce((sum,r) => sum+r.bytes, 0) ?? 0
  const residentialBytes = data?.routes.find(r => r.id === 'residential')?.bytes ?? 0
  const share = totalBytes > 0 ? residentialBytes / totalBytes * 100 : null
  const budget = data?.budget
  const refreshButton = <button className={styles.button} onClick={() => setRefresh(value => value+1)} disabled={loading || !polling}>{!polling ? 'Sample data' : loading ? 'Refreshing…' : 'Refresh status'}</button>
  return <div className={embedded ? styles.embedded : `ui-page ${styles.page}`}>
    {embedded ? <div className={styles.embeddedHeader}><div><span className={styles.eyebrow}>Platform operations</span><h2>{compact ? 'Service health & consumption' : 'Integrations & usage'}</h2></div>{refreshButton}</div> : <PageHeader title="Integrations" subtitle="Operations Dashboard · Service health and proxy consumption" actions={refreshButton} />}
    <div className={styles.meta}><span aria-live="polite">{data ? `Updated ${when(data.fetchedAt)}` : 'Connecting to monitoring…'}</span><span>{polling ? 'Refreshes every minute' : 'Local preview · sample data'}</span></div>
    {(error || stale) && <div role="alert" className={styles.notice}>{error ?? 'These readings are stale. Refresh to check current status.'}{data && ' Showing the last available readings; status lights are unknown.'}</div>}
    {!data && !loading && <div className={styles.empty}>No monitoring data available. Use Refresh status to try again.</div>}
    {!data && loading && <div className={styles.empty} role="status">Loading service health and usage…</div>}
    {polling && <IngestionHistory />}
    {data && <>
      <div className={styles.cards}>
        <section className={styles.card}><div className={styles.cardTop}><h2>Data worker</h2><Badge status={signal(data.runtime.status)} /></div><p>{data.runtime.message}</p><div className={styles.value}>{data.runtime.uptimeSeconds === null ? '—' : `${Math.floor(data.runtime.uptimeSeconds/3600)}h ${Math.floor(data.runtime.uptimeSeconds%3600/60)}m`}</div><span className={styles.caption}>Uptime since last restart</span></section>
        {data.feeds.map(feed => <section className={styles.card} key={feed.id}><div className={styles.cardTop}><h2>{feed.name}</h2><Badge status={signal(feed.status)} /></div><p>{feed.message}</p><div className={styles.value}>{feed.runs?.toLocaleString() ?? '—'} <small>runs</small></div><span className={styles.caption}>{feed.failures === null ? 'Failure counts unavailable' : `${feed.failures.toLocaleString()} failed · last 24 hours`}</span><div className={styles.detail}>Last completed run: {when(feed.lastRun)}</div></section>)}
      </div>
      {!data.runtime.telemetryAvailable && <div className={styles.notice}>Detailed proxy telemetry is not available yet. It will appear after the proxy worker rollout. Missing counters are not shown as zero usage.</div>}
      <div className={styles.columns}>
        <section className={styles.card}><div className={styles.cardTop}><h2>Residential daily budget</h2><Badge status={signal(budget?.status ?? 'unknown')} label={stale ? 'Unknown' : budget?.limitBytes === 0 ? 'Disabled' : budget?.status === 'healthy' ? 'Within budget' : undefined} /></div>
          {budget ? <><div className={styles.value}>{formatBytes(budget.usedBytes)} <small>/ {formatBytes(budget.limitBytes)}</small></div><progress className={styles.progress} max={Math.max(1,budget.limitBytes)} value={Math.min(budget.usedBytes, Math.max(1,budget.limitBytes))} aria-label="Residential daily estimated consumption" /><p>{budget.limitBytes === 0 ? 'Residential fallback is disabled by its budget.' : `${formatBytes(Math.max(0,budget.limitBytes-budget.usedBytes))} remaining · UTC ${budget.day}`}</p></> : <p>No current budget reading. The worker may not have residential telemetry configured.</p>}
          <div className={styles.detail}>Estimated response-body bytes, not Webshare billing. The safeguard resets at UTC midnight and on worker restart; in-flight requests can exceed it.</div>
        </section>
        <section className={styles.card}><div className={styles.cardTop}><h2>Traffic split</h2><span className={styles.caption}>Since worker restart</span></div><div className={styles.value}>{data.runtime.telemetryAvailable && share !== null ? `${share.toFixed(1)}%` : '—'} <small>residential</small></div><p>{data.runtime.telemetryAvailable ? `${formatBytes(Math.max(0,totalBytes-residentialBytes))} fixed · ${formatBytes(residentialBytes)} residential` : 'Awaiting route-level measurements'}</p><div className={styles.detail}>Fixed proxies are the primary route. Residential is reserved for fallback. These totals are estimates, not monthly consumption.</div><a className={styles.link} href="https://dashboard.webshare.io/dashboard" target="_blank" rel="noreferrer">View billed usage and current plan costs in Webshare ↗</a></section>
      </div>
      {!compact && <>
      <section className={styles.card}><div className={styles.cardTop}><h2>Proxy routes</h2><span className={styles.caption}>Latest result · counters since restart</span></div>
        {!data.routes.length ? <p className={styles.detail}>No route-level readings yet. A healthy worker alone does not confirm that FIP is reachable.</p> : <div className={styles.tableWrap}><table className={styles.table}><caption className={styles.srOnly}>Fixed and residential proxy health and estimated bandwidth</caption><thead><tr><th>Route</th><th>Status</th><th>Requests</th><th>Failures</th><th>Consumption</th><th>Last success</th></tr></thead><tbody>{data.routes.map(route => <tr key={route.id}><th scope="row">{routeName(route.id)}{route.cooldownUntil && Date.parse(route.cooldownUntil)>clock && <span className={styles.detail}>Cooling down until {`${new Date(route.cooldownUntil).toISOString().slice(11,19)} UTC`}</span>}</th><td><Badge status={signal(route.status)} /></td><td>{route.requests.toLocaleString()}</td><td>{route.failures.toLocaleString()}</td><td>{formatBytes(route.bytes)}</td><td>{when(route.lastSuccess)}</td></tr>)}</tbody></table></div>}
      </section>
      <section className={styles.card}><div className={styles.cardTop}><h2>Where bandwidth goes</h2><span className={styles.caption}>Estimated · since restart</span></div>{data.categories.length ? <div className={styles.breakdown}>{data.categories.map(row => <div key={row.name}><span>{categories[row.name] ?? row.name}</span><strong>{formatBytes(row.bytes)}</strong><span className={styles.caption}>{row.requests.toLocaleString()} requests</span></div>)}</div> : <p>No category measurements available.</p>}</section>
      <footer className={styles.footer}><span>Green: recent success · Amber: elevated failures or ≥80% budget · Red: latest failure or budget exhausted · Grey: unavailable or idle</span><div><Link href="/system/integration-health">All integration diagnostics</Link><Link href="/system/padelgod-health">Ingestion coverage</Link></div></footer>
      </>}
    </>}
  </div>
}

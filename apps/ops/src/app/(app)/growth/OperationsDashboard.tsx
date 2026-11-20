'use client'
import { useState, type ReactNode } from 'react'
import { PageHeader } from '@/components/ui'
import { IntegrationMonitorView } from './integrations/IntegrationMonitorView'
import type { IntegrationMonitor } from '@/lib/integration-monitor'
import styles from './operations.module.css'
export type OperationsView = 'overview' | 'growth' | 'integrations'
const views: { id: OperationsView; label: string }[] = [{ id: 'overview', label: 'Overview' }, { id: 'growth', label: 'Growth & adoption' }, { id: 'integrations', label: 'Integrations & usage' }]
export function OperationsDashboard({ summary, trends, growth, initialView = 'overview', previewMonitor }: { summary: ReactNode; trends?: ReactNode; growth: ReactNode; initialView?: OperationsView; previewMonitor?: IntegrationMonitor }) {
  const [view, setView] = useState<OperationsView>(initialView)
  const select = (next: OperationsView) => {
    setView(next)
    const url = new URL(window.location.href)
    if (next === 'overview') url.searchParams.delete('view'); else url.searchParams.set('view', next)
    window.history.replaceState(null, '', url)
  }
  return <div className={`ui-page ${styles.page}`}>
    <PageHeader title="Operations Dashboard" subtitle="Audience growth, product adoption and service health in one place." />
    <nav className={styles.views} aria-label="Dashboard views">{views.map(item => <button key={item.id} type="button" aria-pressed={view === item.id} className={view === item.id ? styles.active : ''} onClick={() => select(item.id)}>{item.label}</button>)}</nav>
    {view === 'overview' && <div>
      <section className={styles.section} aria-labelledby="growth-overview-title"><div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Business performance</span><h2 id="growth-overview-title">Growth & adoption</h2></div><button type="button" className={styles.detailButton} onClick={() => select('growth')}>Explore growth →</button></div>{summary}</section>
      <section className={styles.section} aria-label="Service health and consumption"><IntegrationMonitorView embedded compact initialData={previewMonitor} polling={!previewMonitor} /><button type="button" className={styles.detailButton} onClick={() => select('integrations')}>View proxy routes and integration details →</button></section>
      {trends && <section className={styles.section} aria-labelledby="growth-trends-title"><div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Audience trends</span><h2 id="growth-trends-title">Acquisition over time</h2></div></div>{trends}</section>}
    </div>}
    {view === 'growth' && <section aria-label="Growth and adoption details">{growth}</section>}
    {view === 'integrations' && <section aria-label="Integration health and usage details"><IntegrationMonitorView embedded initialData={previewMonitor} polling={!previewMonitor} /></section>}
  </div>
}

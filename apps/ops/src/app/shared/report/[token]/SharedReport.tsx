'use client'
import MethodologyGuide from '@/components/scouting/MethodologyGuide'
import styles from './shared-report.module.css'
import SharedReportAnalytics from '@/components/analytics/SharedReportAnalytics'
import {MatchInsightsView} from '@/app/(scouting)/scouting/[id]/report/view/MatchInsightsView'
import type {ReportView} from '@/lib/scouting/report-view'
export default function SharedReport({data}:{data:ReportView}){
 return <div data-shared-report>
 <header className={`gheader ${styles.header}`}>
  <div className="dual-brand" aria-label="Padel Nachos and Padel Labs">
   <img className="nachos-wordmark" src="/brand/padelnachos.png" alt="Padel Nachos" width="86" height="54"/>
   <span className="brand-divider" aria-hidden="true"/>
   <img className="labs-wordmark" src="/brand/padellabs-white.png" alt="Padel Labs" width="156" height="42"/>
  </div>
  <div className={styles.actions}><span className={styles.label}>Shared match analysis</span><MethodologyGuide label={<><svg className={styles.methodIcon} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Z"/><path d="M12 5v15M6 8h3M6 12h3M15 8h3M15 12h3"/></svg>Methodology</>} showFullLink={false} methodology={data.scopes.all.analysis.methodology.id}/></div>
 </header>
 <main className={styles.content}><p className={styles.snapshot}>Read-only report · Saved {new Date(data.updatedAt).toLocaleDateString()}</p><MatchInsightsView data={data} shared onScopeChange={()=>{}} reports={null}/><SharedReportAnalytics stage="report"/></main>
 </div>
}

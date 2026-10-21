import Link from 'next/link'
import { Panel, EmptyState } from '@/components/ui'
import type { getReportAccess } from '@/lib/growth/report-access'

const labels: Record<string,string> = {
  code_requested: 'Code requested · email unverified', code_sent: 'Code sent · email unverified',
  delivery_failed: 'Code delivery failed', verification_failed: 'Verification failed',
  verified: 'Email verified', report_viewed: 'Report opened',
}
const date = (value: string | null) => value ? new Date(value).toLocaleString('en-GB', {timeZone:'Europe/Madrid',dateStyle:'medium',timeStyle:'short'}) : 'Not opened'
const url = (r: {manual:boolean;match_id:string}) => `/scouting/${r.manual?'manual/':''}${r.match_id}/report`
export function ReportAccessPanel({data}: {data: Awaited<ReturnType<typeof getReportAccess>>}) {
  return <Panel title="Shared report access · last 30 days">
    <p style={{color:'var(--text-3)',fontSize:13}}>See who verified their email and opened a shared report. Opens include repeat visits. Anonymous visits before requesting a code are not recorded here. Times are Europe/Madrid.</p>
    {!data ? <EmptyState title="Report activity is temporarily unavailable." /> : <>
      {!data.reports.length ? <EmptyState title="No shared reports created or accessed in the last 30 days." /> :
      <div style={{overflowX:'auto'}}><table className="ui-table" style={{width:'100%'}}>
        <thead><tr>{['Report','Links created¹','Code requests','Verified emails','Unique viewers','Report opens','Last opened'].map(h=><th key={h}>{h}</th>)}</tr></thead>
        <tbody>{data.reports.map(r=><tr key={r.match_id}>
          <td><Link href={url(r)}>{r.players.slice(0,2).join(' / ')} vs {r.players.slice(2,4).join(' / ')}</Link><div style={{fontSize:12,color:'var(--text-3)'}}>{r.tournament || 'Private match'}</div></td>
          <td>{r.links}</td><td>{r.requests}</td><td>{r.verified}</td><td>{r.viewers}</td><td>{r.opens}</td><td>{date(r.last_open)}</td>
        </tr>)}</tbody>
      </table><p style={{fontSize:12,color:'var(--text-3)'}}>¹ All links for each report, including expired or revoked links. Activity covers the last 30 days. Showing up to 100 reports.</p></div>}
      <details style={{marginTop:16}}><summary style={{cursor:'pointer'}}>Recent visitor activity · {data.activity.length} events</summary>
        <div style={{overflowX:'auto'}}><table className="ui-table" style={{width:'100%'}}>
          <thead><tr><th>Email</th><th>Activity</th><th>When</th><th>Report</th></tr></thead>
          <tbody>{data.activity.map((a,i)=><tr key={i}><td>{a.email || 'Unknown'}</td><td>{labels[a.event] || a.event}</td><td>{date(a.created_at)}</td><td><Link href={url(a)}>Open match report →</Link></td></tr>)}</tbody>
        </table>{!data.activity.length && <p>No visitor activity recorded in this period.</p>}</div>
      </details>
    </>}
  </Panel>
}

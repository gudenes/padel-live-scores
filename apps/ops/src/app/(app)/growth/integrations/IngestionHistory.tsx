'use client'
import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { historyPoints, type HistoryFeed, type IntegrationHistory } from '@/lib/integration-history'
import styles from './history.module.css'
const time = (value: string) => `${value.slice(5,10)} ${value.slice(11,16)}`
export function IngestionHistory() {
  const [range,setRange]=useState('24h')
  const [data,setData]=useState<IntegrationHistory|null>(null)
  const [error,setError]=useState<string|null>(null)
  const [retry,setRetry]=useState(0)
  useEffect(()=>{
    let alive=true; let timer: ReturnType<typeof setTimeout>; let controller: AbortController
    async function pull() {
      controller=new AbortController()
      const timeout=setTimeout(()=>controller.abort(),25000)
      try {
        const response=await fetch(`/api/internal/integration-monitor/history?range=${range}`,{cache:'no-store',signal:controller.signal})
        if (!response.ok) throw new Error('History unavailable. Sign in as an operator or retry shortly.')
        const next=await response.json() as IntegrationHistory
        if(alive){setData(next);setError(null)}
      } catch {if(alive)setError('History could not be refreshed. Any displayed readings are from the last successful check.')}
      finally {clearTimeout(timeout);if(alive)timer=setTimeout(()=>void pull(),range==='7d'?300000:60000)}
    }
    void pull()
    return ()=>{alive=false;controller?.abort();clearTimeout(timer)}
  },[range,retry])
  const current=data?.hours===(range==='7d'?168:24)?data:null
  return <section aria-label="Ingestion history" className={styles.history}>
    <div className={styles.header}><div><h2>Ingestion over time</h2><p>Both sources · hourly job outcomes · UTC · current hour is partial</p></div><div className={styles.controls}>
      <label>Period<select value={range} onChange={e=>setRange(e.target.value)}><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option></select></label>
      <button onClick={()=>setRetry(n=>n+1)}>Refresh history</button>
    </div></div>
    {error&&<p role="alert">{error}</p>}
    {!current&&<p role="status">{error?'No history available for this period.':'Loading ingestion history…'}</p>}
    {current&&<div className={styles.feeds}><FeedHistory feed="fip" current={current}/><FeedHistory feed="crionet" current={current}/></div>}
    <p className={styles.caption}>Source: persisted scrape-job logs, grouped by attempt start time. Categories are inferred from logged errors. Successful jobs do not guarantee complete match or point-by-point data. Historical proxy route and bandwidth measurements are not recorded yet.</p>
  </section>
}
function FeedHistory({ feed, current }: { feed: HistoryFeed; current: IntegrationHistory }) {
  const rows=current?.rows.filter(row=>row.feed===feed)??[]
  const points=current?historyPoints(rows,feed,current.hours,current.fetchedAt):[]
  const success=points.reduce((n,p)=>n+p.success,0),failed=points.reduce((n,p)=>n+p.failed,0),pending=points.reduce((n,p)=>n+p.pending,0)
  const jobs=[...new Set(rows.map(row=>row.job))].map(job=>{
    const group=rows.filter(row=>row.job===job)
    const sum=(status:string)=>group.filter(row=>row.status===status).reduce((n,row)=>n+row.runs,0)
    return {job,success:sum('success'),failed:sum('failed'),pending:sum('running')+sum('queued'),latest:group.map(row=>row.latest).sort((a,b)=>Date.parse(b)-Date.parse(a))[0]}
  }).sort((a,b)=>b.failed-a.failed)
  const reasons=[...new Set(rows.filter(row=>row.status==='failed').map(row=>row.reason??'Other / unclassified'))].map(reason=>({reason,runs:rows.filter(row=>row.status==='failed'&&(row.reason??'Other / unclassified')===reason).reduce((n,row)=>n+row.runs,0)})).sort((a,b)=>b.runs-a.runs)
  return <section className={`${styles.section} ${success+failed ? failed/(success+failed)>=.05 ? styles.issue : styles.healthy : ''}`} aria-label={`${feed==='fip'?'FIP':'Crionet'} ingestion timeline`}>
    <div className={styles.header}><h2>{feed==='fip'?'FIP':'Crionet'}</h2><span className={styles.caption}>{success+failed?`${(success/(success+failed)*100).toFixed(2)}% succeeded in this period`:'No completed jobs'}</span></div>
      <p className={styles.summary}><strong>{success.toLocaleString()} succeeded</strong> · <strong>{failed.toLocaleString()} failed</strong> · {pending.toLocaleString()} queued/running · {success+failed?`${(failed/(success+failed)*100).toFixed(2)}% failure rate`:'No completed jobs recorded'}<br/><small>Checked {time(current.fetchedAt)} UTC · refreshes {current.hours===168?'every 5 minutes':'every minute'}</small></p>
      <div className={styles.charts}>
        <div><h3>Completed jobs per hour</h3><p className={styles.legend}><span>● Succeeded</span><span>● Failed</span></p><div className={styles.plot}><ResponsiveContainer><BarChart data={points}><CartesianGrid stroke="var(--border-inner)" vertical={false}/><XAxis dataKey="hour" tickFormatter={time} minTickGap={40} tick={{fontSize:10}}/><YAxis allowDecimals={false} width={42} tick={{fontSize:11}}/><Tooltip labelFormatter={v=>`${time(String(v))} UTC`} contentStyle={{background:'var(--bg-card)',color:'var(--text-1)'}}/><Bar name="Succeeded" dataKey="success" stackId="runs" fill="#729b2d" isAnimationActive={false}/><Bar name="Failed" dataKey="failed" stackId="runs" fill="#d96047" isAnimationActive={false}/></BarChart></ResponsiveContainer></div></div>
        <div><h3>Failure rate per hour (%)</h3><p className={styles.caption}>Gaps mean no completed jobs, not a healthy reading.</p><div className={styles.plot}><ResponsiveContainer><LineChart data={points}><CartesianGrid stroke="var(--border-inner)" vertical={false}/><XAxis dataKey="hour" tickFormatter={time} minTickGap={40} tick={{fontSize:10}}/><YAxis domain={[0,100]} width={42} tick={{fontSize:11}}/><Tooltip labelFormatter={v=>`${time(String(v))} UTC`} formatter={v=>[`${Number(v).toFixed(2)}%`,'Failed']} contentStyle={{background:'var(--bg-card)',color:'var(--text-1)'}}/><Line name="Failed (%)" dataKey="failureRate" stroke="#d96047" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false}/></LineChart></ResponsiveContainer></div></div>
      </div>
      <div className={styles.charts}><div><h3>Where failures occur</h3>{jobs.length?<div className={styles.tableWrap}><table><thead><tr><th>Job</th><th>Succeeded</th><th>Failed</th><th>Pending</th><th>Latest attempt (UTC)</th></tr></thead><tbody>{jobs.map(job=><tr key={job.job}><th scope="row">{job.job}</th><td>{job.success.toLocaleString()}</td><td>{job.failed.toLocaleString()}</td><td>{job.pending.toLocaleString()}</td><td>{time(new Date(job.latest).toISOString())}</td></tr>)}</tbody></table></div>:<p>No recorded jobs in this period.</p>}</div>
      <div><h3>Failure categories</h3>{reasons.length?<ul className={styles.reasons}>{reasons.map(item=><li key={item.reason}><span>{item.reason}</span><strong>{item.runs.toLocaleString()}</strong></li>)}</ul>:<p>No failures recorded in this period.</p>}</div></div>
  </section>
}

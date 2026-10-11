'use client'
import {useEffect,useState} from 'react'
import Link from 'next/link'
import {Button} from '@/components/ui'
import {savedReport,type SavedSession} from '@/lib/scouting/saved-report'
import {pointsCsv,sessionExport} from '@/lib/scouting/export'
import {DEFAULT_METHODOLOGY,methodologies,type MethodologyId} from '@/lib/scouting/methodology'
import Insights from '../Insights'
import {MatchInsightsView} from './view/MatchInsightsView'
import {reportView,type ReportContext} from '@/lib/scouting/report-view'
import styles from '../scout.module.css'
import layout from './report.module.css'

type Report=ReturnType<typeof savedReport>
export default function SavedScoutingReport({matchId,manual=false,context={meta:{duration:null,round:null,category:null,tournament:null,scheduled_at:null},avatars:{},pbp:[]}}:{matchId:string;manual?:boolean;context?:ReportContext}){
 const [privateMatch,setPrivateMatch]=useState<{match_date?:string;tournament_label?:string}|null>(null)
 const [methodology,setMethodology]=useState<MethodologyId>(DEFAULT_METHODOLOGY)
 const [report,setReport]=useState<Report|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[attempt,setAttempt]=useState(0)
 useEffect(()=>{
  const controller=new AbortController();let active=true
  setLoading(true);setReport(null);setPrivateMatch(null);setError('')
  async function load(){
   for(const source of (manual?['video']:['video','admin']) as ('video'|'admin')[]){
    const path=source==='video'?(manual?'manual-video-scouting':'video-scouting'):'scouting'
    const response=await fetch(`/api/internal/${path}/${encodeURIComponent(matchId)}`,{cache:'no-store',signal:controller.signal})
    const data=await response.json()
    if(!response.ok)throw Error(data.error||'Could not load saved scouting.')
    if(active&&manual)setPrivateMatch(data.match??null)
    if(data.session){if(active)setReport(savedReport(data.session as SavedSession,source));return}
   }
  }
  load().catch(e=>{if(active)setError(e instanceof Error?e.message:'Could not load saved scouting.')}).finally(()=>{if(active)setLoading(false)})
  return()=>{active=false;controller.abort()}
 },[matchId,manual,attempt])
 function download(content:string,extension:'json'|'csv'){
  const url=URL.createObjectURL(new Blob([content],{type:extension==='json'?'application/json':'text/csv;charset=utf-8'}))
  const a=document.createElement('a');a.href=url;a.download=`scouting-${matchId}.${extension}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
 }
 return <main className={layout.page}>
  <header className={layout.header}><div><Link href={"/scouting"}>{"← Matches"}</Link><h1>Scouting report & insights</h1>{manual&&<p>Private scouting · manually created{privateMatch?.match_date?" · "+privateMatch.match_date:""}{privateMatch?.tournament_label?" · "+privateMatch.tournament_label:""}</p>}</div>
   <div className={styles.tools}><label>Methodology <select aria-label="Report methodology" value={methodology} onChange={e=>setMethodology(e.target.value as MethodologyId)}>{methodologies.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select></label><Link href="/scouting/methodology">Calculation methodologies</Link><Button size="sm" onClick={()=>setAttempt(n=>n+1)} disabled={loading}>Refresh server copy</Button>
   {report&&<><Button size="sm" onClick={()=>download(JSON.stringify({...sessionExport(matchId,report.players,report.revision,report.doc,methodology),source:report.source,...(manual?{privateMatch,visibility:"private-scouting"}:{}),timestampBasis:report.source==='video'?'Video position encoded as UTC from the Unix epoch; not wall-clock match time.':'Recorded wall-clock time.',originalDocument:report.original,videoReport:report.videoReport},null,2),'json')}>Export all data (JSON)</Button><Button size="sm" onClick={()=>download(pointsCsv(report.players,report.doc),'csv')}>Export points (CSV)</Button></>}</div>
  </header>
  {loading?<p role="status">Loading saved match data…</p>:error?<p role="alert">{error}</p>:!report?<section className={`ui-panel ${styles.chartPanel}`}><h2>No saved scouting for this match</h2><p>In the extension, select this match and use Sync now. Wait for “Saved to server”, then refresh this report.</p>{manual?<p>Open this match from Saved scouting sessions in the extension to begin.</p>:<Link className="ui-btn" href={`/scouting/${matchId}`}>Open admin scouting</Link>}</section>:<MatchInsightsView data={reportView(report,context,methodology)} onExport={()=>download(pointsCsv(report.players,report.doc),'csv')} reports={<Insights model={report.model} players={report.players} doc={report.doc} reviewedPointIds={report.reviewedPointIds} methodology={methodology} onMethodologyChange={setMethodology}/>}/>}
 </main>
}

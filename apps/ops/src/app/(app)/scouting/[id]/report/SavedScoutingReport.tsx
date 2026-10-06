'use client'
import {useEffect,useState} from 'react'
import Link from 'next/link'
import {Button,Pill} from '@/components/ui'
import {savedReport,type SavedSession} from '@/lib/scouting/saved-report'
import {formatDuration} from '@/lib/scouting/tracking'
import {pointsCsv,sessionExport} from '@/lib/scouting/export'
import Insights from '../Insights'
import styles from '../scout.module.css'
import layout from './report.module.css'

type Report=ReturnType<typeof savedReport>
export default function SavedScoutingReport({matchId}:{matchId:string}){
 const [report,setReport]=useState<Report|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[attempt,setAttempt]=useState(0)
 useEffect(()=>{
  const controller=new AbortController();let active=true
  setLoading(true);setReport(null);setError('')
  async function load(){
   for(const source of ['video','admin'] as const){
    const path=source==='video'?'video-scouting':'scouting'
    const response=await fetch(`/api/internal/${path}/${encodeURIComponent(matchId)}`,{cache:'no-store',signal:controller.signal})
    const data=await response.json()
    if(!response.ok)throw Error(data.error||'Could not load saved scouting.')
    if(data.session){if(active)setReport(savedReport(data.session as SavedSession,source));return}
   }
  }
  load().catch(e=>{if(active)setError(e instanceof Error?e.message:'Could not load saved scouting.')}).finally(()=>{if(active)setLoading(false)})
  return()=>{active=false;controller.abort()}
 },[matchId,attempt])
 function download(content:string,extension:'json'|'csv'){
  const url=URL.createObjectURL(new Blob([content],{type:extension==='json'?'application/json':'text/csv;charset=utf-8'}))
  const a=document.createElement('a');a.href=url;a.download=`scouting-${matchId}.${extension}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
 }
 const video=report?.videoReport
 return <main className={layout.page}>
  <header className={layout.header}><div><Link href="/tournament-explorer">← Tournament Explorer</Link><h1>Scouting report & insights</h1></div>
   <div className={styles.tools}><Button size="sm" onClick={()=>setAttempt(n=>n+1)} disabled={loading}>Refresh server copy</Button>
   {report&&<><Button size="sm" onClick={()=>download(JSON.stringify({...sessionExport(matchId,report.players,report.revision,report.doc),source:report.source,timestampBasis:report.source==='video'?'Video position encoded as UTC from the Unix epoch; not wall-clock match time.':'Recorded wall-clock time.',originalDocument:report.original,videoReport:video},null,2),'json')}>Export all data (JSON)</Button><Button size="sm" onClick={()=>download(pointsCsv(report.players,report.doc),'csv')}>Export points (CSV)</Button></>}</div>
  </header>
  {loading?<p role="status">Loading saved match data…</p>:error?<p role="alert">{error}</p>:!report?<section className={`ui-panel ${styles.chartPanel}`}><h2>No saved scouting for this match</h2><p>In the extension, select this match and use Sync now. Wait for “Saved to server”, then refresh this report.</p><Link className="ui-btn" href={`/scouting/${matchId}`}>Open admin scouting</Link></section>:<>
   <section className={`ui-panel ${styles.chartPanel}`} aria-label="Saved match summary">
    <div className={styles.tools}><h2>{report.players.slice(0,2).map(p=>p.name).join(' / ')} vs {report.players.slice(2).map(p=>p.name).join(' / ')}</h2><Pill tone={report.model.score.phase==='finished'?'lime':'warn'}>{report.model.score.phase==='finished'?'Match finished':'Scouting in progress'}</Pill></div>
    <p><strong>Scouting score: {report.model.score.sets.map(s=>`${s.a}–${s.b}`).join(', ')}</strong> · {report.model.points} points observed{video?` · ${video.shotTracking.shots} shot taps · ${video.varReviews} VAR reviews`:''}</p>
    <p>{report.source==='video'?'Point times use video positions. ':''}Observed rally time: {formatDuration(report.model.tracking.rallies.reduce((n,r)=>n+r.durationMs,0))} · {report.model.tracking.rallies.length} timed rallies.</p>
    <p>{report.source==='video'?'Video extension':'Admin scouting'} · server revision {report.revision} · saved {new Date(report.updatedAt).toLocaleString()}.</p>
    <p>{report.partial?'Partial observation: imported scores are included in the scoreboard, but do not create player statistics.':'Statistics cover the recorded points only.'} Scouting score is separate from the official result.</p>
    <a className="ui-btn" data-size="sm" href={`https://padelnachos.com/en/match/${matchId}`} target="_blank" rel="noreferrer">View public match report</a>
   </section>
    <section className={`ui-panel ${styles.chartPanel}`} aria-label="Pair and service statistics"><h2>Service & pressure points</h2><div className={styles.scroll}><table className={styles.shotResults}><thead><tr><th>Pair</th><th>Breaks / chances</th><th>Saved / faced</th><th>Holds</th><th>Star Points won / played</th><th>Set Points won / played</th><th>Match Points won / played</th></tr></thead><tbody>{(['a','b'] as const).map((team,i)=><tr key={team}><th>{report.players.slice(i*2,i*2+2).map(p=>p.name).join(' / ')}</th><td>{report.model.tracking.pairs[team].breaks} / {report.model.tracking.pairs[team].breakPoints}</td><td>{report.model.tracking.pairs[team].breakPointsSaved} / {report.model.tracking.pairs[team].breakPointsFaced}</td><td>{report.model.tracking.pairs[team].holds}</td><td>{report.model.tracking.pairs[team].starPointsWon} / {report.model.tracking.pairs[team].starPoints}</td><td>{report.model.tracking.pairs[team].setPointsWon} / {report.model.tracking.pairs[team].setPoints}</td><td>{report.model.tracking.pairs[team].matchPointsWon} / {report.model.tracking.pairs[team].matchPoints}</td></tr>)}</tbody></table></div>
     <div className={styles.scroll}><table className={styles.shotResults}><thead><tr><th>Server</th><th>Service points won / played</th><th>First faults</th><th>Double faults</th></tr></thead><tbody>{report.model.tracking.service.map((s,i)=><tr key={report.players[i].id}><th>{report.players[i].name}</th><td>{s.won} / {s.points}</td><td>{s.firstFaults}</td><td>{s.doubleFaults}</td></tr>)}</tbody></table></div>
    </section>
    {video&&<section className={`ui-panel ${styles.chartPanel}`} aria-label="Smashes and shot directions"><h2>Smashes & rally shots · whole observation</h2><p>{video.shotTracking.shots} taps across {video.shotTracking.trackedRallies} tracked rallies. Directions are inferred from consecutive hitters and court positions. Unclear and final shots remain unknown.</p>
     <div className={styles.scroll}><table className={styles.shotResults}><thead><tr><th>Player</th><th>All smash attempts</th><th>Power</th><th>X3</th><th>X4 winners</th><th>Shot taps</th><th>Cross-court</th><th>Down the line</th><th>Unknown</th></tr></thead><tbody>{video.players.map((p,i)=>{const t=video.shotTracking.players[i];return <tr key={p.id}><th>{p.name}</th><td>{p.stats.smashes}</td><td>{p.stats.powerSmashes}</td><td>{p.stats.x3Smashes}</td><td>{p.stats.x4Winners}</td><td>{t.shots}</td><td>{t.crossCourt}</td><td>{t.downTheLine}</td><td>{t.unknown}</td></tr>})}</tbody></table></div><p>Power and X3 are recorded attempt types; X4 is a winner tag. Older attempts without a type remain in the total.</p>
    </section>}
   <Insights model={report.model} players={report.players} doc={report.doc} reviewedPointIds={report.reviewedPointIds}/>
  </>}
 </main>
}

'use client'
import {useEffect,useState} from 'react'
import type {ScoutingReport} from '../../extensions/scouting-video-overlay/public-report.mjs'
export function VideoScoutingReport({matchId}:{matchId:string}){
 const [report,setReport]=useState<ScoutingReport|null>(null);
 useEffect(()=>{let active=true;const controller=new AbortController();
  const load=()=>fetch(`/api/video-scouting/${matchId}`,{cache:'no-store',signal:controller.signal}).then(r=>r.ok?r.json():null).then(data=>{if(active)setReport(data?.report??null)}).catch(()=>{});
  load();const timer=setInterval(load,30000);return()=>{active=false;controller.abort();clearInterval(timer)};
 },[matchId]);
 if(!report)return null;
 return <section className="ui-panel" aria-label="Scouting report" style={{margin:'12px 0',padding:16,overflowX:'auto'}}>
  <h2 style={{fontSize:18,fontWeight:800}}>Scouting report</h2>
  <p style={{fontSize:12,opacity:.7}}>{report.partial?'Partial match observation · statistics cover the scouted points only.':'Complete match observation.'} {report.points} points scouted.{report.varReviews?` ${report.varReviews} points reviewed by VAR.`:''} Scouting score is separate from the official result.</p>
  <table style={{width:'100%',fontSize:12,borderSpacing:'8px'}}><thead><tr><th scope="col">Pair</th>{report.sets.map((_,i)=><th scope="col" key={i}>Set {i+1}</th>)}<th scope="col">Breaks / chances</th><th scope="col">Saved / faced</th><th scope="col">Star Points won / played</th></tr></thead><tbody>{(['a','b'] as const).map((team,i)=><tr key={team}><th scope="row">{report.players.slice(i*2,i*2+2).map(p=>p.name).join(' / ')}</th>{report.sets.map((s,j)=><td key={j}>{s[team]}</td>)}<td>{report.pairs[team].breaks} / {report.pairs[team].breakPoints}</td><td>{report.pairs[team].breakPointsSaved} / {report.pairs[team].breakPointsFaced}</td><td>{report.pairs[team].starPointsWon} / {report.pairs[team].starPoints}</td></tr>)}</tbody></table>
  <div role="region" aria-label="Player scouting statistics" tabIndex={0} style={{overflowX:'auto'}}><table style={{width:'100%',fontSize:12,borderSpacing:'8px'}}><thead><tr><th scope="col">Player</th><th scope="col">Winners</th><th scope="col">Unforced errors</th><th scope="col">Forced errors</th><th scope="col">Assists</th><th scope="col">Double faults</th><th scope="col">Power attempts</th><th scope="col">X3 attempts</th><th scope="col">X4 winners</th></tr></thead><tbody>{report.players.map(p=><tr key={p.id}><th scope="row">{p.name}</th><td>{p.stats.winners}</td><td>{p.stats.unforced}</td><td>{p.stats.forced}</td><td>{p.stats.assists}</td><td>{p.stats.doubleFaults}</td><td>{p.stats.powerSmashes??0}</td><td>{p.stats.x3Smashes??0}</td><td>{p.stats.x4Winners??0}</td></tr>)}</tbody></table></div>
 {report.shotTracking?.shots>0&&<div><h3>Rally shot tracking</h3><p style={{fontSize:12}}>{report.shotTracking.shots} taps across {report.shotTracking.trackedRallies} tracked rallies. Directions are estimates from consecutive hitters and recorded court positions. Final shots and unclear sequences remain unknown.</p><table style={{width:'100%',fontSize:12}}><thead><tr><th scope="col">Player</th><th scope="col">Shots</th><th scope="col">Cross-court</th><th scope="col">Down the line</th><th scope="col">Unknown</th></tr></thead><tbody>{report.shotTracking.players.map((p,i)=><tr key={report.players[i].id}><th scope="row">{report.players[i].name}</th><td>{p.shots}</td><td>{p.crossCourt}</td><td>{p.downTheLine}</td><td>{p.unknown}</td></tr>)}</tbody></table></div>}
 </section>
}

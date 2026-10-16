'use client';
import {useState} from 'react';
import type {ReportView} from '@/lib/scouting/report-view';
import {shots} from '@/lib/scouting/shots';
import {endingFilters,shotDistribution,type EndingFilter} from '@/lib/scouting/shot-distribution';
import './shot-distribution.css';
const palette=['#428c91','#8574b6','#e7ad43','#e77e73','#659d65','#b58756','#678cba','#ad718b','#a0b836','#599caa','#956b55','#727ba9','#b18b43','#6f9982','#9379a0','#a28574','#718e9e','#929a80'];
const color=(key:string)=>key==='unknown'?'#a4aaa2':palette[Object.keys(shots).indexOf(key)%palette.length];
const label=(key:string)=>shots[key as keyof typeof shots]??'Not recorded';
export default function ShotDistribution({data,scope}:{data:ReportView;scope:string}){
 const [outcome,setOutcome]=useState<EndingFilter>('unforced');
 const [hovered,setActive]=useState<string|null>(null);
 const [selected,setSelected]=useState<string|null>(null);
 const active=hovered??selected;
 const d=data.scopes[scope];const {rows,keys}=shotDistribution(d.points,outcome);
 const percent=(n:number,t:number)=>t?Math.round(n/t*100):0;
 return <section className="panel shot-breakdown" aria-label="Shot breakdown by outcome">
  <div className="sd-heading"><div><h2>Shot breakdown by outcome</h2><p className="muted">See which point-ending shots account for each player’s results.</p></div><span className="sd-scope">{scope==='all'?'Full match':`Set ${scope}`}</span></div>
  <div className="sd-filters" role="group" aria-label="Shot outcome">{Object.entries(endingFilters).map(([key,title])=><button className="ui-btn" key={key} aria-pressed={outcome===key} data-variant={outcome===key?'primary':'default'} onClick={()=>{setOutcome(key as EndingFilter);setActive(null);setSelected(null)}}>{title}</button>)}</div>
  <div className="sd-profiles">{data.players.map((p,i)=>{const row=rows[i],s=d.stats[i];return <article key={p.id} className="sd-profile">
   <div className="sd-person"><img src={p.avatar} alt="" className={i<2?'sd-lime':'sd-coral'}/><div><strong>{p.shortName}</strong><small>{row.total} {outcome==='all'?'point endings':endingFilters[outcome].toLowerCase()}</small></div><b className="sd-score">{d.analysis.players[i].score?.toFixed(1)??'—'}<small>/10</small></b></div>
   <div className="sd-stats"><span>W <b>{s.winners}</b></span><span>UE <b>{s.unforced}</b></span><span>FE <b>{s.forced}</b></span><span>FE+ <b>{s.forcedErrorsCreated}</b></span><span>Assist <b>{s.assists}</b></span></div>
   <div className="sd-donut">
    <svg viewBox="0 0 200 200" role="group" aria-label={`${p.shortName}: ${endingFilters[outcome]}`}>
     <circle className="sd-donut-track" cx="100" cy="100" r="72" fill="none" strokeWidth="25"/>
     {keys.filter(k=>row.counts[k]).map((k,index,segments)=>{
      const share=row.counts[k]/row.total;
      const offset=segments.slice(0,index).reduce((sum,key)=>sum+row.counts[key]/row.total,0);
      const angle=(offset+share/2)*2*Math.PI-Math.PI/2;
      const shift=selected===k?9:0;
      return <circle key={k} cx="100" cy="100" r="72" fill="none" pathLength="100" stroke={color(k)} strokeWidth={active===k?31:25}
       strokeDasharray={`${share*100} ${100-share*100}`} strokeDashoffset={-offset*100} transform={`translate(${Math.cos(angle)*shift} ${Math.sin(angle)*shift}) rotate(-90 100 100)`}
       className="sd-donut-segment" data-muted={!!active&&active!==k} tabIndex={0} role="button" aria-pressed={selected===k}
       aria-label={`${label(k)}: ${row.counts[k]}, ${percent(row.counts[k],row.total)}%`}
       onMouseEnter={()=>setActive(k)} onMouseLeave={()=>setActive(null)} onFocus={()=>setActive(k)} onBlur={()=>setActive(null)}
       onClick={()=>{setSelected(selected===k?null:k);setActive(null)}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelected(selected===k?null:k);setActive(null)}}}/>
     })}
    </svg>
    <div className="sd-donut-center"><strong>{active?`${percent(row.counts[active]??0,row.total)}%`:row.total}</strong><span>{active?label(active):row.total?'point endings':'No matching endings'}</span>{active&&<small>{row.counts[active]??0} of {row.total}</small>}</div>
   </div>
   <div className="sd-hover" aria-live="polite">{active?<><i style={{background:color(active)}}/>{label(active)} <b>{row.counts[active]??0}</b><span>{percent(row.counts[active]??0,row.total)}%</span></>:<span>Click a slice to keep it selected</span>}</div>
  </article>})}</div>
  {!keys.length?<p>No recorded points match this outcome in the selected set.</p>:<><div className="sd-legend" aria-label="Shot colors">{keys.map(k=><button key={k} onMouseEnter={()=>setActive(k)} onMouseLeave={()=>setActive(null)} onFocus={()=>setActive(k)} onBlur={()=>setActive(null)} onClick={()=>{setSelected(selected===k?null:k);setActive(null)}} aria-pressed={selected===k}><i style={{background:color(k)}}/>{label(k)}</button>)}</div><div className="sd-table-wrap"><table className="sd-table"><caption className="sd-caption">Counts and share of each player’s {outcome==='all'?'point endings':endingFilters[outcome].toLowerCase()}</caption><thead><tr><th>Shot type</th>{data.players.map(p=><th key={p.id}>{p.shortName}</th>)}</tr></thead><tbody>{keys.map(k=><tr key={k} data-active={active===k} onMouseEnter={()=>setActive(k)} onMouseLeave={()=>setActive(null)}><th><i style={{background:color(k)}}/>{label(k)}</th>{rows.map((r,i)=><td key={i}><b>{r.counts[k]??0}</b><span>{percent(r.counts[k]??0,r.total)}%</span></td>)}</tr>)}</tbody></table></div></>}
  <p className="sd-note">Percentages show the share of the selected outcome, not the probability of missing a shot. Missing shot types remain in “Not recorded”. {outcome==='created'?'Creation uses the identified creator’s previous shot, never the defender’s missed shot.':''}</p>
 </section>;
}

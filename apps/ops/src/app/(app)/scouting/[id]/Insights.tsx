'use client'
import {useMemo,useState} from 'react'
import {Button} from '@/components/ui'
import {replay,activeEvents,type ScoutDoc} from '@/lib/scouting/model'
import {formatDuration} from '@/lib/scouting/tracking'
import type {ScoutPerson} from '@/lib/scouting/export'
import {playerEvolution,setSegments} from '@/lib/scouting/insights'
import {shots,type Shot} from '@/lib/scouting/shots'
import styles from './scout.module.css'
function Avatar({person}:{person:ScoutPerson}){
 const [failed,setFailed]=useState(false),src=person.avatar_url||person.photo_url
 return src&&!failed?<img className={styles.avatar} src={src} alt={person.name} onError={()=>setFailed(true)}/>:<span className={styles.avatar} aria-label={person.name}>{person.name.split(' ').map(s=>s[0]).slice(0,2).join('')}</span>
}
const colors=['#7954CA','#43318B','#247F87','#429FA8']
export default function Insights({model,players,doc}:{model:ReturnType<typeof replay>;players:ScoutPerson[];doc:ScoutDoc}){
 const points=model.tracking.timeline,[selected,setSelected]=useState<number|null>(null)
 const index=Math.min(selected??points.length-1,points.length-1),p=points[index]
 const [chart,setChart]=useState<'players'|'pairs'>('players')
 const sets=useMemo(()=>setSegments(points),[points])
 const series=useMemo(()=>playerEvolution(points),[points])
 const snapshot=useMemo(()=>{const events=activeEvents(doc);const end=p?events.findIndex(e=>e.id===p.id):-1;return replay({...doc,events:events.slice(0,end+1)})},[doc,p])
 const values=chart==='players'?series.flatMap(p=>p.values):points.map(p=>p.lead)
 const lo=Math.min(-2,...values),hi=Math.max(3,...values),x=(n:number)=>48+n/Math.max(1,points.length)*840,y=(v:number)=>235-(v-lo)/(hi-lo)*195
 const line=(values:number[])=>[`M ${x(0)} ${y(0)}`,...values.map((v,i)=>`L ${x(i+1)} ${y(v)}`)].join(' ')
 return <section className={styles.insights} aria-label="Match insights">
  <section className={`ui-panel ${styles.chartPanel}`}>
   <div className={styles.tools}><h2>Match evolution</h2><Button size="sm" aria-pressed={chart==='players'} onClick={()=>setChart('players')}>Four players</Button><Button size="sm" aria-pressed={chart==='pairs'} onClick={()=>setChart('pairs')}>Pair lead</Button></div>
   <p>{chart==='players'?'Net actions = winners − unforced errors − forced errors − double faults. Each action has equal weight; this is a descriptive count, not a weighted player rating.':'Cumulative observed points won by pair A minus pair B. Above zero favours A; below zero favours B.'} Imported scores do not create observations.</p>
   <div className={styles.playerLegend}>{players.map((person,i)=><div className={styles.identity} key={person.id}><span style={{background:colors[i]}} className={styles.lineKey}/><Avatar person={person}/><span>{person.name}</span></div>)}</div>
   {!points.length?<p>Record the first point to begin the graph.</p>:<>
    <svg viewBox="0 0 940 326" role="img" aria-label={chart==='players'?'Four-player evolution of winners minus errors':'Cumulative observed point lead, pair A minus pair B'}>
      {[lo,0,hi].map(v=><g key={v}><line x1="48" x2="888" y1={y(v)} y2={y(v)} stroke="var(--border-strong)" strokeDasharray={v?'3 5':undefined}/><text x="8" y={y(v)+4}>{v>0?'+':''}{v}</text></g>)}
      {chart==='players'?players.map((person,i)=><path key={person.id} d={line(series.map(p=>p.values[i]))} fill="none" stroke={colors[i]} strokeWidth="3" strokeDasharray={i%2?'7 3':undefined}/>):<path d={line(points.map(p=>p.lead))} fill="none" stroke="var(--lime-text)" strokeWidth="3"/>}
      {points.filter(p=>p.breakConverted||p.star||p.outcome==='double_fault').map(p=><circle key={p.id} cx={x(p.number)} cy="250" r="4" fill="var(--orange)"><title>Point {p.number}: {p.breakConverted?'break ':''}{p.star?'Star Point ':''}{p.outcome==='double_fault'?'double fault':''}</title></circle>)}
      {p&&<><line x1={x(p.number)} x2={x(p.number)} y1="25" y2="250" stroke="var(--orange)" strokeWidth="2"/>{(chart==='players'?series[index].values:[p.lead]).map((v,i)=><circle key={i} cx={x(p.number)} cy={y(v)} r="5" fill={chart==='players'?colors[i]:'var(--text-1)'}/>)}</>}
      {sets.map((set,i)=>{const left=x(set.first-1),width=x(set.last)-left,active=index+1>=set.first&&index+1<=set.last;return <g key={`${set.set}-${set.first}`}>
        {i>0&&<line x1={left} x2={left} y1="25" y2="286" stroke="var(--border-strong)" strokeDasharray="4 4"/>}
        <rect x={left+1} y="287" width={Math.max(1,width-2)} height="28" rx="4" fill={active?'var(--lime-bg-2)':'var(--bg-card-2)'} stroke={active?'var(--lime-border)':'var(--border-card)'}/>
        <title>Set {set.set} · {set.score.a}–{set.score.b}{set.complete?' · completed':' · in progress'} · observed points {set.first}–{set.last}</title>
        {width>42&&<text x={left+width/2} y="305" textAnchor="middle">{width>145?`Set ${set.set} · ${set.score.a}–${set.score.b}${set.complete?'':' · playing'}`:`Set ${set.set}`}</text>}
      </g>})}
      <text x="48" y="275">Point 0</text><text x="815" y="275">Point {points.length}</text>
    </svg>
    <div className={styles.setNavigation} aria-label="Explore sets">{sets.map(set=><Button size="sm" key={`${set.set}-${set.first}`} aria-pressed={index+1>=set.first&&index+1<=set.last} onClick={()=>setSelected(set.first-1)}>Set {set.set} · {set.score.a}–{set.score.b}{set.complete?' · completed':' · in progress'}</Button>)}</div>
    <label className={styles.scrubber}>Explore point {index+1} of {points.length}<input aria-label="Explore match point" type="range" min="1" max={points.length} value={index+1} onChange={e=>setSelected(Number(e.target.value)-1)}/></label>
    <div className={styles.tools}><Button size="sm" disabled={index<=0} onClick={()=>setSelected(index-1)}>Previous point</Button><Button size="sm" disabled={index===points.length-1} onClick={()=>setSelected(index+1)}>Next point</Button><Button size="sm" onClick={()=>setSelected(null)}>Latest point</Button><span>● Orange markers: breaks, Star Points or double faults</span></div>
    {p&&<div className={styles.pointDetail}><Avatar person={players[p.player??p.server]}/><div><strong>Point {p.number} · {p.player===null?'Unattributed point':players[p.player].name} · {p.outcome.replaceAll('_',' ')}{p.shot?` · ${shots[p.shot]}`:p.smash?' · smash':''}{p.side?` · ${p.side}`:''}{p.recovery?' · outside-court recovery':''}{p.assistBy!==undefined?` · assist: ${players[p.assistBy].name}`:''}</strong><p>Pair {p.winner.toUpperCase()} wins · serving: {players[p.server].name} · duration {formatDuration(p.durationMs)}{p.durationMs===null?' (start not recorded)':''}</p><p>Score afterwards: {p.after.sets.map(s=>`${s.a}–${s.b}`).join(', ')} · points {p.after.currentGame.a}–{p.after.currentGame.b}{p.star?' · Star Point':''}{p.breakConverted?' · BREAK':''}</p></div></div>}
   </>}
  </section>
  <div><h2 className={styles.snapshotTitle}>Player stats · through point {p?.number??0}</h2><div className={styles.playerSummaries}>{players.map((person,i)=>{const st=snapshot.stats[i],serve=snapshot.tracking.service[i],pct=st.smashes?100*st.smashWinners/st.smashes:0,net=series[index]?.values[i]??0;return <article className={`ui-panel ${styles.summaryCard}`} key={person.id} style={{borderTop:`3px solid ${colors[i]}`}}>
    <header><div className={styles.identity}><Avatar person={person}/><strong>{person.name}</strong></div><span style={{color:colors[i]}}>Net actions <b>{net>0?'+':''}{net}</b></span></header>
    <div className={styles.summaryBody}><dl><div><dt>Winners</dt><dd>{st.winners}</dd></div><div><dt>Unforced errors</dt><dd>{st.unforced}</dd></div><div><dt>Forced errors</dt><dd>{st.forced}</dd></div><div><dt>Double faults</dt><dd>{serve.doubleFaults}</dd></div><div><dt>Assists</dt><dd>{st.assists}</dd></div><div><dt>Outside-court winners</dt><dd>{st.recoveryWinners}</dd></div></dl><div className={styles.ringWrap}><div className={styles.smashRing} style={{background:`conic-gradient(${colors[i]} ${pct}%, var(--border-card) 0)`}}><span>{st.smashes?Math.round(pct)+'%':'—'}</span></div><small>Smash conversion</small></div></div>
    <footer><span>Smash winners <b>{st.smashWinners}/{st.smashes}</b></span><span>Service points won <b>{serve.won}/{serve.points}</b></span></footer>
   </article>})}</div><p className={styles.hint}>Smash conversion = direct smash winners / recorded attempts. Assists credit the teammate who prepared a winner; they do not add points or change net actions.</p></div>
  <section className={`ui-panel ${styles.chartPanel}`}><h2>Results by finishing shot</h2><p>Through the selected point. Winners and errors only; this is not efficiency across all attempts.</p><div className={styles.scroll}><table className={styles.shotResults}><thead><tr><th>Player</th><th>Shot</th><th>Winners</th><th>Unforced</th><th>Forced</th></tr></thead><tbody>{players.flatMap((person,i)=>Object.entries(snapshot.stats[i].shots).map(([shot,totals])=><tr key={`${i}-${shot}`}><th>{person.name}</th><td>{shot==='unrecorded'?'Not recorded':shots[shot as Shot]}</td><td>{totals.winners}</td><td>{totals.unforced}</td><td>{totals.forced}</td></tr>))}</tbody></table></div></section>
  <section className={`ui-panel ${styles.chartPanel}`}><h2>Key moments</h2><div className={styles.moments}>{points.filter(p=>p.breakConverted||p.star||p.outcome==='double_fault').map(p=><Button key={p.id} onClick={()=>setSelected(p.number-1)}>Point {p.number} · {p.breakConverted?'Break · ':''}{p.star?'Star Point · ':''}{p.outcome==='double_fault'?'Double fault · ':''}pair {p.winner.toUpperCase()}</Button>)}</div>{!points.some(p=>p.breakConverted||p.star||p.outcome==='double_fault')&&<p>No key moments recorded yet.</p>}</section>
 </section>
}

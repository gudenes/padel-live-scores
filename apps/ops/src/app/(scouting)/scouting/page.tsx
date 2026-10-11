import Link from 'next/link'
import {auth} from '@/lib/auth'
import {canViewReports} from '@/lib/scouting-permissions'
import {redirect} from 'next/navigation'
import {pgPool} from '@/lib/db'
import {librarySummary,libraryDuration} from '@/lib/scouting/library-summary'
import InsightLink from './InsightLink'
import {catalogFilters,catalogUrl,loadMatchCatalog,MATCH_PAGE_SIZE} from '@/lib/scouting/match-catalog'
import styles from './library.module.css'
export const dynamic='force-dynamic'
export const metadata={title:'Matches · Padel Nachos'}
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const user=(await auth())?.user;if(!canViewReports(user))redirect('/login')
 const params=await searchParams
 const filters=catalogFilters(params)
 const {q,status,kind,scouter,date,scouting,page}=filters
 let rows:any[]=[];let failed=false;let hasNext=false
 try{({rows,hasNext}=await loadMatchCatalog(pgPool(),filters))}catch{failed=true}
 const pageUrl=(n:number)=>catalogUrl(filters,{page:n})
 return <main className={styles.page}>
 <header className={styles.heading}><div><div className={styles.eyebrow}>YOUR MATCH LIBRARY</div><h1>Matches<span className={styles.titleDot} aria-hidden="true"/></h1><p>Every match, with scouting insights when available.</p></div><Link className="ui-btn" data-variant="ghost" href="/scouting/methodology">Methodology</Link></header>
 <form className={styles.filters}>
 <label className={styles.search}>Players or tournament<input className="ui-input" name="q" placeholder="Search players or tournaments…" defaultValue={q}/></label>
 <label>Match date<input className="ui-input" type="date" name="date" defaultValue={date}/></label>
 <label>Status<select className="ui-input" name="status" defaultValue={status}><option value="">All statuses</option><option value="finished">Finished</option><option value="live">Live</option><option value="scheduled">Scheduled</option><option value="walkover">Walkover</option><option value="retired">Retired</option></select></label>
 <label>Type<select className="ui-input" name="kind" defaultValue={kind}><option value="">All matches</option><option value="match">Tournament</option><option value="private">Private</option></select></label>
 <label>Scouter<input className="ui-input" name="scouter" placeholder="Scouter email" defaultValue={scouter}/></label>
 <input type="hidden" name="scouting" value={scouting}/><button className="ui-btn" data-variant="primary">Search</button></form>
 <div className={styles.listToolbar}><nav className={styles.scoutFilters} aria-label="Scouting filter">{[['','All matches'],['scouted','With scouting'],['unscouted','Without scouting']].map(([value,label])=><Link key={value} className="ui-btn" data-variant={scouting===value?'primary':'ghost'} aria-current={scouting===value?'page':undefined} href={catalogUrl(filters,{scouting:value,page:1})}>{label}</Link>)}</nav><span className={styles.sortNote}>Newest match date first · {MATCH_PAGE_SIZE} per page</span></div>
 <div className={styles.grid}>
 {failed?<p role="alert">Could not load matches. Please retry; your scouting data remains saved.</p>:!rows.length?<p className="ui-panel">No matches match these filters. <Link href="/scouting">Reset filters</Link></p>:rows.map(r=>{
 const official=Array.isArray(r.official_sets)?r.official_sets.filter((s:any)=>Number.isInteger(s.a)&&Number.isInteger(s.b)):[]
 const summary=r.has_scouting?librarySummary(r,r.source,official):{quality:null,ratings:[null,null,null,null],points:null,sets:[],partial:false,failed:false}
 const sets=official.length?official:summary.sets
 const duration=libraryDuration(r.duration)
 const finished=['finished','walkover','retired'].includes(r.match_status)||(!r.match_status&&r.phase==='finished')
 const statusLabel=r.match_status==='live'?'Live':finished?(r.match_status==='walkover'?'Walkover':r.match_status==='retired'?'Retired':'Finished'):r.match_status==='scheduled'?'Scheduled':'Match available'
 return <article key={r.kind+r.match_id} className={styles.card}>
 <div className={styles.cardTop}><span className={styles.badge} data-state={r.match_status==='live'?'live':finished?'finished':'scheduled'}>{statusLabel}</span><span>{r.match_date?new Date(r.match_date).toLocaleDateString('en-GB',{timeZone:'Europe/Madrid',day:'2-digit',month:'short',year:'numeric'}):'Date unavailable'}</span><div className={styles.cardNudges}><span className={styles.scoutBadge} data-scouted={r.has_scouting}>{r.has_scouting?(summary.points===0?'Scouting started':'Scouted'):'Not scouted'}</span>{r.has_scouting&&<>{summary.quality?.mode!=='Pro'&&<span className={styles.mode} data-mode={summary.quality?.mode.toLowerCase()??'unknown'} title={summary.quality?.modeInferred?'Inferred from recorded rally taps':'Recorded scouting mode'}>{summary.quality?.mode==='Unknown'||!summary.quality?'Mode unknown':summary.quality.mode}{summary.quality?.modeInferred?' · inferred':''}</span>}<details className={styles.quality}><summary><span data-quality={summary.quality?.label.toLowerCase()??'unavailable'}>Quality · {summary.quality?.label??'Unavailable'}</span>{summary.quality?.provisional&&<small>Provisional</small>}</summary><p>{summary.quality?.score!=null?`${summary.quality.score}/100 · `:''}Methodology v1.1 · Not reviewed against video</p>{summary.quality&&<><p>Complete records {summary.quality.components.completeness}% · Consistency {summary.quality.components.consistency}% · Score checked {summary.quality.components.reconciliation}%</p><p>{summary.quality.coverage.scouted} scouted · {summary.quality.coverage.scoreOnly} score-only{summary.quality.coverage.unknownGap?' · Partial coverage; gap size unknown':''}</p><p>{summary.quality.sequences.eligible?`Expert sequences: ${summary.quality.sequences.consistent}/${summary.quality.sequences.eligible} consistent rallies (${summary.quality.components.sequenceConsistency}%). ${summary.quality.sequences.invalidTransitions} invalid transitions.`:'Sequence checks apply to Expert rallies only.'}</p><p>{summary.quality.sequences.flagged.length?`Review points ${summary.quality.sequences.flagged.slice(0,8).map(p=>p.number).join(', ')}${summary.quality.sequences.flagged.length>8?'…':''}`:''}</p><p>{summary.quality.modeInferred?'Mode inferred from existing taps.':''}</p><ul>{summary.quality.issues.map(issue=><li key={issue}>{issue}</li>)}</ul></>}<p>High ≥90 · Medium 70–&lt;90 · Low &lt;70. Optional strokes and sync speed do not change this score.</p></details></>}</div></div>
 <h2>{r.tournament_name}</h2><p className={styles.sub}>{[r.round,r.category,r.kind==='private'?'Private match':'Tournament match'].filter(Boolean).join(' · ')}</p>
 <div className={styles.scoreLabel}>{official.length?'Official result':r.has_scouting?'Scouting score':'Result pending'}{r.has_scouting?' · Player Score / 10':''}</div>
 {[0,1].map(team=><div className={styles.team} key={team}><div className={styles.pair}>{r.players.slice(team*2,team*2+2).map((p:any,i:number)=>{const rating=summary.ratings[team*2+i],avatar=r.avatars?.[p.id]??p.avatar_url??p.photo_url;return <div className={styles.player} key={p.id??i}>{avatar?<img className={styles.avatar} src={avatar} alt="" loading="lazy"/>:<span className={styles.avatarFallback} aria-hidden="true">{p.name?.slice(0,1)}</span>}<span>{p.name}</span>{r.has_scouting&&<span className={styles.rating} data-high={rating!==null&&rating>=9} title={`Player Score · v1.5${summary.partial?' · Partial observation':''}`}>{rating===null?'—':rating.toFixed(1)}</span>}</div>})}</div><div className={styles.sets}>{sets.length?sets.map((set:any,i:number)=><span key={i} aria-label={`Set ${i+1}: ${team===0?set.a:set.b}`}><small>S{i+1}</small><b>{team===0?set.a:set.b}</b></span>):<span>—</span>}</div></div>)}
 <div className={styles.meta}><span>{r.has_scouting?(summary.points===null?'Stats unavailable':`${summary.points} points scouted`):'No scouting data yet'}{summary.partial?' · Partial':''}</span><span>{duration?<>Match time <strong>{duration}</strong></>:<>Match time <strong>—</strong></>}</span></div>
 <footer>{r.has_scouting?<><div><strong>{summary.failed?'Report needs review':'Saved to server'}</strong><small>Scouter: {r.assigned_email??'Administrator / unassigned'}</small><small>Saved {new Date(r.updated_at).toLocaleString('en-GB',{timeZone:'Europe/Madrid'})}</small></div><InsightLink href={`/scouting/${r.kind==='private'?'manual/':''}${r.match_id}/report`}/></>:<div><strong>{user?.isViewer?'Scouting insights will appear here':'Scout with the Padel Nachos extension'}</strong>{!user?.isViewer&&<small>Choose New match in the extension to begin.</small>}</div>}</footer>
 {user?.isOperator&&r.has_scouting&&r.source==='video'&&<div className={styles.assign}><Link href={`/team-access?match=${r.match_id}&kind=${r.kind}`}>Assign scouter</Link></div>}
 </article>})}</div>
 {!failed&&<nav className={styles.pagination} aria-label="Match pages"><span>{rows.length?`Showing ${(page-1)*MATCH_PAGE_SIZE+1}–${(page-1)*MATCH_PAGE_SIZE+rows.length}`:'0 matches'} · Page {page}</span><div>{page>1&&<Link className="ui-btn" href={pageUrl(page-1)}>Previous</Link>}{hasNext&&<Link className="ui-btn" data-variant="primary" href={pageUrl(page+1)}>Next</Link>}</div></nav>}</main>
}

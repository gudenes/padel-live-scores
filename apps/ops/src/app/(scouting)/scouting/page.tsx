import Link from 'next/link'
import {auth} from '@/lib/auth'
import {canViewReports} from '@/lib/scouting-permissions'
import {redirect} from 'next/navigation'
import {pgPool} from '@/lib/db'
import MatchCard from './MatchCard'
import CatalogSearchForm from './CatalogSearchForm'
import FilterSelect from './FilterSelect'
import FilterDate from './FilterDate'
import {catalogFilters,catalogUrl,loadMatchCatalog,MATCH_PAGE_SIZE,LEAGUE_GROUPS} from '@/lib/scouting/match-catalog'
import styles from './library.module.css'
export const dynamic='force-dynamic'
export const metadata={title:'Matches · Padel Nachos'}
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const user=(await auth())?.user;if(!canViewReports(user))redirect('/login')
 const params=await searchParams
 const filters=catalogFilters(params)
 const {q,status,kind,scouter,date,scouting,page,league}=filters
 let rows:any[]=[];let failed=false;let hasNext=false
 try{({rows,hasNext}=await loadMatchCatalog(pgPool(),filters))}catch{failed=true}
 const circuit=league==='premier'||['major','p1','p2','finals'].includes(league)?'premier':league==='fip'||league.startsWith('fip_')?'fip':''
 const activeFilters=[['q',q?'Search: '+q:''],['league',LEAGUE_GROUPS.flatMap(g=>g.options.map(([v,l])=>[v,g.label+' · '+l])).find(([v])=>v===league)?.[1]??''],['date',date],['status',status],['kind',kind],['scouter',scouter?'Scouter: '+scouter:'']].filter(([,value])=>value)
 const extraCount=[date,status,kind,scouter].filter(Boolean).length
 const pageUrl=(n:number)=>catalogUrl(filters,{page:n})
 return <main className={styles.page}>
 <header className={styles.heading}><div><div className={styles.eyebrow}>YOUR MATCH LIBRARY</div><h1>Matches<span className={styles.titleDot} aria-hidden="true"/></h1><p>Every match, with scouting insights when available.</p></div><Link className="ui-btn" data-variant="ghost" href="/scouting/methodology">Methodology</Link></header>
 <section className={styles.filterPanel} aria-label="Match filters">
 <CatalogSearchForm className={styles.refinedFilters} initialSearch={q}>
 <div className={styles.filterMain}>
 <label className={styles.heroSearch}><span>Find a match</span><div><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg><input className="ui-input" name="q" placeholder="Search a player or tournament…" defaultValue={q}/></div></label>
 <div className={styles.tierField}><FilterSelect name="league" label="Tournament tier" value={league} options={[{value:'',label:'All circuits & tiers'},...LEAGUE_GROUPS.filter(g=>!circuit||(circuit==='fip'?g.label==='FIP':g.label==='Premier Padel')).flatMap(g=>g.options.map(([value,label])=>({value,label,group:g.label})))]}/></div>
 <button className="ui-btn" data-variant="primary">Search</button>
 </div>
 <div className={styles.filterSecondary}><nav className={styles.circuitTabs} aria-label="Circuit">{[['','All circuits'],['premier','Premier Padel'],['fip','FIP']].map(([value,label])=><Link key={value} className="ui-btn" data-size="sm" data-variant={circuit===value?'primary':'ghost'} aria-current={circuit===value?'page':undefined} href={catalogUrl(filters,{league:value,page:1})}>{label}</Link>)}</nav>
 <details className={styles.moreFilters}><summary>More filters {extraCount>0&&<span>{extraCount}</span>}<span aria-hidden="true">⌄</span></summary>
 <div className={styles.extraFields}>
 <FilterDate key={date} value={date}/>
 <FilterSelect name="status" label="Status" value={status} options={[['','All statuses'],['finished','Finished'],['live','Live'],['scheduled','Scheduled'],['walkover','Walkover'],['retired','Retired']].map(([value,label])=>({value,label}))}/>
 <FilterSelect name="kind" label="Match type" value={kind} options={[['','All matches'],['match','Tournament'],['private','Private']].map(([value,label])=>({value,label}))}/>
 <label>Scouter<input key={scouter} className="ui-input" name="scouter" placeholder="Scouter email" defaultValue={scouter}/></label>
 </div></details></div>
 <input type="hidden" name="scouting" value={scouting}/>
 </CatalogSearchForm>
 {activeFilters.length>0&&<div className={styles.activeFilters} aria-label="Active filters">{activeFilters.map(([key,label])=><Link key={key} className="ui-btn" data-size="sm" data-variant="ghost" aria-label={`Remove ${label} filter`} href={catalogUrl(filters,{[key]:'',page:1})}>{label}<span aria-hidden="true">×</span></Link>)}<Link className="ui-btn" data-variant="ghost" data-size="sm" href={catalogUrl(filters,{q:'',league:'',date:'',status:'',kind:'',scouter:'',page:1})}>Clear filters</Link></div>}
 </section>
 <div className={styles.listToolbar}><nav className={styles.scoutFilters} aria-label="Scouting filter">{[['','All matches'],['scouted','With scouting'],['unscouted','Without scouting']].map(([value,label])=><Link key={value} className="ui-btn" data-variant={scouting===value?'primary':'ghost'} aria-current={scouting===value?'page':undefined} href={catalogUrl(filters,{scouting:value,page:1})}>{label}</Link>)}</nav><span className={styles.sortNote}>Newest match date first · {MATCH_PAGE_SIZE} per page</span></div>
 <div className={styles.grid}>
 {failed?<p role="alert">Could not load matches. Please retry; your scouting data remains saved.</p>:!rows.length?<p className="ui-panel">No matches match these filters. <Link href="/scouting">Reset filters</Link></p>:rows.map(r=><MatchCard key={r.kind+r.match_id} row={r} user={user}/>)}</div>
 {!failed&&<nav className={styles.pagination} aria-label="Match pages"><span>{rows.length?`Showing ${(page-1)*MATCH_PAGE_SIZE+1}–${(page-1)*MATCH_PAGE_SIZE+rows.length}`:'0 matches'} · Page {page}</span><div>{page>1&&<Link className="ui-btn" href={pageUrl(page-1)}>Previous</Link>}{hasNext&&<Link className="ui-btn" data-variant="primary" href={pageUrl(page+1)}>Next</Link>}</div></nav>}</main>
}

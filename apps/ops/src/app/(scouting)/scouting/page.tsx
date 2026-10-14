import Link from 'next/link'
import {auth} from '@/lib/auth'
import {canViewReports} from '@/lib/scouting-permissions'
import {redirect} from 'next/navigation'
import {pgPool} from '@/lib/db'
import MatchCard from './MatchCard'
import FavouritePlayers from './FavouritePlayers'
import WatchlistFilter from './WatchlistFilter'
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
 const {q,status,kind,scouter,date,scouting,page,league,mine,player,watchlist,watched}=filters
 let rows:any[]=[];let failed=false;let hasNext=false
 try{({rows,hasNext}=await loadMatchCatalog(pgPool(),filters,user??{}))}catch{failed=true}
 const circuit=league==='premier'||['major','p1','p2','finals'].includes(league)?'premier':league==='fip'||league.startsWith('fip_')?'fip':''
 const activeFilters=[['q',q?'Search: '+q:''],['league',LEAGUE_GROUPS.flatMap(g=>g.options.map(([v,l])=>[v,g.label+' · '+l])).find(([v])=>v===league)?.[1]??''],['date',date],['status',status],['kind',kind],['scouter',scouter?'Scouter: '+scouter:'']].filter(([,value])=>value)
 const extraCount=[date,status,kind,scouter].filter(Boolean).length
 const pageUrl=(n:number)=>catalogUrl(filters,{page:n})
 return <main className={styles.page}>
 <header className={styles.heading}><div><div className={styles.eyebrow}>YOUR MATCH LIBRARY</div><h1>Matches<span className={styles.titleDot} aria-hidden="true"/></h1><p>Every match, with scouting insights when available.</p></div><Link className="ui-btn" data-variant="ghost" href="/scouting/methodology">Methodology</Link></header>
 <FavouritePlayers userId={user?.id??''} selected={player}/>
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
 <input type="hidden" name="watchlist" value={watchlist}/><input type="hidden" name="watched" value={watched}/>
 <input type="hidden" name="mine" value={mine}/><input type="hidden" name="player" value={player}/>
 <input type="hidden" name="scouting" value={scouting}/>
 </CatalogSearchForm>
 {activeFilters.length>0&&<div className={styles.activeFilters} aria-label="Active filters"><span className={styles.filterGroupLabel}>Applied filters</span>{activeFilters.map(([key,label])=><Link key={key} className="ui-btn" data-size="sm" data-variant="ghost" aria-label={`Remove ${label} filter`} href={catalogUrl(filters,{[key]:'',page:1})}>{label}<span aria-hidden="true">×</span></Link>)}<Link className="ui-btn" data-variant="ghost" data-size="sm" href={catalogUrl(filters,{q:'',league:'',date:'',status:'',kind:'',scouter:'',page:1})}>Clear filters</Link></div>}
 </section>
 <div className={styles.listToolbar}><div className={styles.filterGroup}><span className={styles.filterGroupLabel} id="scouting-status-label">Scouting status</span><nav className={styles.scoutFilters} aria-labelledby="scouting-status-label">{[['','All matches'],['scouted','With scouting'],['unscouted','Without scouting'],['pending','Scouting in progress']].map(([value,label])=><Link key={value} className="ui-btn" data-variant={scouting===value?'primary':'ghost'} aria-current={scouting===value?'page':undefined} href={catalogUrl(filters,{scouting:value,page:1})}>{label}</Link>)}</nav></div><div className={styles.personalFilterGroup}><span className={styles.filterGroupLabel} id="personal-filter-label">Your matches</span><div className={styles.scoutFilters} role="group" aria-labelledby="personal-filter-label"><WatchlistFilter userId={user?.id??''} filters={filters}/><Link className="ui-btn" data-variant={mine?'primary':'ghost'} aria-current={mine?'page':undefined} href={catalogUrl(filters,{mine:mine?'':'1',page:1})}>My scouts</Link></div></div><span className={styles.sortNote}>{(player||watchlist)?'Latest 10 · Live, upcoming, then completed':`Newest match date first · ${MATCH_PAGE_SIZE} per page`}</span></div>
 <div className={styles.grid}>
 {failed?<p role="alert">Could not load matches. Please retry; your scouting data remains saved.</p>:!rows.length?<p className="ui-panel">{watchlist&&!watched?'Your watchlist is empty. Add players in the Watchlist section above.':'No matches match these filters.'} <Link href="/scouting">Reset filters</Link></p>:rows.map(r=><MatchCard key={r.kind+r.match_id} row={r} user={user}/>)}</div>
 {!failed&&!player&&!watchlist&&<nav className={styles.pagination} aria-label="Match pages"><span>{rows.length?`Showing ${(page-1)*MATCH_PAGE_SIZE+1}–${(page-1)*MATCH_PAGE_SIZE+rows.length}`:'0 matches'} · Page {page}</span><div>{page>1&&<Link className="ui-btn" href={pageUrl(page-1)}>Previous</Link>}{hasNext&&<Link className="ui-btn" data-variant="primary" href={pageUrl(page+1)}>Next</Link>}</div></nav>}</main>
}

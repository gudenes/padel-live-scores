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

 const activeFilters=[['q',q?'Search: '+q:''],['league',LEAGUE_GROUPS.flatMap(g=>g.options.map(([v,l])=>[v,g.label+' · '+l])).find(([v])=>v===league)?.[1]??''],['date',date],['status',status],['kind',kind],['scouter',scouter?'Scouter: '+scouter:''],['scouting',({'scouted':'With scouting','unscouted':'Without scouting','pending':'In progress'} as Record<string,string>)[scouting]??'']].filter(([,value])=>value)
 const extraCount=[date,status,kind,scouter].filter(Boolean).length
 const pageUrl=(n:number)=>catalogUrl(filters,{page:n})
 return <main className={styles.page}><div className={styles.libraryLayout}>
 <aside className={styles.libraryRail} aria-label="Your library"><div className={styles.eyebrow}>YOUR LIBRARY</div>
 <nav className={styles.libraryViews} aria-label="Match views">
 <Link className="ui-btn" data-variant={!mine&&!watchlist&&!player?'primary':'ghost'} aria-current={!mine&&!watchlist&&!player?'page':undefined} href={catalogUrl(filters,{mine:'',watchlist:'',watched:'',player:'',page:1})}>All matches</Link>
 <Link className="ui-btn" data-variant={mine?'primary':'ghost'} aria-current={mine?'page':undefined} href={catalogUrl(filters,{mine:'1',watchlist:'',watched:'',player:'',page:1})}>My scouts</Link>
 <WatchlistFilter userId={user?.id??''} filters={filters}/>
 </nav><FavouritePlayers userId={user?.id??''} selected={player} profiles={Object.fromEntries(rows.flatMap(r=>(r.players??[]).filter((p:any)=>p.id&&p.avatar_url).map((p:any)=>[p.id,p.avatar_url])))}/></aside>
 <div className={styles.libraryContent}>
 <header className={styles.heading}><div><div className={styles.eyebrow}>YOUR MATCH LIBRARY</div><h1>Matches<span className={styles.titleDot} aria-hidden="true"/></h1><p>Every match, with scouting insights when available.</p></div><Link className="ui-btn" data-variant="ghost" href="/scouting/methodology">Methodology</Link></header>
 <section className={styles.filterPanel} aria-label="Match filters">
 <CatalogSearchForm className={styles.refinedFilters} initialSearch={q}>
 <div className={styles.filterMain}>
 <label className={styles.heroSearch}><span>Find a match</span><div><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg><input className="ui-input" name="q" placeholder="Search a player or tournament…" defaultValue={q}/></div></label>
 <div className={styles.tierField}><FilterSelect name="scouting" label="Scouting status" value={scouting} options={[{value:'',label:'All scouting statuses'},{value:'scouted',label:'With scouting'},{value:'unscouted',label:'Without scouting'},{value:'pending',label:'In progress'}]}/></div>
 <div className={styles.tierField}><FilterSelect name="league" label="Tournament tier" value={league} options={[{value:'',label:'All circuits & tiers'},...LEAGUE_GROUPS.flatMap(g=>g.options.map(([value,label])=>({value,label,group:g.label})))]}/></div>
 <button className="ui-btn" data-variant="primary">Search</button>
 </div>
 <div className={styles.filterSecondary}> <details className={styles.moreFilters}><summary>More filters {extraCount>0&&<span>{extraCount}</span>}<span aria-hidden="true">⌄</span></summary>
 <div className={styles.extraFields}>
 <FilterDate key={date} value={date}/>
 <FilterSelect name="status" label="Status" value={status} options={[['','All statuses'],['finished','Finished'],['live','Live'],['scheduled','Scheduled'],['walkover','Walkover'],['retired','Retired']].map(([value,label])=>({value,label}))}/>
 <FilterSelect name="kind" label="Match type" value={kind} options={[['','All matches'],['match','Tournament'],['private','Private']].map(([value,label])=>({value,label}))}/>
 <label>Scouter<input key={scouter} className="ui-input" name="scouter" placeholder="Scouter email" defaultValue={scouter}/></label>
 </div></details></div>
 <input type="hidden" name="watchlist" value={watchlist}/><input type="hidden" name="watched" value={watched}/>
 <input type="hidden" name="mine" value={mine}/><input type="hidden" name="player" value={player}/>

 </CatalogSearchForm>
 {activeFilters.length>0&&<div className={styles.activeFilters} aria-label="Active filters"><span className={styles.filterGroupLabel}>Applied filters</span>{activeFilters.map(([key,label])=><Link key={key} className="ui-btn" data-size="sm" data-variant="ghost" aria-label={`Remove ${label} filter`} href={catalogUrl(filters,{[key]:'',page:1})}>{label}<span aria-hidden="true">×</span></Link>)}<Link className="ui-btn" data-variant="ghost" data-size="sm" href={catalogUrl(filters,{q:'',league:'',date:'',status:'',kind:'',scouter:'',scouting:'',page:1})}>Clear filters</Link></div>}
 </section>
 <div className={styles.resultsHeading}><div><h2>{watchlist?'Your watchlist':mine?'My scouts':player?'Player matches':'All matches'}</h2><span className={styles.sortNote}>{(player||watchlist)?`${rows.length} matches · Live, upcoming, then recent`:`Newest match date first · ${MATCH_PAGE_SIZE} per page`}</span></div></div>
 <div className={styles.grid}>
 {failed?<p role="alert">Could not load matches. Please retry; your scouting data remains saved.</p>:!rows.length?<p className="ui-panel">{watchlist&&!watched?'Your watchlist is empty. Add players in the Manage players in the sidebar.':'No matches match these filters.'} <Link href="/scouting">Reset filters</Link></p>:rows.map(r=><MatchCard key={r.kind+r.match_id} row={r} user={user}/>)}</div>
 {!failed&&!player&&!watchlist&&<nav className={styles.pagination} aria-label="Match pages"><span>{rows.length?`Showing ${(page-1)*MATCH_PAGE_SIZE+1}–${(page-1)*MATCH_PAGE_SIZE+rows.length}`:'0 matches'} · Page {page}</span><div>{page>1&&<Link className="ui-btn" href={pageUrl(page-1)}>Previous</Link>}{hasNext&&<Link className="ui-btn" data-variant="primary" href={pageUrl(page+1)}>Next</Link>}</div></nav>}</div></div></main>
}

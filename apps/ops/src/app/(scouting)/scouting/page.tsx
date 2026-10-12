import Link from 'next/link'
import {auth} from '@/lib/auth'
import {canViewReports} from '@/lib/scouting-permissions'
import {redirect} from 'next/navigation'
import {pgPool} from '@/lib/db'
import MatchCard from './MatchCard'
import CatalogSearchForm from './CatalogSearchForm'
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
 <CatalogSearchForm className={styles.filters}>
 <label className={styles.search}>Players or tournament<input className="ui-input" name="q" placeholder="Search players or tournaments…" defaultValue={q}/></label>
 <label>Match date<input className="ui-input" type="date" name="date" defaultValue={date}/></label>
 <label>Status<select className="ui-input" name="status" defaultValue={status}><option value="">All statuses</option><option value="finished">Finished</option><option value="live">Live</option><option value="scheduled">Scheduled</option><option value="walkover">Walkover</option><option value="retired">Retired</option></select></label>
 <label>Type<select className="ui-input" name="kind" defaultValue={kind}><option value="">All matches</option><option value="match">Tournament</option><option value="private">Private</option></select></label>
 <label>Scouter<input className="ui-input" name="scouter" placeholder="Scouter email" defaultValue={scouter}/></label>
 <input type="hidden" name="scouting" value={scouting}/><button className="ui-btn" data-variant="primary">Search</button></CatalogSearchForm>
 <div className={styles.listToolbar}><nav className={styles.scoutFilters} aria-label="Scouting filter">{[['','All matches'],['scouted','With scouting'],['unscouted','Without scouting']].map(([value,label])=><Link key={value} className="ui-btn" data-variant={scouting===value?'primary':'ghost'} aria-current={scouting===value?'page':undefined} href={catalogUrl(filters,{scouting:value,page:1})}>{label}</Link>)}</nav><span className={styles.sortNote}>Newest match date first · {MATCH_PAGE_SIZE} per page</span></div>
 <div className={styles.grid}>
 {failed?<p role="alert">Could not load matches. Please retry; your scouting data remains saved.</p>:!rows.length?<p className="ui-panel">No matches match these filters. <Link href="/scouting">Reset filters</Link></p>:rows.map(r=><MatchCard key={r.kind+r.match_id} row={r} user={user}/>)}</div>
 {!failed&&<nav className={styles.pagination} aria-label="Match pages"><span>{rows.length?`Showing ${(page-1)*MATCH_PAGE_SIZE+1}–${(page-1)*MATCH_PAGE_SIZE+rows.length}`:'0 matches'} · Page {page}</span><div>{page>1&&<Link className="ui-btn" href={pageUrl(page-1)}>Previous</Link>}{hasNext&&<Link className="ui-btn" data-variant="primary" href={pageUrl(page+1)}>Next</Link>}</div></nav>}</main>
}

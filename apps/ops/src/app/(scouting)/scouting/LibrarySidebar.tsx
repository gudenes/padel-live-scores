import type {ReactNode} from 'react'
import Link from 'next/link'
import {catalogUrl,type CatalogFilters} from '@/lib/scouting/match-catalog'
import WatchlistFilter from './WatchlistFilter'
import RecentMatches from './RecentMatches'
import FavouritePlayers from './FavouritePlayers'
import styles from './library.module.css'

export default function LibrarySidebar({userId,filters,profiles={},closeControl}:{userId:string;filters?:CatalogFilters;profiles?:Record<string,string>;closeControl?:ReactNode}){
 const all=!!filters&&!filters.mine&&!filters.watchlist&&!filters.player
 return <>
 <div className={styles.libraryTitle}><div className={styles.eyebrow}>YOUR LIBRARY</div>{closeControl}</div>
 <nav className={styles.libraryViews} aria-label="Match views">
 <Link className="ui-btn" data-variant={all?'primary':'ghost'} aria-current={all?'page':undefined} href={filters?catalogUrl(filters,{mine:'',watchlist:'',watched:'',player:'',page:1}):'/scouting?view=all'}>All matches</Link>
 <Link className="ui-btn" data-variant={filters?.mine?'primary':'ghost'} aria-current={filters?.mine?'page':undefined} href={filters?catalogUrl(filters,{mine:'1',watchlist:'',watched:'',player:'',page:1}):'/scouting?mine=1'}>My scouts</Link>
 {filters?<WatchlistFilter userId={userId} filters={filters}/>:<Link className="ui-btn" data-variant="ghost" href="/scouting?watchlist=1">My Watchlist</Link>}
 </nav>
 <RecentMatches userId={userId}/>
 <FavouritePlayers userId={userId} selected={filters?.player??''} profiles={profiles}/>
 </>
}

import Link from 'next/link'
import {catalogUrl,type CatalogFilters} from '@/lib/scouting/match-catalog'
import WatchlistFilter from './WatchlistFilter'
import RecentMatches from './RecentMatches'
import styles from './library.module.css'
export default function MatchBrowseBar({userId,filters}:{userId:string;filters:CatalogFilters}){
 const all=!filters.mine&&!filters.watchlist&&!filters.player
 return <div className={styles.browseBar}>
 <nav aria-label="Match views" className={styles.browseViews}>
 <Link className="ui-btn" data-variant={all?'primary':'ghost'} aria-current={all?'page':undefined} href={catalogUrl(filters,{mine:'',watchlist:'',watched:'',player:'',page:1})}>All matches</Link>
 <Link className="ui-btn" data-variant={filters.mine?'primary':'ghost'} aria-current={filters.mine?'page':undefined} href={catalogUrl(filters,{mine:'1',watchlist:'',watched:'',player:'',page:1})}>My scouts</Link>
 <WatchlistFilter userId={userId} filters={filters}/>
 </nav>
 <div className={styles.browseUtilities}><Link className="ui-btn" data-variant="ghost" href="/scouting/players?view=pairs">Explore pairs ↗</Link><Link className="ui-btn" data-variant="ghost" href="/scouting/players?filter=watch">Followed players ↗</Link><details className={styles.recentMenu}><summary className="ui-btn" data-variant="ghost">Recently viewed ⌄</summary><div><RecentMatches userId={userId}/></div></details></div>
 </div>
}

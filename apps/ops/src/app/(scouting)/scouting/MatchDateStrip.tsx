import Link from 'next/link'
import {catalogDays} from '@/lib/scouting/catalog-days'
import {catalogUrl,type CatalogFilters} from '@/lib/scouting/match-catalog'
import styles from './library.module.css'
export default function MatchDateStrip({today,filters}:{today:string;filters:CatalogFilters}){
 const days=catalogDays(today),month=new Date(today+'T12:00:00Z').toLocaleDateString('en-GB',{month:'long',year:'numeric',timeZone:'UTC'})
 return <nav className={styles.dateStrip} aria-label="Quick match dates"><strong className={styles.dateMonth}>{month}</strong><div className={styles.dateDays}>{days.map(d=><Link key={d.date} scroll={false} prefetch={false} href={catalogUrl(filters,{date:d.date,page:1})} className={'ui-btn '+styles.dateTile} data-variant={filters.date===d.date?'primary':'default'} aria-current={filters.date===d.date?'date':undefined} aria-label={`${d.label?d.label+', ':''}${d.weekday} ${d.date}`}><span>{d.weekday}</span><strong>{d.day}</strong><small>{d.label||'\u00a0'}</small></Link>)}</div><Link scroll={false} prefetch={false} href={catalogUrl(filters,{date:'',page:1})} className={'ui-btn '+styles.allDates} data-variant={filters.date?'default':'primary'} aria-current={!filters.date?'true':undefined}>All dates</Link></nav>
}

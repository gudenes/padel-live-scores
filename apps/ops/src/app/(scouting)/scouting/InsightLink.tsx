'use client'
import Link,{useLinkStatus} from 'next/link'
import styles from './library.module.css'
import NavigationProgress from './NavigationProgress'
function Label(){const {pending}=useLinkStatus();return <span className={styles.linkLabel} aria-live="polite">{pending?'Opening…':'Open insights'}</span>}
export default function InsightLink({href,secondary=false}:{href:string;secondary?:boolean}){return <Link prefetch={false} className="ui-btn" data-variant={secondary?undefined:"primary"} href={href}><Label/><NavigationProgress/></Link>}

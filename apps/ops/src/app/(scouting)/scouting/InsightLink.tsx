'use client'
import Link,{useLinkStatus} from 'next/link'
import styles from './library.module.css'
function Label(){const {pending}=useLinkStatus();return <span className={styles.linkLabel} aria-live="polite">{pending?'Opening…':'Open insights'}</span>}
export default function InsightLink({href}:{href:string}){return <Link className="ui-btn" href={href}><Label/></Link>}

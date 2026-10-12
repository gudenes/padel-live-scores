import styles from './transitions.module.css'
export default function Loading(){return <div className={styles.loading} role="status" aria-live="polite"><p>Loading match data…</p><div className={styles.grid} aria-hidden="true">{[0,1,2,3,4,5].map(i=><div key={i} className={styles.card}><div className={styles.line}/><div className={styles.line}/><div className={styles.line}/></div>)}</div></div>}

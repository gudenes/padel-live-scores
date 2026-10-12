import styles from './transitions.module.css'
export default function Template({children}:{children:React.ReactNode}){return <div className={styles.enter}>{children}</div>}

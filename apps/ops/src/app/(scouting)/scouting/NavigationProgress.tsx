'use client'
import {createPortal} from 'react-dom'
import {useLinkStatus} from 'next/link'
import styles from './transitions.module.css'
export default function NavigationProgress(){
 const {pending}=useLinkStatus()
 return pending?createPortal(<span className={styles.progress} role="status" aria-label="Opening page"><span/></span>,document.body):null
}

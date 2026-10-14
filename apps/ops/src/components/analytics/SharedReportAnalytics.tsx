'use client'
import {useEffect,useState,useRef,useId} from 'react'
import styles from './SharedReportAnalytics.module.css'
import {analyticsChoice,chooseAnalytics,sharedReportEvent} from '@/lib/posthog/shared-report'
export default function SharedReportAnalytics({stage}:{stage:'gate'|'report'}){
 const dialog=useRef<HTMLDialogElement>(null),titleId=useId()
 const [choice,setChoice]=useState<boolean|null>(false)
 useEffect(()=>{setChoice(analyticsChoice());sharedReportEvent(stage==='gate'?'shared_report_gate_viewed':'shared_report_viewed')},[stage])
 useEffect(()=>{if(choice===null&&!dialog.current?.open)dialog.current?.showModal();else if(choice!==null)dialog.current?.close()},[choice])
 function decide(value:boolean){chooseAnalytics(value);setChoice(value);if(value)sharedReportEvent(stage==='gate'?'shared_report_gate_viewed':'shared_report_viewed')}
 return <aside aria-label="Analytics preferences">
 <button className="ui-btn" data-variant="ghost" onClick={()=>setChoice(null)}>Analytics preferences</button>
 <dialog ref={dialog} className={styles.modal} aria-labelledby={titleId} onCancel={e=>{e.preventDefault();decide(false)}}>
  <span className={styles.icon} aria-hidden="true">▥</span>
  <h2 id={titleId}>Help us improve your match review.</h2>
  <p>Allow anonymous usage analytics to help us understand which report features are useful and improve your experience.</p>
  <p className={styles.note}>This is optional. You can view the report either way. Email verification and the report access log are separate.</p>
  <div className={styles.actions}><button className="ui-btn" onClick={()=>decide(false)}>Decline</button><button className="ui-btn" data-variant="primary" onClick={()=>decide(true)}>Allow analytics</button></div>
  <small>You can change your choice in Analytics preferences.</small>
 </dialog>
 </aside>
}

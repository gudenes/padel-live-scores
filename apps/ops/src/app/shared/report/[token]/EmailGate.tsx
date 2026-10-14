'use client'
import SharedReportAnalytics from '@/components/analytics/SharedReportAnalytics'
import {sharedReportEvent} from '@/lib/posthog/shared-report'
import {useState} from 'react'
import {useRouter} from 'next/navigation'
import styles from './email-gate.module.css'
export default function EmailGate({token}:{token:string}){
 const router=useRouter(),[email,setEmail]=useState(''),[code,setCode]=useState(''),[challenge,setChallenge]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('')
 async function submit(action:'request'|'verify'){
  setBusy(true);setMessage('');try{const r=await fetch(`/api/shared/report/${token}/verify`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(action==='request'?{action,email}:{action,challengeId:challenge,code})}),data=await r.json();if(!r.ok)throw Error(data.error);if(action==='request'){sharedReportEvent('shared_report_code_sent');setChallenge(data.challengeId);setCode('');setMessage('Code sent. Check your inbox and spam folder.')}else {sharedReportEvent('shared_report_email_verified');router.refresh()}}catch(e){sharedReportEvent('shared_report_verification_failed',{step:action});setMessage(e instanceof Error?e.message:'Please try again.')}finally{setBusy(false)}
 }

 return <main className={styles.page}>
  <header className={styles.brand}><img className={styles.nachosLogo} src="/scout-web/assets/padelnachos-logo.png" alt="Padel Nachos"/><span className={styles.brandDivider} aria-hidden="true"/><img src="/brand/padellabs.png" alt="Padel Labs"/><span className={styles.brandNote}>MATCH ANALYSIS</span></header>
  <div className={styles.layout}>
   <section className={styles.hero}>
    <p className={styles.eyebrow}>Match insights. Coaching perspective.</p>
    <h1>See the moment.<br/>Understand <em>the match.</em></h1>
    <p className={styles.intro}>Find the turning points, see each player’s impact, and replay key rallies when video is connected. Turn match data into a clearer coaching conversation.</p>
    <div className={styles.reportScene} aria-hidden="true">
     <div className={styles.reportSheet}>
      <div className={styles.paperBrand}><img src="/brand/padellabs.png" alt=""/><span>MATCH REPORT · SAMPLE</span></div>
      <div className={styles.paperTitle}><span>PERFORMANCE ANALYSIS</span><h3>The story behind<br/>the score.</h3></div>
      <div className={styles.paperScore}><span><i/> TEAM A</span><strong>6–4 &nbsp; 3–6 &nbsp; 6–2</strong><span>TEAM B <i/></span></div>
      <div className={styles.paperChart}><b>Match momentum</b><div className={styles.paperBars}>{[38,62,46,25,54,70,32,51,65,42,59,76,44,62,36,55,74,48].map((height,i)=><div key={i}><span style={{height:height/2}}/><i style={{height:(80-height)/2+6}}/></div>)}</div><div className={styles.paperSets}><span>SET 1</span><span>SET 2</span><span>SET 3</span></div></div>
      <div className={styles.paperStats}><div><b>Team comparison</b>{['Winners','Forced errors created','Unforced errors'].map((label,i)=><div className={styles.paperMetric} key={label}><span>{label}</span><div><i style={{width:(65-i*12)+'%'}}/><em/></div></div>)}</div><div><b>Player impact</b><svg viewBox="0 0 160 86"><path d="M0 25H160M0 50H160M0 75H160" stroke="#edf0e6"/><path d="M0 70 20 55 40 60 60 36 80 42 100 20 120 27 140 12 160 5" stroke="#9cca21" strokeWidth="3" fill="none"/><path d="M0 75 20 67 40 71 60 52 80 61 100 43 120 50 140 32 160 38" stroke="#ff8178" strokeWidth="3" fill="none"/></svg></div></div>
      <div className={styles.paperVideo}>
       <div className={styles.paperVideoFrame}><img src="/scouting/court-empty.webp" alt=""/><span>▶</span><small>VIDEO REVIEW</small></div>
       <div><b>From insight to replay.</b><p>Review key points, winners and long rallies in context.</p><div className={styles.videoChips}><span>Key points</span><span>Winners</span><span>10+ shots</span></div></div>
      </div>
      <div className={styles.paperFooter}><span>PADEL NACHOS × PADEL LABS</span><span>01 / 04</span></div>
     </div>
     <div className={styles.reportTag}><span>↗</span> A closer look at every point</div>
    </div>
    <p className={styles.previewNote}>Illustrative preview · Your report opens after verification</p>
   </section>
   <section className={styles.access} aria-labelledby="access-title">
    <div className={styles.step}><span className={!challenge?styles.active:''}>01 · Email</span><span className={challenge?styles.active:''}>02 · Open report</span></div>
    <div className={styles.lock} aria-hidden="true"><svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></svg></div>
    <p className={styles.eyebrow}>Your courtside invitation</p>
    <h2 id="access-title">{challenge?'Check your inbox.':'Your match. Unlocked.'}</h2>
    <p className={styles.description}>{challenge?'Enter the six-digit code we sent to your email to open the analysis.':'A match report has been shared with you. Verify your email to take a closer look.'}</p>
    <form onSubmit={e=>{e.preventDefault();submit(challenge?'verify':'request')}}>
     <label>Email address<input type="email" autoComplete="email" placeholder="you@example.com" required maxLength={254} value={email} disabled={busy||!!challenge} onChange={e=>setEmail(e.target.value)}/></label>
     {challenge&&<label>Verification code<input className={styles.code} autoFocus inputMode="numeric" autoComplete="one-time-code" placeholder="000000" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={e=>setCode(e.target.value)}/></label>}
     <button className="ui-btn" data-variant="primary" disabled={busy}>{busy?'Please wait…':challenge?'Verify & open report':'Email me a code'}<span aria-hidden="true">↗</span></button>
    </form>
    {challenge&&<div className={styles.secondary}><button className="ui-btn" data-variant="ghost" disabled={busy} onClick={()=>submit('request')}>Resend code</button><button className="ui-btn" data-variant="ghost" disabled={busy} onClick={()=>{setChallenge('');setMessage('');setCode('')}}>Change email</button></div>}
    {message&&<p className={styles.message} role="status">{message}</p>}
    <p className={styles.accessNote}>No password needed. Access to this report only.</p>
    <div className={styles.privacy}><p>Your verified email and report visits are visible to the report administrator.</p><small>Code valid for 10 minutes · Verified access lasts 24 hours.</small></div>
   </section>
  </div>
  <SharedReportAnalytics stage="gate"/>
  <footer className={styles.footer}>PADEL LABS <span>See the game. Understand the details.</span></footer>
 </main>
}

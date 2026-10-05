'use client'
import Image from 'next/image'
import {useEffect,useState} from 'react'
import {useLocale,useTranslations} from 'next-intl'
import {useSearchParams} from 'next/navigation'
import {Link,useRouter} from '@/i18n/navigation'
import {useAuth} from '@/components/AuthProvider'
import LoginSheet from '@/components/LoginSheet'
import {Press} from '@/app/[locale]/(app)/play/_components/shared'
import {ArrowLeftIcon} from '@/components/icons'
import {Capacitor} from '@capacitor/core'
import {Share} from '@capacitor/share'
import styles from './InviteExperience.module.css'

export default function InviteExperience({mode,preview=false,drawer=false,onClose}:{mode:'share'|'receive';preview?:boolean;drawer?:boolean;onClose?:()=>void}) {
 const retryText=useTranslations('play.error')
 const t=useTranslations('play.invite'),locale=useLocale(),params=useSearchParams(),router=useRouter()
 const {user,loading}=useAuth()
 const receive=mode==='receive'||(preview&&params.get('received')==='1')
 const token=params.get('invite')??''
 const [attempt,setAttempt]=useState(0)
 const [url,setUrl]=useState(''),[status,setStatus]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[valid,setValid]=useState(false)
 useEffect(()=>{
  let active=true
  setError('');setStatus('');setUrl('');setValid(false)
  if(preview){setValid(true);setUrl(`${window.location.origin}/${locale}/invite-review?received=1`);return}
  const endpoint=receive?'check':''
  fetch(`/api/play/invites${endpoint?`/${endpoint}`:''}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})})
   .then(async r=>{if(!r.ok)throw Error(receive&&r.status===410?'invalid':'unavailable');return r.json()})
   .then(data=>{if(!active)return;setValid(true);if(!receive)setUrl(`${window.location.origin}/${locale}/join-play?invite=${encodeURIComponent(data.token)}`)})
   .catch(e=>{if(active)setError(e.message==='invalid'?'invalid':'unavailable')})
  return()=>{active=false}
 },[receive,token,locale,preview,attempt])
 async function copy(){setError('');setStatus('');try{await navigator.clipboard.writeText(url);setStatus('copied')}catch{setError('copyError')}}
 async function share(){
  if(!url)return
  setError('');setStatus('')
  try{
   if(Capacitor.isNativePlatform())await Share.share({title:'Padel Predict',text:t('shareText'),url})
   else if(navigator.share)await navigator.share({title:'Padel Predict',text:t('shareText'),url})
   else await copy()
  }catch(e){if(!(e instanceof Error&&e.name==='AbortError'))setError('shareError')}
 }
 async function accept(){
  setBusy(true);setError('')
  if(preview){router.push('/onboarding-review');return}
  try{
   const r=await fetch('/api/play/invites/accept',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})})
   if(!r.ok){if(r.status===410)setValid(false);throw Error(r.status===410?'invalid':'unavailable')}
   window.location.assign(`/${locale}/play`)
  }catch(e){setError(e instanceof Error&&e.message==='invalid'?'invalid':'unavailable');setBusy(false)}
 }
 return <main className={styles.screen} data-sign-in={receive && (!user || preview)} data-drawer={drawer}>
  <header className={styles.header}><Image src="/padelnachos-logo-v2.png" width={94} height={50} alt="Padel Nachos"/>{onClose?<Press size="size-sm" intent="intent-ghost" onClick={onClose}>{t('dismiss')}</Press>:<Link href={receive?'/matches':'/play?view=leaders'} aria-label={t('close')} className={`${styles.close} pn-press shape-chunky-tilted intent-neutral size-sm`}><span className="pn-press-skirt" aria-hidden="true"/><span className="pn-press-face"><ArrowLeftIcon size={18}/></span></Link>}</header>
  <div className={styles.intro}><h1>{t(receive?'receiveTitle':'title')}</h1><p>{t(receive?'receiveBody':'body')}</p></div>
  <div className={styles.hero}><Image src="/play/invite/friends-hero-v1.webp" alt={t('artAlt')} width={1448} height={1086} priority sizes="(max-width: 600px) 100vw, 460px"/></div>
  <div className={styles.actions}>
   <p className={styles.eyebrow}>{t('label')}</p>
   {error&&<p className={styles.error} role="alert">{t(error)}</p>}
   {error==='unavailable'&&<Press intent="intent-ghost" onClick={()=>setAttempt(n=>n+1)}>{retryText('retry')}</Press>}
   {error==='invalid'&&<Press intent="intent-ghost" onClick={()=>router.push('/matches')}>{t('close')}</Press>}
   {!receive&&!url&&!error&&<p role="status" className={styles.note}>{t('loading')}</p>}
   {!receive?<>
    <Press block disabled={!url} onClick={()=>void share()}>{t('share')}</Press>
    <Press block intent="intent-ghost" disabled={!url} onClick={()=>void copy()}>{t('copy')}</Press>
    {error==='copyError'&&<input readOnly value={url} aria-label={t('copy')} onFocus={e=>e.target.select()}/>}
    <p className={styles.note} role="status">{status?t(status):t('note')}</p>
   </>:valid?<>
    {loading&&!preview?<p role="status">{t('loading')}</p>:user&&!preview?<Press block disabled={busy} onClick={()=>void accept()}>{t(busy?'loading':'join')}</Press>:<LoginSheet embedded open callbackUrl={preview?`/${locale}/onboarding-review`:`/${locale}/join-play?invite=${encodeURIComponent(token)}`} onClose={()=>{}}/>}
    <p className={styles.note}>{t('next')}</p>
   </>:!error?<p role="status">{t('loading')}</p>:null}
   {preview&&<div className={styles.preview}><small>{t('preview')}</small><Link href={receive?'/invite-review':'/invite-review?received=1'}>{t(receive?'backPreview':'seeFriend')}</Link></div>}
  </div>
 </main>
}

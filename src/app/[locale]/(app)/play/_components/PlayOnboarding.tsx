'use client'
import SpotlightGuide from '@/components/SpotlightGuide'
import {Link} from '@/i18n/navigation'
import {useEffect,useState} from 'react'
import {useLocale,useTranslations} from 'next-intl'
import PressButton,{PRESS_PRESETS} from '@/components/PressButton'
import GuacaCoin from '@/components/GuacaCoin'
import {Figure} from '@/components/player/shop/WardrobeFigure'
import {SHOP_AVATARS,parseShopState,type ShopAvatar} from '@/lib/avatar-shop'
import {validPublicName,type OnboardingStep} from '@/lib/play-onboarding'
import styles from './PlayOnboarding.module.css'
export type Progress = {step:OnboardingStep;name:string;avatar:ShopAvatar}
export function Face({avatar,portrait=true}:{avatar:ShopAvatar;portrait?:boolean}) {return <Figure state={{avatar,equipped:{},balance:0,owned:[]}} preview={null} original portrait={portrait}/>}
export function IdentitySetup({initial,onSave,preview=false}:{initial:Progress;onSave:(name:string,avatar:ShopAvatar)=>Promise<void>;preview?:boolean}) {
 const t=useTranslations('play.onboarding')
 const [name,setName]=useState(initial.name.includes('@')?'':initial.name)
 const [avatar,setAvatar]=useState<ShopAvatar>(SHOP_AVATARS.some(a=>a.id===initial.avatar)?initial.avatar:'face-06')
 const [busy,setBusy]=useState(false),[error,setError]=useState(false)
 async function submit(e:React.FormEvent){e.preventDefault();if(busy||!validPublicName(name))return;setBusy(true);setError(false);try{await onSave(name.trim(),avatar)}catch{setError(true)}finally{setBusy(false)}}
 return <form data-play-onboarding-screen className={styles.identity} onSubmit={submit}>
 {preview&&<div className={styles.previewBar}><span>{t('preview')}</span><Link href="/play?onboarding=login">{t('showLogin')}</Link></div>}
 <div className={styles.eyebrow}>PADEL PREDICT · 01</div>
 <h1>{t('identityTitle')}</h1><p>{t('identityBody')}</p>
 <div className={styles.portrait}><Face avatar={avatar}/></div>
 <label htmlFor="play-public-name">{t('publicName')}</label>
 <input autoComplete="nickname" id="play-public-name" value={name} onChange={e=>setName(e.target.value)} minLength={2} maxLength={24} required aria-describedby="play-name-help"/>
 <small id="play-name-help">{t('nameHelp')}</small>
 <div className={styles.nameSuggestions} role="group" aria-label={t('nameSuggestions')}>{['NachoNinja','SmashAmigo','GoldenBandeja'].map(suggestion=><button key={suggestion} type="button" className="pn-press shape-chunky-tilted intent-neutral size-sm" onClick={()=>setName(suggestion)} aria-pressed={name===suggestion}><span className="pn-press-skirt" aria-hidden="true"/><span className="pn-press-face">{suggestion}</span></button>)}</div>
 <div className={styles.faces} role="group" aria-label={t('chooseFace')}>{SHOP_AVATARS.map(face=><button type="button" key={face.id} aria-label={face.name} aria-pressed={avatar===face.id} onClick={()=>setAvatar(face.id)}><Face avatar={face.id}/></button>)}</div>
 {error&&<p role="alert" className={styles.error}>{t('saveError')}</p>}
 <PressButton {...PRESS_PRESETS.chunkyTilted} className={styles.primary} type="submit" disabled={busy||!validPublicName(name)}>{t(busy?'saving':'start')}</PressButton>
 </form>
}
export function OnboardingGuide({step,balance,hasMarkets,trading,onAdvance,onSkip,error}:{step:OnboardingStep|'success';balance:number|null;hasMarkets:boolean;trading:boolean;onAdvance:()=>void;onSkip:()=>void;error:boolean}) {
 const t=useTranslations('play.onboarding'),locale=useLocale()
 return <SpotlightGuide step={step} active={step!=='identity'&&step!=='done'&&!trading}
 selector={step==='wallet'?'[data-onboarding-wallet]':step==='success'?'.pl-subnav button:nth-child(2)':'[data-onboarding-choice] button[data-side]:not(:disabled), [data-onboarding-choice=editorial] button:not(:disabled)'} expandChoice={step==='prediction'}
 label={t('guideLabel')} eyebrow={`PADEL PREDICT · ${step==='wallet'?'02':step==='success'?'04':'03'}`}
 title={found=><>{step==='wallet'&&<GuacaCoin size={26}/>} {t(step==='wallet'?'walletTitle':step==='success'?'successTitle':hasMarkets&&found?'predictionTitle':'emptyTitle',{balance:balance===null?'—':new Intl.NumberFormat(locale).format(balance)})}</>}
 description={found=>t(step==='wallet'?'walletBody':step==='success'?'successBody':hasMarkets&&found?'predictionBody':'emptyBody')}
 action={step==='wallet'||step==='success'?t(step==='success'?'viewPlays':'continue'):undefined}
 skipLabel={t(step==='success'?'done':'skip')} disabled={step==='wallet'&&balance===null} error={error?t('saveError'):undefined} onAdvance={onAdvance} onSkip={onSkip}/>
}
export function useOnboarding(userId:string|undefined) {
 const [progress,setProgress]=useState<Progress|null>(null),[error,setError]=useState(false),[loading,setLoading]=useState(true)
 const [preview,setPreview]=useState(false)
 const [version,setVersion]=useState(0)
 useEffect(()=>{let active=true;setProgress(null);setLoading(true);setError(false)
 const previewMode=process.env.NODE_ENV!=='production'&&new URLSearchParams(window.location.search).get('onboarding')==='preview'
 setPreview(previewMode)
 if(previewMode){setProgress({step:'identity',name:'',avatar:'face-06'});setLoading(false);return}
 if(!userId)return
 fetch('/api/play/onboarding',{cache:'no-store'}).then(async r=>{if(!r.ok)throw Error();return r.json()}).then(p=>{if(active)setProgress(p)}).catch(()=>{if(active)setError(true)}).finally(()=>{if(active)setLoading(false)})
 return()=>{active=false}
 },[userId,version])
 async function save(body:object){setError(false);if(preview)return;const r=await fetch('/api/play/onboarding',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok){setError(true);throw Error('save_failed')}}
 async function identity(name:string,avatar:ShopAvatar){await save({action:'identity',name,avatar});setProgress({step:'wallet',name,avatar});if(!preview){if(process.env.NODE_ENV!=='production'){try{const local=parseShopState(localStorage.getItem('pn:avatar-shop:preview:v1'));localStorage.setItem('pn:avatar-shop:preview:v1',JSON.stringify({...local,avatar}));window.dispatchEvent(new Event('pn-shop-preview'))}catch{}}window.dispatchEvent(new Event('pn:profile-updated'));window.dispatchEvent(new Event('pn:wardrobe-updated'))}}
 async function advance(step:OnboardingStep){await save({step});setProgress(p=>p?{...p,step}:p)}
 return {progress,loading,error,preview,identity,advance,retry:()=>setVersion(v=>v+1)}
}

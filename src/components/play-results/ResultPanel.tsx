'use client'
import {useEffect,useId,useRef} from 'react'
import {useSwipeDownToClose} from '@/hooks/useSwipeDownToClose'
import {useLocale,useTranslations} from 'next-intl'
import GuacaCoin from '@/components/GuacaCoin'
import {BellIcon,ChevronRightIcon} from '@/components/icons'
import {ShopProfileFigure} from '@/components/player/shop/AvatarShop'
import {Press,formatGuacas} from '@/app/[locale]/(app)/play/_components/shared'
import type {ResultPanelData} from '@/lib/play-result-panel'
import styles from './ResultPanel.module.css'
import badges from '@/app/[locale]/(app)/play/_components/PositionsScreen.module.css'
export default function ResultPanel({result,results,onClose,onView,preview=false}:{result:ResultPanelData;results?:ResultPanelData[];onClose:()=>void;onView:()=>void;preview?:boolean}){
 const t=useTranslations('play.resultPanel'),locale=useLocale(),id=useId(),dialog=useRef<HTMLDialogElement>(null)
 const sheet=useRef<HTMLDivElement>(null)
 const swipe=useSwipeDownToClose({onClose,scrollRef:sheet})
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const el=dialog.current;el?.showModal();return()=>{el?.close();previous?.focus()}},[])
 const batch=results&&results.length>1?results:null
 const credit=batch?.filter(r=>r.kind!=='corrected').reduce((n,r)=>n+r.paid,0)??0
 const adjustment=batch?.filter(r=>r.kind==='corrected').reduce((n,r)=>n+r.delta,0)??0
 const hasCorrections=batch?.some(r=>r.kind==='corrected')
 const win=result.kind==='won',lost=result.kind==='lost',corrected=result.kind==='corrected'
 const amount=corrected?result.delta:lost?result.cost:result.paid
 const figure=<img src="/play/avatars/a01-local/characters/face-02-champion-fitted-v6.webp" alt=""/>
 return <dialog ref={dialog} className={styles.dialog} aria-labelledby={id} onCancel={e=>{e.preventDefault();onClose()}} onClick={e=>{if(e.target===e.currentTarget)onClose()}}>
  <div ref={sheet} className={styles.sheet} data-kind={batch?'batch':result.kind} {...swipe.bind} style={swipe.style}>
   <div className={styles.handle} aria-hidden="true"/>
   <div className={styles.close}><Press size="size-sm" intent="intent-ghost" ariaLabel={t('close')} onClick={onClose}>×</Press></div>
   <p className={styles.eyebrow}>{t('eyebrow')}</p><h2 id={id}>{batch?t('batchTitle',{count:batch.length}):t(`title.${result.kind}`)}</h2>
   <div className={batch?`${styles.hero} ${styles.batchHero}`:styles.hero} aria-hidden="true">
    {preview?<div className={styles.avatar}>{figure}</div>:<ShopProfileFigure className={styles.avatar} fallback={<div className={styles.avatar}/>}/>}
    <span className={`${styles.symbol} ${badges.badge}`} data-tone={batch?'won':lost?'lost':win?'won':'refunded'}><span>{batch?batch.length:win?'✓':lost?'×':'↶'}</span></span>
    {(batch?credit>0:!lost&&(!corrected||result.delta>0))&&<div className={styles.coins}><GuacaCoin size={48}/><GuacaCoin size={70}/><GuacaCoin size={45}/></div>}
   </div>
   {batch?<><div className={styles.amount}><GuacaCoin size={44}/><div><strong>{formatGuacas(credit,locale)}</strong><span>{t('received')}</span></div></div>
    <p className={styles.breakdown}>{t('batchIncludes')}</p>
    {hasCorrections&&<p className={styles.breakdown}>{t('adjustment')}: {adjustment>0?'+':''}{formatGuacas(adjustment,locale)}</p>}
    <ul className={styles.batchList}>{batch.map(r=><li key={r.id}><span className={badges.badge} data-tone={r.kind==='lost'?'lost':r.kind==='won'?'won':'refunded'} aria-label={t(`title.${r.kind}`)}><span>{r.kind==='won'?'✓':r.kind==='lost'?'×':'↶'}</span></span><div><strong>{r.question}</strong>{r.match&&<p>{r.match}</p>}<small>{t('yourPick')} {t(`side.${r.side}`)}</small></div><div className={styles.rowAmount}><GuacaCoin size={16}/><strong>{formatGuacas(r.kind==='corrected'?r.delta:r.paid,locale)}</strong><small>{t(r.kind==='corrected'?'adjustment':r.kind==='refunded'?'returned':'received')}</small></div></li>)}</ul></>:<>
   <div className={styles.details}><small>{result.context}</small>{result.match&&<h3>{result.match}</h3>}<p>{result.question}</p><p className={styles.pick}>{t('yourPick')} <strong>{t(`side.${result.side}`)}</strong></p></div>
   <div className={styles.amount}><GuacaCoin size={44}/><div><strong>{corrected&&amount>0?'+':''}{formatGuacas(amount,locale)}</strong><span>{t(corrected?'adjustment':lost?'played':result.kind==='refunded'?'returned':'received')}</span></div></div>
   <p className={styles.breakdown}>{lost?t('noDeduction'):corrected?t('correction'):t('breakdown',{cost:formatGuacas(result.cost,locale),net:`${result.paid-result.cost>0?'+':''}${formatGuacas(result.paid-result.cost,locale)}`})}</p>
   </>}
   <Press block size="size-lg" onClick={onView}>{t(batch?'viewAll':'view')} <ChevronRightIcon size={18}/></Press>
   <p className={styles.footer}><BellIcon size={14}/>{t('saved')}</p>
  </div>
 </dialog>
}

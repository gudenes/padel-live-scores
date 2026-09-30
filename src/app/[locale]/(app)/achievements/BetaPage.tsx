"use client"
import {useState,useEffect,useRef} from 'react'
import {useTranslations} from 'next-intl'
import {useRouter} from '@/i18n/navigation'
import {useAuth} from '@/components/AuthProvider'
import {useBadgeUnread} from '@/hooks/useBadgeUnread'
import {useBadges} from '@/hooks/useBadges'
import {BadgeGrid} from '@/components/BadgeGrid'
import {BADGE_CATALOG,BADGE_CATEGORIES,LEGACY_BADGES} from '@/lib/badges'
import {useBadgeToast} from '@/components/BadgeToast'
import styles from '@/components/Badges.module.css'

export default function AchievementsPage(){
  const t=useTranslations('badgeCollection')
  const {user,loading:authLoading}=useAuth()
  const {badges,loading,evaluateAll,error}=useBadges()
  useBadgeUnread(user?.id,badges,loading,true)
  const {show}=useBadgeToast()
  const router=useRouter()
  const [filter,setFilter]=useState<string|null>(null)
  const evaluated=useRef<string|null>(null)
  useEffect(()=>{if(!authLoading&&!user)router.replace('/home')},[authLoading,user,router])
  useEffect(()=>{
    if(!user||loading||evaluated.current===user.id)return
    evaluated.current=user.id
    void evaluateAll().then(newBadges=>newBadges.forEach(b=>show(b.badge_id,b.tier as 1|2|3|4)))
  },[user,loading,evaluateAll,show])
  useEffect(()=>{if(!loading){try{localStorage.setItem('pn_seen_badge_count',String(badges.length))}catch{}}},[badges.length,loading])
  const count=BADGE_CATALOG.filter(b=>badges.some(e=>e.badge_id===b.id)).length
  const legacy=LEGACY_BADGES.some(b=>badges.some(e=>e.badge_id===b.id))
  return <main style={{maxWidth:500,margin:'0 auto',minHeight:'100dvh',background:'#1b1d17',color:'#eee7d2',paddingBottom:100}}>
    <header style={{display:'flex',alignItems:'center',padding:'12px 16px',gap:12,background:'#10110e'}}><button className={styles.filter} onClick={()=>router.push('/profile')} aria-label={t('back')}>←</button><strong>{t('title')}</strong></header>
    <section className={styles.summary}><h1>{t('collection')}</h1><p>{loading?t('loading'):t('collected',{count,total:BADGE_CATALOG.length})}</p></section>
    <div className={styles.filters}>{[{key:null,label:'all'},...BADGE_CATEGORIES.map(c=>({key:c.key,label:c.key})),...(legacy?[{key:'legacy',label:'legacy'}]:[])].map(c=><button type="button" key={c.label} className={styles.filter} aria-pressed={filter===c.key} onClick={()=>setFilter(c.key)}>{t(c.label)}</button>)}</div>
    {error && <p role="alert" className={styles.note}>{t('error')} <button className={styles.filter} onClick={()=>void evaluateAll().then(newBadges=>newBadges.forEach(b=>show(b.badge_id,b.tier as 1|2|3|4)))}>{t('retry')}</button></p>}
    <BadgeGrid earned={badges} categoryFilter={filter}/>
  </main>
}

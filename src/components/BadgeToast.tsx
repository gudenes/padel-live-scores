'use client'
// src/components/BadgeToast.tsx
//
// Celebration toast for badge unlocks. Slides in from the bottom,
// auto-dismisses after 4 seconds. Can be triggered from anywhere
// via the BadgeToastContext or via the pn-badge-unlock DOM event.

import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { BadgeIcon } from '@/components/BadgeIcon'
import { BADGE_MAP, TIER_META, type TierNumber } from '@/lib/badges'
import motion from './GameMotion.module.css'
import {useAuth} from './AuthProvider'
import {useApiResource} from '@/app/[locale]/(app)/play/_components/usePlayData'
import {BadgeToastItem as LegacyToastItem} from './legacy/BadgeToast'
const BADGE_UNLOCK_EVENT = 'pn-badge-unlock'

interface ToastData {
  badgeId: string
  tier: TierNumber
  id: number
}

interface BadgeToastContextType {
  show: (badgeId: string, tier: TierNumber) => void
}

const BadgeToastContext = createContext<BadgeToastContextType>({ show: () => {} })

export function useBadgeToast() {
  return useContext(BadgeToastContext)
}

let toastCounter = 0

interface BadgeToastItemProps {
  toast: ToastData
}

function BadgeToastItem({ toast }: BadgeToastItemProps) {
  const t = useTranslations('badgeCollection')
  const badge = BADGE_MAP[toast.badgeId]
  const tierMeta = TIER_META[toast.tier]
  if (!badge) return null

  return (
    <div
      className={`${motion.enter} ${motion.sweep}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: '#1A1A1A',
        border: `1px solid ${tierMeta.color}40`,
        clipPath: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
        padding: '10px 14px',
        boxShadow: `0 4px 20px rgba(0,0,0,0.5), 0 0 10px ${tierMeta.color}20`,
        borderRadius: 14,
        pointerEvents: 'auto',
      }}
    >
      <div
        className={motion.stamp}
      >
        <BadgeIcon svgIcon={badge.svgIcon} tier={toast.tier} size={52} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 800, color: '#fff' }}>
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={tierMeta.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>
          </svg>
          {t('unlocked')}
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: tierMeta.color, marginTop: 2 }}>
          {t.has(`items.${badge.id}.name`) ? t(`items.${badge.id}.name`) : badge.name}{badge.tiers.length>1 ? ` · ${t('tier',{tier:toast.tier})}` : ''}
        </div>
      </div>
    </div>
  )
}

export function BadgeToastProvider({ children }: { children: ReactNode }) {
  const {user}=useAuth()
  const access=useApiResource(`/api/play/access?account=${encodeURIComponent(user?.id??'')}`,(p:unknown)=>(p as {allowed?:boolean}).allowed===true,!!user)
  const [toasts, setToasts] = useState<ToastData[]>([])

  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  useEffect(() => { const active=timers.current; return () => { active.forEach(clearTimeout); active.clear() } }, [])

  const show = useCallback((badgeId: string, tier: TierNumber) => {
    if (!BADGE_MAP[badgeId] || ![1,2,3,4].includes(tier)) return
    const id = ++toastCounter
    setToasts(prev => [...prev, { badgeId, tier, id }])
    const timer=setTimeout(() => {
      timers.current.delete(timer)
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 5500)
    timers.current.add(timer)
  }, [])

  useEffect(() => {
    function handleUnlock(e: Event) {
      const detail = (e as CustomEvent<{ badge_id: string; tier: number }>).detail
      if (detail?.badge_id && detail?.tier) {
        show(detail.badge_id, detail.tier as TierNumber)
      }
    }
    window.addEventListener(BADGE_UNLOCK_EVENT, handleUnlock)
    return () => window.removeEventListener(BADGE_UNLOCK_EVENT, handleUnlock)
  }, [show])

  return (
    <BadgeToastContext.Provider value={{ show }}>
      {children}
      {/* Toast container */}
      <div role="status" aria-live="polite" aria-atomic="true" style={{
        position: 'fixed',
        bottom: 80, // above bottom nav
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxWidth: 400,
        width: '90%',
        pointerEvents: 'none',
      }}>
        {toasts.map(toast => (
          access.data===true ? <BadgeToastItem key={toast.id} toast={toast} /> : <LegacyToastItem key={toast.id} toast={toast} />
        ))}
      </div>

    </BadgeToastContext.Provider>
  )
}

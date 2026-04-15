'use client'
// src/components/BadgeToast.tsx
//
// Celebration toast for badge unlocks. Slides in from the bottom,
// auto-dismisses after 4 seconds. Can be triggered from anywhere
// via the BadgeToastContext or via the pn-badge-unlock DOM event.

import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react'
import { BadgeIcon } from '@/components/BadgeIcon'
import { BADGE_MAP, TIER_META, type TierNumber } from '@/lib/badges'
import { spawnConfetti } from '@/lib/confetti'
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

const TIER_CONFETTI_COLORS: Record<number, string[]> = {
  1: ['#7ED321', '#fff', '#7ED321', '#fff'],
  2: ['#F5A623', '#fff', '#F5A623', '#FFD166'],
  3: ['#FF6B2B', '#fff', '#FF6B2B', '#F5A623'],
  4: ['#FFD166', '#fff', '#FFD166', '#F5A623'],
}

interface BadgeToastItemProps {
  toast: ToastData
}

function BadgeToastItem({ toast }: BadgeToastItemProps) {
  const badge = BADGE_MAP[toast.badgeId]
  const tierMeta = TIER_META[toast.tier]
  const iconRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      if (iconRef.current) {
        spawnConfetti(iconRef.current, {
          colors: TIER_CONFETTI_COLORS[toast.tier] ?? TIER_CONFETTI_COLORS[1],
        })
      }
    }, 200)
    return () => clearTimeout(timer)
  }, [toast.tier])

  if (!badge) return null

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: '#1A1A1A',
        border: `1px solid ${tierMeta.color}40`,
        clipPath: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
        padding: '10px 14px',
        boxShadow: `0 4px 20px rgba(0,0,0,0.5), 0 0 10px ${tierMeta.color}20`,
        animation: 'badge-toast-slide 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
        pointerEvents: 'auto',
      }}
    >
      <div
        ref={iconRef}
        style={{ animation: 'badge-icon-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
      >
        <BadgeIcon svgIcon={badge.svgIcon} tier={toast.tier} size={40} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 800, color: '#fff' }}>
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={tierMeta.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>
          </svg>
          Badge Unlocked
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: tierMeta.color, marginTop: 2 }}>
          {badge.name} · {tierMeta.label}
        </div>
      </div>
    </div>
  )
}

export function BadgeToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([])

  const show = useCallback((badgeId: string, tier: TierNumber) => {
    const id = ++toastCounter
    setToasts(prev => [...prev, { badgeId, tier, id }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 4000)
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
      <div style={{
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
          <BadgeToastItem key={toast.id} toast={toast} />
        ))}
      </div>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes badge-toast-slide {
          0% { transform: translateY(100%); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
        @keyframes badge-icon-pop {
          0% { transform: scale(0); }
          70% { transform: scale(1.2); }
          100% { transform: scale(1); }
        }
      `}} />
    </BadgeToastContext.Provider>
  )
}

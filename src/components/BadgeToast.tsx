'use client'
// src/components/BadgeToast.tsx
//
// Celebration toast for badge unlocks. Slides in from the bottom,
// auto-dismisses after 4 seconds. Can be triggered from anywhere
// via the BadgeToastContext.

import { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import { BadgeIcon } from '@/components/BadgeIcon'
import { BADGE_MAP, TIER_META, type TierNumber } from '@/lib/badges'
import { BG_BASE } from '@/lib/theme-colors'

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

export function BadgeToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([])

  const show = useCallback((badgeId: string, tier: TierNumber) => {
    const id = ++toastCounter
    setToasts(prev => [...prev, { badgeId, tier, id }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 4000)
  }, [])

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
        {toasts.map(toast => {
          const badge = BADGE_MAP[toast.badgeId]
          const tierMeta = TIER_META[toast.tier]
          if (!badge) return null

          return (
            <div
              key={toast.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                background: BG_BASE,
                border: `1px solid ${tierMeta.color}40`,
                clipPath: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
                padding: '10px 14px',
                boxShadow: `0 4px 20px rgba(0,0,0,0.5), 0 0 10px ${tierMeta.color}20`,
                animation: 'badge-toast-slide 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
                pointerEvents: 'auto',
              }}
            >
              <BadgeIcon svgIcon={badge.svgIcon} tier={toast.tier} size={40} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#fff' }}>
                  🎉 Badge Unlocked!
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: tierMeta.color, marginTop: 2 }}>
                  {badge.name} · {tierMeta.label}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes badge-toast-slide {
          0% { transform: translateY(100%); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
      `}} />
    </BadgeToastContext.Provider>
  )
}

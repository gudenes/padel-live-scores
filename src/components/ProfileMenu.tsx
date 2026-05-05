'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useAuth } from '@/components/AuthProvider'
import { useBadges } from '@/hooks/useBadges'
import { overallTierFromBadgeCount, TIER_META } from '@/lib/badges'
import { supabase } from '@/lib/supabase'

const CHUNKY = {
  card: 'polygon(0% 3%, 97% 0%, 100% 97%, 3% 100%)',
  badge: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
}

interface ProfileMenuProps {
  open: boolean
  onClose: () => void
  triggerRef: React.RefObject<HTMLElement | null>
}

export default function ProfileMenu({ open, onClose, triggerRef }: ProfileMenuProps) {
  const t = useTranslations('profileMenu')
  const { user, profile } = useAuth()
  const { badges: earnedBadges } = useBadges()
  const tier = overallTierFromBadgeCount(earnedBadges?.length ?? 0)
  const tierColor = tier ? TIER_META[tier].color : '#7ED321'

  const menuRef = useRef<HTMLDivElement>(null)
  const [streak, setStreak] = useState(0)

  // Click outside (ignore the trigger so it can toggle freely)
  useEffect(() => {
    if (!open) return
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (menuRef.current?.contains(target)) return
      if (triggerRef.current?.contains(target)) return
      onClose()
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [open, onClose, triggerRef])

  // Escape closes
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Fetch login_streak when menu opens for logged-in user
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!open || !user) { setStreak(0); return }
    let cancelled = false
    void (async () => {
      try {
        const { data } = await supabase.from('profiles').select('login_streak').eq('id', user.id).single()
        if (!cancelled) setStreak(data?.login_streak ?? 0)
      } catch { /* silent */ }
    })()
    return () => { cancelled = true }
  }, [open, user])

  if (!open) return null

  return (
    <div
      ref={menuRef}
      role="menu"
      style={{
        position: 'absolute',
        top: 'calc(100% + 8px)',
        right: 0,
        width: 256,
        background: '#141414',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 12px 32px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.03) inset',
        clipPath: CHUNKY.card,
        overflow: 'hidden',
        zIndex: 200,
      }}
    >
      {/* Pointer */}
      <div style={{
        position: 'absolute',
        top: -7,
        right: 16,
        width: 12,
        height: 12,
        background: '#141414',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        borderLeft: '1px solid rgba(255,255,255,0.08)',
        transform: 'rotate(45deg)',
      }} />

      {/* Auth-aware header tile */}
      {user && profile ? (
        <Link href="/profile" onClick={onClose} style={{ textDecoration: 'none' }}>
          <div style={{
            padding: '14px 14px 12px',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            background: 'radial-gradient(circle at 0% 0%, rgba(126,211,33,0.07), transparent 70%), #141414',
            cursor: 'pointer',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ position: 'relative', width: 40, height: 40, flexShrink: 0 }}>
                <div style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  background: profile.avatar_url
                    ? `url(${profile.avatar_url}) center/cover`
                    : 'linear-gradient(135deg, #2a2a2a, #555)',
                  border: `2px solid ${tierColor}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 900,
                  fontSize: 14,
                  color: '#fff',
                }}>
                  {!profile.avatar_url && (profile.display_name?.[0]?.toUpperCase() ?? 'U')}
                </div>
                {tier && (
                  <div style={{
                    position: 'absolute',
                    bottom: -3,
                    right: -6,
                    background: tierColor,
                    color: '#1a0d00',
                    fontSize: 7,
                    fontWeight: 900,
                    letterSpacing: 0.4,
                    textTransform: 'uppercase',
                    padding: '2px 5px',
                    clipPath: CHUNKY.badge,
                    whiteSpace: 'nowrap',
                  }}>T{tier}</div>
                )}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', lineHeight: 1.2 }}>
                  {profile.display_name ?? 'User'}
                </div>
                <div style={{ fontSize: 10, color: '#6B7280', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                  {streak >= 1 && (
                    <>
                      <span style={{ color: '#FF6B2B', fontWeight: 800 }}>●</span>
                      {t('dayStreak', { count: streak })}
                      {' · '}
                    </>
                  )}
                  {t('viewProfile')} ›
                </div>
              </div>
            </div>
          </div>
        </Link>
      ) : (
        <div style={{
          padding: '14px 14px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.05)',
              border: '2px dashed rgba(255,255,255,0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#6B7280',
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="4"/>
                <path d="M4 21v-1a8 8 0 0 1 16 0v1"/>
              </svg>
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', lineHeight: 1.2 }}>{t('welcomeTitle')}</div>
              <div style={{ fontSize: 10, color: '#6B7280', marginTop: 2 }}>{t('welcomeSub')}</div>
            </div>
          </div>
        </div>
      )}

      {/* Item rows + footer added in subsequent tasks */}
    </div>
  )
}

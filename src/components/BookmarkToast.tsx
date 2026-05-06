'use client'
// src/components/BookmarkToast.tsx
//
// Contextual feedback toast for bookmark/follow actions.
// Slides up from bottom with icon pop animation, auto-dismisses after 3s
// (5s when a CTA is attached). Listens for pn-bookmark-action DOM events
// fired by useFollowing.

import { useState, useCallback, useEffect, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { useAuth } from '@/components/AuthProvider'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import { useAnonPush } from '@/hooks/useAnonPush'
import { useFollowing } from '@/hooks/useFollowing'

const GREEN = '#7ED321'
const GOLD = '#FFD166'
const MUTED = '#6B7280'
const CHUNKY_CARD = 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)'
const CHUNKY_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'
const CHUNKY_BUTTON = 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)'

export const BOOKMARK_EVENT = 'pn-bookmark-action'

// localStorage flag — set when an anon user taps "Enable alerts" on a toast,
// so the next sign-in can auto-show the follow-up push-permission prompt.
export const PUSH_SIGNIN_PENDING_KEY = 'pn_push_signin_pending'

export type BookmarkCta = 'enable-push'

export interface BookmarkEventDetail {
  type: 'match' | 'player' | 'tournament'
  action: 'add' | 'remove'
  name?: string // entity name for display (e.g. player name, tournament name)
  cta?: BookmarkCta // optional action button shown on the toast
  titleOverride?: string // optional preformatted title, skips translation lookup
}

interface ToastData {
  id: number
  type: 'match' | 'player' | 'tournament'
  action: 'add' | 'remove'
  name?: string
  cta?: BookmarkCta
  titleOverride?: string
  dismissing: boolean
}

// Icons per bookmark type (add action)
function BookmarkIcon({ type }: { type: string }) {
  if (type === 'match') {
    return (
      <svg width={14} height={14} viewBox="0 0 24 24" fill={GOLD} stroke={GOLD} strokeWidth="2">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
      </svg>
    )
  }
  if (type === 'player') {
    return (
      <svg width={14} height={14} viewBox="0 0 24 24" fill={GREEN} stroke={GREEN} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
      </svg>
    )
  }
  // tournament
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>
  )
}

let toastCounter = 0

// Watches for a signed-out → signed-in transition while the push intent
// is pending (flag set when an anon user tapped "Enable alerts" on a
// bookmark toast). On transition, fires a follow-up toast that lets the
// newly-signed-in user grant browser notification permission in place.
function usePostSigninPushPrompt() {
  const { user } = useAuth()
  const t = useTranslations('bookmark')
  useEffect(() => {
    if (!user?.id) return
    let pending = false
    try { pending = localStorage.getItem(PUSH_SIGNIN_PENDING_KEY) === '1' } catch { /* noop */ }
    if (!pending) return
    try { localStorage.removeItem(PUSH_SIGNIN_PENDING_KEY) } catch { /* noop */ }
    // Fire on the next tick so the BookmarkToast listener is already bound.
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent(BOOKMARK_EVENT, {
        detail: {
          type: 'player',
          action: 'add',
          cta: 'enable-push',
          titleOverride: t('signedInEnableAlerts'),
        } satisfies BookmarkEventDetail,
      }))
    }, 300)
  }, [user?.id, t])
}

export function BookmarkToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([])
  usePostSigninPushPrompt()

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, dismissing: true } : t))
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 300)
  }, [])

  const show = useCallback((detail: BookmarkEventDetail) => {
    const id = ++toastCounter
    setToasts(prev => [...prev, { ...detail, id, dismissing: false }])
    // CTA toasts stay on screen longer so the user has time to tap
    const visibleMs = detail.cta ? 5000 : 3000
    setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, dismissing: true } : t))
    }, visibleMs - 300)
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, visibleMs)
  }, [])

  useEffect(() => {
    function handler(e: Event) {
      const detail = (e as CustomEvent<BookmarkEventDetail>).detail
      if (detail?.type && detail?.action) {
        show(detail)
      }
    }
    window.addEventListener(BOOKMARK_EVENT, handler)
    return () => window.removeEventListener(BOOKMARK_EVENT, handler)
  }, [show])

  return (
    <>
      {children}
      {toasts.length > 0 && (
        <div style={{
          position: 'fixed',
          bottom: 80,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 9998,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          maxWidth: 360,
          width: '90%',
          pointerEvents: 'none',
        }}>
          {toasts.map(toast => (
            <BookmarkToastItem key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
          ))}
        </div>
      )}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes bk-toast-slide {
          0% { transform: translateY(100%); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
        @keyframes bk-toast-dismiss {
          0% { transform: translateY(0); opacity: 1; }
          100% { transform: translateY(10px); opacity: 0; }
        }
        @keyframes bk-icon-pop {
          0% { transform: scale(0); }
          60% { transform: scale(1.2); }
          100% { transform: scale(1); }
        }
        @keyframes bk-text-fade {
          0% { opacity: 0; transform: translateX(-4px); }
          100% { opacity: 1; transform: translateX(0); }
        }
      `}} />
    </>
  )
}

function BookmarkToastItem({ toast, onDismiss }: { toast: ToastData; onDismiss: () => void }) {
  const t = useTranslations('bookmark')
  const { user } = useAuth()
  const { subscribe, supported: pushSupported } = usePushNotifications()
  const anonPush = useAnonPush()
  const { getFollowed } = useFollowing()
  const isAdd = toast.action === 'add'
  const isMatch = toast.type === 'match'
  const borderColor = isAdd
    ? (isMatch ? `rgba(255,209,102,0.15)` : `rgba(126,211,33,0.15)`)
    : 'rgba(255,255,255,0.06)'
  const iconBg = isAdd
    ? (isMatch ? 'rgba(255,209,102,0.12)' : 'rgba(126,211,33,0.12)')
    : 'rgba(255,255,255,0.06)'

  // Title text — explicit override wins over the type/action-derived title.
  let title: string
  if (toast.titleOverride) {
    title = toast.titleOverride
  } else if (isAdd) {
    if (toast.type === 'match') title = t('matchBookmarked')
    else if (toast.type === 'player') title = toast.name ? t('followingPlayer', { name: toast.name }) : t('playerFollowed')
    else title = toast.name ? t('followingTournament', { name: toast.name }) : t('tournamentFollowed')
  } else {
    title = t('bookmarkRemoved')
  }

  // Hint text — hidden when a CTA is present (the CTA button carries the next-step meaning).
  const hint = isAdd && !toast.cta ? t('findInFollowing') : null

  const handleCta = useCallback(async () => {
    if (toast.cta !== 'enable-push') return
    // Either path counts as "we asked the user" — don't re-surface the CTA
    // on subsequent follows even if they dismiss the native prompt later.
    try { localStorage.setItem('pn_push_prompted', '1') } catch {}
    if (!user) {
      // Anonymous — register an anon push subscription on the spot. The
      // user's current bookmarks become the initial anon_bookmarks set so
      // they immediately start receiving push for things they already follow.
      // No sign-in punt: anon push is a first-class path post-Spec 2.
      const initial = [
        ...getFollowed('player').map(id => ({ type: 'player' as const, target_id: id })),
        ...getFollowed('match').map(id => ({ type: 'match' as const, target_id: id })),
      ]
      await anonPush.ensureSubscription(initial)
      onDismiss()
      return
    }
    if (!pushSupported) {
      onDismiss()
      return
    }
    // Signed in — trigger the native permission prompt inline.
    await subscribe()
    onDismiss()
  }, [toast.cta, user, pushSupported, subscribe, anonPush, getFollowed, onDismiss])

  return (
    <div style={{
      animation: toast.dismissing
        ? 'bk-toast-dismiss 0.3s ease-out forwards'
        : 'bk-toast-slide 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)',
      pointerEvents: 'auto',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: '#1A1A1A',
        border: `1px solid ${borderColor}`,
        clipPath: CHUNKY_CARD,
        padding: '12px 14px',
        boxShadow: `0 4px 20px rgba(0,0,0,0.5)`,
      }}>
        {/* Icon */}
        <div style={{
          width: 28, height: 28, flexShrink: 0,
          clipPath: CHUNKY_BADGE,
          background: iconBg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'bk-icon-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}>
          {isAdd ? (
            <BookmarkIcon type={toast.type} />
          ) : (
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          )}
        </div>
        {/* Text */}
        <div style={{
          flex: 1, minWidth: 0,
          animation: 'bk-text-fade 0.3s ease-out 0.1s both',
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: isAdd ? '#fff' : '#9AAEC4' }}>
            {title}
          </div>
          {hint && (
            <div style={{ fontSize: 10, color: '#6889A5', marginTop: 1 }}>
              {hint}
            </div>
          )}
        </div>
        {/* CTA button (right-aligned, shown when toast has a CTA) */}
        {toast.cta === 'enable-push' && (
          <button
            onClick={handleCta}
            style={{
              background: 'rgba(126,211,33,0.12)',
              border: `1px solid rgba(126,211,33,0.3)`,
              clipPath: CHUNKY_BUTTON,
              color: GREEN,
              padding: '6px 10px',
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
              cursor: 'pointer',
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontFamily: 'inherit',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            {t('enableAlerts')}
          </button>
        )}
      </div>
    </div>
  )
}

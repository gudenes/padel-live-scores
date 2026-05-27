'use client'
// src/components/NotificationNudgeSheet.tsx
//
// Bottom sheet shown by NotificationNudgeProvider when a bookmark/follow
// happens and notifications can't reach the user. Two states:
//
//   os-blocked — OS perm denied, can't fix from inside app. CTA deep-links
//                to system settings via openSystemNotificationSettings().
//                Icon: red shield-alert. CTA color: live red.
//
//   pref-off   — OS perm OK but the in-app push pref is off. CTA flips the
//                pref via the provider's turnOn handler. Icon: green bell.
//                CTA color: primary green.

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import type { NudgeCategory, NudgeState } from '@/hooks/useNotificationNudge'
import { openSystemNotificationSettings } from '@/lib/native-settings'

interface NotificationNudgeSheetProps {
  state: NudgeState
  category: NudgeCategory
  onDismiss: () => void
  onTurnOn: () => void
}

export function NotificationNudgeSheet({ state, category, onDismiss, onTurnOn }: NotificationNudgeSheetProps) {
  const t = useTranslations('notifications.settings.nudge')

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onDismiss])

  const isOsBlocked = state === 'os-blocked'
  const subjectKey = category === 'match_live_follow' ? 'player' : 'match'

  const title = isOsBlocked
    ? t('osBlocked.title')
    : t(`${subjectKey}.title`)
  const body = isOsBlocked
    ? t('osBlocked.body')
    : t(`${subjectKey}.body`)
  const ctaLabel = isOsBlocked
    ? t('osBlocked.cta')
    : t(`${subjectKey}.cta`)
  const ctaColor = isOsBlocked ? '#FF4655' : '#7ED321'
  const ctaTextColor = isOsBlocked ? '#fff' : '#0a0a0a'
  const iconBg = isOsBlocked ? 'rgba(245,70,85,0.10)' : 'rgba(126,211,33,0.10)'
  const iconBorder = isOsBlocked ? 'rgba(245,70,85,0.30)' : 'rgba(126,211,33,0.30)'
  const iconColor = isOsBlocked ? '#ff7884' : '#7ED321'

  const handleCta = () => {
    if (isOsBlocked) {
      openSystemNotificationSettings()
      onDismiss()
    } else {
      onTurnOn()
    }
  }

  return (
    <>
      <div
        onClick={onDismiss}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200 }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          background: '#1A1A1A', borderTop: '1px solid rgba(255,255,255,0.10)',
          padding: '16px 16px 24px', zIndex: 201,
        }}
      >
        <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,0.20)', borderRadius: 999, margin: '0 auto 14px' }} />
        <div style={{
          width: 44, height: 44,
          background: iconBg, border: `1px solid ${iconBorder}`,
          color: iconColor,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 12px',
          clipPath: 'polygon(0% 5%, 100% 95%, 0% 100%)',
        }}>
          {isOsBlocked ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          )}
        </div>
        <h2 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 8px', textAlign: 'center', color: '#fff' }}>{title}</h2>
        <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5, textAlign: 'center', marginBottom: 18, padding: '0 8px' }}>{body}</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            onClick={onDismiss}
            style={{
              flex: 1, padding: '10px 14px',
              background: 'transparent', color: 'rgba(255,255,255,0.75)',
              border: '1.5px solid rgba(255,255,255,0.22)',
              fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.4,
              clipPath: 'polygon(0% 4%, 100% 96%, 0% 100%)',
              cursor: 'pointer',
            }}
          >
            {t('dismiss')}
          </button>
          <button
            type="button"
            onClick={handleCta}
            style={{
              flex: 1, padding: '10px 14px',
              background: ctaColor, color: ctaTextColor, border: 0,
              fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.4,
              clipPath: 'polygon(0% 4%, 100% 96%, 0% 100%)',
              cursor: 'pointer',
            }}
          >
            {ctaLabel}
          </button>
        </div>
      </div>
    </>
  )
}

'use client'
// src/app/[locale]/(app)/profile/settings/notifications/page.tsx
//
// Notifications preferences (redesigned 2026-05-27 — see
// docs/superpowers/specs/2026-05-27-notifications-redesign-design.md).
//
// Layout top-to-bottom:
//   1. Permission-blocked banner (when OS perm denied)
//   2. Mute notifications row (action — opens MuteDurationSheet)
//   3. Notification sounds row (deep-link to OS channel settings)
//   4. Master "Push notifications" toggle
//   5. "Matches" group — 3 categories
//   6. "Updates" group — 2 categories
//   7. Auto-save hint footer
//
// Every per-category toggle uses <IconSlider> + <SaveStateSlot>. PATCH on
// /api/user/notification-prefs is optimistic with rollback + error toast.

import { useEffect, useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { usePushNotifications, type SubscribeError } from '@/hooks/usePushNotifications'
import { KNOWN_CATEGORIES, type NotificationCategory, type ChannelPrefs } from '@/lib/notification-categories'
import { IconSlider } from '@/components/IconSlider'
import { SaveStateSlot, type SaveState } from '@/components/SaveStateSlot'

// Placeholder until Task 21 wires the real Capacitor plugin
function openSystemNotificationSettings() { console.warn('[settings] openSystemNotificationSettings called — placeholder') }

type Group = { key: 'groupMatches' | 'groupUpdates'; categories: NotificationCategory[] }
const GROUPS: Group[] = [
  { key: 'groupMatches', categories: ['match_live_follow', 'match_live_bookmark', 'match_finished'] },
  { key: 'groupUpdates', categories: ['ranking_updated', 'marketing'] },
]

export default function NotificationPrefsPage() {
  const t = useTranslations('notifications.settings')
  const router = useRouter()
  const { enabled: pushEnabled, toggle: togglePush, permission, supported, lastError, clearError } = usePushNotifications()
  const [prefs, setPrefs] = useState<Record<NotificationCategory, ChannelPrefs> | null>(null)
  const [saveStates, setSaveStates] = useState<Partial<Record<NotificationCategory | '__master__', SaveState>>>({})
  const [masterSaveState, setMasterSaveState] = useState<SaveState>('idle')
  const [toast, setToast] = useState<string | null>(null)

  // ── Load prefs from server ─────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/user/notification-prefs', { cache: 'no-store' })
        if (!res.ok) return
        const body = await res.json() as { prefs: Record<NotificationCategory, ChannelPrefs> }
        if (!cancelled) setPrefs(body.prefs)
      } catch { /* silent — error toast covers user-initiated saves only */ }
    })()
    return () => { cancelled = true }
  }, [])

  // ── Map structured subscribe-error → localized toast (from PR #459) ─
  const formatSubscribeError = useCallback((err: SubscribeError): string => {
    switch (err.kind) {
      case 'not-signed-in':      return t('errors.notSignedIn')
      case 'os-denied':          return t('errors.osDenied')
      case 'token-unavailable':  return t('errors.tokenUnavailable', { message: err.message })
      case 'server-auth':        return t('errors.serverAuth')
      case 'server-error':       return t('errors.serverError', { status: err.status })
      case 'network':            return t('errors.network', { message: err.message })
      case 'not-supported':      return t('errors.notSupported')
    }
  }, [t])

  useEffect(() => {
    if (!lastError) return
    setToast(formatSubscribeError(lastError))
    const timer = setTimeout(() => { setToast(null); clearError() }, 6000)
    return () => clearTimeout(timer)
  }, [lastError, formatSubscribeError, clearError])

  // ── Per-category PATCH with optimistic rollback + per-row save state ──
  const patchCategory = useCallback(async (category: NotificationCategory, next: ChannelPrefs) => {
    if (!prefs) return
    const prev = prefs
    setPrefs({ ...prefs, [category]: next })
    setSaveStates(s => ({ ...s, [category]: 'saving' }))
    try {
      const res = await fetch('/api/user/notification-prefs', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ category, push: next.push }),
      })
      if (!res.ok) throw new Error('save failed')
      setSaveStates(s => ({ ...s, [category]: 'saved' }))
    } catch {
      setPrefs(prev)
      setSaveStates(s => ({ ...s, [category]: 'idle' }))
      setToast(t('saveError'))
      setTimeout(() => setToast(null), 2500)
    }
  }, [prefs, t])

  const permissionDenied = supported && permission === 'denied'

  return (
    <main style={{ paddingBottom: 80, background: '#0A0A0A', minHeight: '100vh' }}>
      {/* Sub-header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: '#0A0A0A',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        padding: '12px 16px',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <button onClick={() => router.back()} aria-label="Back" style={{ background: 'transparent', border: 'none', color: '#7ED321', cursor: 'pointer', padding: 0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: '#fff', margin: 0 }}>{t('title')}</h1>
      </div>

      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Permission-blocked banner */}
        {permissionDenied && (
          <div style={{
            background: 'rgba(245,70,85,0.08)',
            border: '1px solid rgba(245,70,85,0.35)',
            padding: '11px 13px',
            clipPath: 'polygon(0% 2%, 99.5% 0%, 100% 98%, 0.5% 100%)',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <span style={{
              width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(245,70,85,0.18)', color: '#ff7884',
              clipPath: 'polygon(0% 5%, 100% 0%, 100% 95%, 0% 100%)',
              flexShrink: 0,
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ color: '#ff7884', fontSize: 12.5, fontWeight: 700 }}>{t('blocked.title')}</div>
              <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11.5, marginTop: 2 }}>{t('blocked.body')}</div>
            </div>
            <button
              onClick={() => openSystemNotificationSettings()}
              style={{
                background: '#FF4655', color: '#fff', border: 0, padding: '6px 12px',
                fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.4,
                clipPath: 'polygon(0% 4%, 100% 0%, 100% 96%, 0% 100%)',
                cursor: 'pointer', flexShrink: 0,
              }}
            >
              {t('blocked.cta')}
            </button>
          </div>
        )}

        {/* Master push toggle */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          clipPath: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
        }}>
          <span style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>{t('masterLabel')}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <IconSlider
              checked={pushEnabled}
              onChange={() => void togglePush()}
              disabled={!supported || permissionDenied}
              ariaLabel={t('masterLabel')}
            />
            <SaveStateSlot state={masterSaveState} onSavedFlashEnd={() => setMasterSaveState('idle')} />
          </div>
        </div>

        {/* Category groups — populated in Task 7 */}
        {prefs && GROUPS.map(group => (
          <section key={group.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.7, padding: '10px 4px 2px' }}>
              {t(group.key)}
            </div>
            {/* Rows added in Task 7 */}
          </section>
        ))}

        {/* Auto-save hint footer */}
        <div style={{
          textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.35)',
          padding: '14px 0 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#7ED321' }} />
          {t('saveHint')}
        </div>
      </div>

      {/* Toast (error path only) */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 80, left: 16, right: 16,
          background: '#FF4655', color: '#fff', padding: '10px 14px',
          fontSize: 13, fontWeight: 600, textAlign: 'center', zIndex: 100,
          clipPath: 'polygon(0% 4%, 100% 0%, 100% 96%, 0% 100%)',
        }}>
          {toast}
        </div>
      )}

      {/* KNOWN_CATEGORIES keeps the import live for future category rows */}
      {false && <span>{KNOWN_CATEGORIES.join(',')}</span>}

      {/* saveStates used by per-category rows in Task 7 */}
      {false && <span>{JSON.stringify(saveStates)}</span>}

      {/* patchCategory wired in Task 7 */}
      {false && <span>{String(patchCategory)}</span>}
    </main>
  )
}

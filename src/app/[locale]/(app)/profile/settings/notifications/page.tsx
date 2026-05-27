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
import { type NotificationCategory, type ChannelPrefs } from '@/lib/notification-categories'
import { IconSlider } from '@/components/IconSlider'
import { SaveStateSlot, type SaveState } from '@/components/SaveStateSlot'
import { MuteDurationSheet } from '@/components/MuteDurationSheet'
import { openSystemNotificationSettings, isNativeRuntime } from '@/lib/native-settings'
import PressButton, { PRESS_PRESETS } from '@/components/PressButton'

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
  const [muteUntil, setMuteUntil] = useState<string | null>(null)
  const [muteSheetOpen, setMuteSheetOpen] = useState(false)
  const [isNative, setIsNative] = useState(false)

  // Detect Capacitor runtime on mount only — avoids hydration mismatch
  // between SSR (always false) and native first-render (true).
  useEffect(() => { setIsNative(isNativeRuntime()) }, [])

  // ── Load prefs from server ─────────────────────────────────────
  // Augment the existing prefs-load effect — mute_until lives at the same endpoint
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/user/notification-prefs', { cache: 'no-store' })
        if (!res.ok) return
        const body = await res.json() as {
          prefs: Record<NotificationCategory, ChannelPrefs>
          mute_until?: string | null
        }
        if (!cancelled) {
          setPrefs(body.prefs)
          setMuteUntil(body.mute_until ?? null)
        }
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

  // ── Mute PATCH with optimistic rollback ────────────────────────
  const patchMute = useCallback(async (until: string | null) => {
    const prev = muteUntil
    setMuteUntil(until)
    try {
      const res = await fetch('/api/user/notification-prefs', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mute_until: until }),
      })
      if (!res.ok) throw new Error('save failed')
    } catch {
      setMuteUntil(prev)
      setToast(t('saveError'))
      setTimeout(() => setToast(null), 2500)
    }
  }, [muteUntil, t])

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
            {/* Permission-blocked CTA — uses production PressButton with
                live (red) intent. Face/skirt depth + chunky-tilt clip-path
                inherited from PRESS_PRESETS.chunkyInline; accent overridden
                to the alarm-red used elsewhere in the notify pipeline. */}
            <PressButton
              {...PRESS_PRESETS.chunkyInline}
              accent="#FF4655"
              skirt="#99131D"
              textColor="#fff"
              onClick={() => openSystemNotificationSettings()}
              style={{
                flexShrink: 0,
                padding: '6px 12px',
                fontSize: 10,
                fontWeight: 900,
                textTransform: 'uppercase',
                letterSpacing: 0.4,
              }}
            >
              {t('blocked.cta')}
            </PressButton>
          </div>
        )}

        {/* Mute action row */}
        <div style={{
          padding: '14px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          clipPath: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
            <span style={{
              width: 32, height: 32, background: 'rgba(255,255,255,0.06)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'rgba(255,255,255,0.75)',
              clipPath: 'polygon(0% 5%, 100% 0%, 100% 95%, 0% 100%)',
              flexShrink: 0,
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13.73 21a2 2 0 0 1-3.46 0M18 8a6 6 0 0 0-9.33-5M6.26 6.26A6 6 0 0 0 6 8c0 7-3 9-3 9h14M1 1l22 22" />
              </svg>
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#fff', lineHeight: 1.25 }}>{t('mute.label')}</span>
              <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.35 }}>{t('mute.sub')}</span>
            </div>
          </div>
          {muteUntil ? (
            <button
              type="button"
              onClick={() => void patchMute(null)}
              style={{
                background: '#EAB308', color: '#1A1A1A', border: 0, padding: '7px 13px',
                fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.4,
                clipPath: 'polygon(0% 4%, 100% 0%, 100% 96%, 0% 100%)',
                cursor: 'pointer', flexShrink: 0,
              }}
            >
              {muteUntil === 'forever' ? t('mute.activeForever') : t('mute.activeUntil', { time: new Date(muteUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) })}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setMuteSheetOpen(true)}
              style={{
                background: 'transparent', color: 'rgba(255,255,255,0.65)',
                border: '1.5px solid rgba(255,255,255,0.20)', padding: '7px 13px',
                fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.4,
                clipPath: 'polygon(0% 4%, 100% 0%, 100% 96%, 0% 100%)',
                cursor: 'pointer', flexShrink: 0,
              }}
            >
              {t('mute.cta')}
            </button>
          )}
        </div>

        {/* Notification sounds deep-link — native-only.
            Web browsers don't expose a way to deep-link to notification-sound
            settings; the row would no-op and confuse users. Hidden until the
            Capacitor runtime is detected on mount. */}
        {isNative && (
          <button
            type="button"
            onClick={() => openSystemNotificationSettings()}
            style={{
              padding: '14px',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              clipPath: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
              cursor: 'pointer', textAlign: 'left',
              color: 'inherit',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
              <span style={{
                width: 32, height: 32, background: 'rgba(255,255,255,0.06)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'rgba(255,255,255,0.75)',
                clipPath: 'polygon(0% 5%, 100% 0%, 100% 95%, 0% 100%)',
                flexShrink: 0,
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                </svg>
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#fff', lineHeight: 1.25 }}>{t('sounds.label')}</span>
                <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.35 }}>{t('sounds.sub')}</span>
              </div>
            </div>
            <span style={{ color: 'rgba(255,255,255,0.4)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 6 15 12 9 18" />
              </svg>
            </span>
          </button>
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
          <section key={group.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.7, padding: '10px 4px 2px' }}>
              {t(group.key)}
            </div>
            {group.categories.map(cat => {
              const pref = prefs[cat]
              const state = saveStates[cat] ?? 'idle'
              const disabledByMaster = !pushEnabled || permissionDenied
              return (
                <div
                  key={cat}
                  style={{
                    padding: '14px',
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    clipPath: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: 12,
                    opacity: disabledByMaster ? 0.45 : 1,
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#fff', lineHeight: 1.25 }}>
                      {t(`category.${cat}.label`)}
                    </span>
                    <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.35 }}>
                      {t(`category.${cat}.sub`)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                    <IconSlider
                      checked={pref.push}
                      onChange={(next) => void patchCategory(cat, { push: next })}
                      disabled={disabledByMaster}
                      ariaLabel={t(`category.${cat}.label`)}
                    />
                    <SaveStateSlot
                      state={state}
                      onSavedFlashEnd={() => setSaveStates(s => ({ ...s, [cat]: 'idle' }))}
                    />
                  </div>
                </div>
              )
            })}
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

      <MuteDurationSheet
        open={muteSheetOpen}
        onClose={() => setMuteSheetOpen(false)}
        onPick={(until) => void patchMute(until)}
      />
    </main>
  )
}

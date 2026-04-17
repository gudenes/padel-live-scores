'use client'
// src/app/[locale]/(app)/profile/settings/notifications/page.tsx
//
// Granular notification preferences:
//   - Permission-denied banner (when Notification.permission === 'denied')
//   - Master push toggle (reuses usePushNotifications)
//   - Category rows grouped by "Matches", "Achievements", "Other"
//   - Two toggles per row (PUSH, IN-APP); push column dims when master is off.

import { useEffect, useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import { KNOWN_CATEGORIES, type NotificationCategory, type ChannelPrefs } from '@/lib/notification-categories'

type Group = { key: 'groupMatches' | 'groupAchievements' | 'groupOther'; categories: NotificationCategory[] }
const GROUPS: Group[] = [
  { key: 'groupMatches', categories: ['match_live_follow', 'match_live_bookmark', 'match_finished', 'match_upcoming'] },
  { key: 'groupAchievements', categories: ['badge_earned', 'streak_milestone'] },
  { key: 'groupOther', categories: ['marketing'] },
]

function Toggle({ on, onChange, disabled, ariaLabel }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; ariaLabel: string }) {
  return (
    <button
      aria-label={ariaLabel}
      aria-pressed={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      style={{
        width: 36, height: 20,
        borderRadius: 999,
        border: 'none',
        background: on ? '#7ED321' : 'rgba(255,255,255,0.18)',
        position: 'relative',
        cursor: disabled ? 'not-allowed' : 'pointer',
        padding: 0,
        transition: 'background 0.15s',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{
        position: 'absolute',
        top: 2, left: on ? 18 : 2,
        width: 16, height: 16,
        borderRadius: '50%',
        background: '#fff',
        transition: 'left 0.15s',
      }}/>
    </button>
  )
}

export default function NotificationPrefsPage() {
  const t = useTranslations('notifications.settings')
  const router = useRouter()
  const { enabled: pushEnabled, toggle: togglePush, permission, supported } = usePushNotifications()
  const [prefs, setPrefs] = useState<Record<NotificationCategory, ChannelPrefs> | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/user/notification-prefs', { cache: 'no-store' })
        if (!res.ok) return
        const body = await res.json() as { prefs: Record<NotificationCategory, ChannelPrefs> }
        if (!cancelled) setPrefs(body.prefs)
      } catch { /* silent */ }
    })()
    return () => { cancelled = true }
  }, [])

  const patch = useCallback(async (category: NotificationCategory, patch: Partial<ChannelPrefs>) => {
    if (!prefs) return
    const prev = prefs
    const next = { ...prefs, [category]: { ...prefs[category], ...patch } }
    setPrefs(next)
    try {
      const res = await fetch('/api/user/notification-prefs', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ category, ...patch }),
      })
      if (!res.ok) throw new Error('save failed')
    } catch {
      setPrefs(prev)
      setToast(t('saveError'))
      setTimeout(() => setToast(null), 2500)
    }
  }, [prefs, t])

  const permissionDenied = supported && permission === 'denied'

  return (
    <main style={{ paddingBottom: 80, background: '#0A0A0A', minHeight: '100vh' }}>
      {/* Sub-header */}
      <div style={{
        position: 'sticky', top: 62, zIndex: 10,
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

      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {permissionDenied && (
          <div style={{
            background: 'rgba(245,166,35,0.08)',
            border: '1px solid rgba(245,166,35,0.35)',
            padding: '10px 12px',
            borderRadius: 6,
          }}>
            <div style={{ color: '#F5A623', fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{t('permissionDeniedTitle')}</div>
            <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12 }}>{t('permissionDeniedBody')}</div>
          </div>
        )}

        {/* Master push toggle */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 14px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
        }}>
          <span style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>{t('masterLabel')}</span>
          <Toggle
            on={pushEnabled}
            onChange={() => void togglePush()}
            disabled={!supported || permissionDenied}
            ariaLabel={t('masterLabel')}
          />
        </div>

        {/* Column header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 60px 60px',
          gap: 8,
          padding: '0 14px',
          fontSize: 11,
          letterSpacing: 0.5,
          color: 'rgba(255,255,255,0.45)',
          fontWeight: 700,
        }}>
          <span />
          <span style={{ textAlign: 'center' }}>{t('columnPush')}</span>
          <span style={{ textAlign: 'center' }}>{t('columnInApp')}</span>
        </div>

        {prefs && GROUPS.map(group => (
          <section key={group.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, padding: '6px 14px' }}>
              {t(group.key)}
            </div>
            {group.categories.map(cat => {
              const pref = prefs[cat]
              const pushDim = !pushEnabled
              return (
                <div key={cat} style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 60px 60px',
                  alignItems: 'center',
                  gap: 8,
                  padding: '12px 14px',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}>
                  <div>
                    <div style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{t(`category.${cat}.label`)}</div>
                    <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, marginTop: 2 }}>{t(`category.${cat}.sub`)}</div>
                  </div>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'center',
                    opacity: pushDim ? 0.3 : 1,
                    pointerEvents: pushDim ? 'none' : 'auto',
                  }}>
                    <Toggle
                      on={pushDim ? false : pref.push}
                      onChange={(v) => void patch(cat, { push: v })}
                      ariaLabel={`${t(`category.${cat}.label`)} push`}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <Toggle
                      on={pref.inApp}
                      onChange={(v) => void patch(cat, { inApp: v })}
                      ariaLabel={`${t(`category.${cat}.label`)} in-app`}
                    />
                  </div>
                </div>
              )
            })}
          </section>
        ))}
      </div>

      {toast && (
        <div style={{
          position: 'fixed',
          bottom: 80, left: 16, right: 16,
          background: '#FF4655',
          color: '#fff',
          padding: '10px 14px',
          borderRadius: 6,
          fontSize: 13,
          fontWeight: 600,
          textAlign: 'center',
          zIndex: 100,
        }}>
          {toast}
        </div>
      )}

      {/* KNOWN_CATEGORIES keeps the import live if a future reducer needs it */}
      {false && <span>{KNOWN_CATEGORIES.join(',')}</span>}
    </main>
  )
}

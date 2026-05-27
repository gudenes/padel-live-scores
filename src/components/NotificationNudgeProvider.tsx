'use client'
// src/components/NotificationNudgeProvider.tsx
//
// Mounted once in (app)/layout.tsx. Owns the active-nudge state and renders
// the <NotificationNudgeSheet> when needed. Hook subscribers (via
// useNotificationNudge) publish category candidates; this component runs
// shouldShowNudge() with the current OS perm + stored prefs and decides
// whether to actually show.

import { createContext, useCallback, useEffect, useState, type ReactNode } from 'react'
import { NotificationNudgeSheet } from './NotificationNudgeSheet'
import { shouldShowNudge, recordDismissal, type NudgeCategory, type NudgeState } from '@/hooks/useNotificationNudge'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import type { ChannelPrefs, NotificationCategory } from '@/lib/notification-categories'

interface NotificationNudgeContextValue {
  publish: (category: NudgeCategory) => void
}

export const NotificationNudgeContext = createContext<NotificationNudgeContextValue>({
  publish: () => { /* no-op default for SSR / unprovided contexts */ },
})

interface ActiveNudge {
  category: NudgeCategory
  state: NudgeState
}

export function NotificationNudgeProvider({ children }: { children: ReactNode }) {
  const { permission } = usePushNotifications()
  const [prefs, setPrefs] = useState<Record<NotificationCategory, ChannelPrefs> | null>(null)
  const [active, setActive] = useState<ActiveNudge | null>(null)

  // Load prefs once on mount. Re-fetch after "Turn on" mutates a pref.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/user/notification-prefs', { cache: 'no-store' })
        if (!res.ok) return
        const body = await res.json() as { prefs: Record<NotificationCategory, ChannelPrefs> }
        if (!cancelled) setPrefs(body.prefs)
      } catch { /* silent — nudge will not fire until prefs load */ }
    })()
    return () => { cancelled = true }
  }, [])

  const publish = useCallback((category: NudgeCategory) => {
    if (!prefs) return // prefs haven't loaded yet — silently skip this nudge
    const categoryPushPref = prefs[category]?.push ?? true
    const verdict = shouldShowNudge(category, {
      osPermission: permission,
      categoryPushPref,
      now: Date.now(),
      storage: window.localStorage,
    })
    if (verdict) setActive({ category, state: verdict })
  }, [prefs, permission])

  const dismiss = useCallback(() => {
    if (active) recordDismissal(active.category, Date.now(), window.localStorage)
    setActive(null)
  }, [active])

  const turnOn = useCallback(async () => {
    if (!active || active.state !== 'pref-off') {
      setActive(null)
      return
    }
    // PATCH the in-app pref to push:true, then dismiss
    try {
      await fetch('/api/user/notification-prefs', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ category: active.category, push: true }),
      })
      // Refetch prefs so other consumers see the update
      const res = await fetch('/api/user/notification-prefs', { cache: 'no-store' })
      if (res.ok) {
        const body = await res.json() as { prefs: Record<NotificationCategory, ChannelPrefs> }
        setPrefs(body.prefs)
      }
    } catch { /* silent — sheet still dismisses */ }
    recordDismissal(active.category, Date.now(), window.localStorage)
    setActive(null)
  }, [active])

  return (
    <NotificationNudgeContext.Provider value={{ publish }}>
      {children}
      {active && (
        <NotificationNudgeSheet
          state={active.state}
          category={active.category}
          onDismiss={dismiss}
          onTurnOn={turnOn}
        />
      )}
    </NotificationNudgeContext.Provider>
  )
}

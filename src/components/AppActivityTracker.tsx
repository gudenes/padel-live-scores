'use client'
import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { useAuth } from './AuthProvider'
import { startForegroundPresence } from '@/lib/foreground-presence'
export function AppActivityTracker() {
  const { user, loading } = useAuth()
  useEffect(() => {
    if (loading || !user?.id) return
    const controller = new AbortController(),
      native = Capacitor.isNativePlatform()
    const presence = startForegroundPresence({
      document,
      window,
      native,
      ping: async () => {
        const r = await fetch('/api/user/app-presence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
          signal: controller.signal,
        })
        if (!r.ok) throw Error('presence_unavailable')
      },
    })
    let disposed = false,
      remove: (() => Promise<void>) | undefined
    if (native) {
      void import('@capacitor/app')
        .then(async ({ App }) => {
          let transitions = 0
          const listener = await App.addListener(
            'appStateChange',
            ({ isActive }) => {
              transitions++
              presence.setNativeActive(isActive)
            }
          )
          if (disposed) {
            await listener.remove()
            return
          }
          remove = () => listener.remove()
          const version = transitions
          const state = await App.getState()
          if (!disposed && version === transitions)
            presence.setNativeActive(state.isActive)
        })
        .catch(() => {
          /* Native activity is unknown, so no background presence is sent. */
        })
    }
    return () => {
      disposed = true
      presence.stop()
      controller.abort()
      void remove?.()
    }
  }, [user?.id, loading])
  return null
}

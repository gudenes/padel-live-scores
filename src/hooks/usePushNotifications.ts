'use client'
// src/hooks/usePushNotifications.ts
// Manages Web Push subscription lifecycle.
// - subscribe: requests permission, subscribes via Push API, saves to Supabase
// - unsubscribe: removes from Push API and Supabase
// - toggle: subscribes if not subscribed, unsubscribes if subscribed

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/components/AuthProvider'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from(rawData, (char) => char.charCodeAt(0))
}

export function usePushNotifications() {
  const { user } = useAuth()
  const [enabled, setEnabled] = useState(false)
  const [supported, setSupported] = useState(false)
  const [permission, setPermission] = useState<NotificationPermission>('default')

  useEffect(() => {
    const isSupported = typeof window !== 'undefined'
      && 'serviceWorker' in navigator
      && 'PushManager' in window
      && 'Notification' in window

    setSupported(isSupported)

    if (isSupported) {
      setPermission(Notification.permission)
    }

    // Check if already subscribed
    if (isSupported && user) {
      navigator.serviceWorker.ready.then(async (registration) => {
        const subscription = await registration.pushManager.getSubscription()
        setEnabled(!!subscription)
      })
    }
  }, [user])

  const subscribe = useCallback(async () => {
    if (!user || !supported) return false

    // 1. Ask the browser for permission (blocking UX — must wait for the
    //    user to interact with the native prompt).
    let perm: NotificationPermission
    try {
      perm = await Notification.requestPermission()
      setPermission(perm)
    } catch (e) {
      console.error('[Push] Permission request failed:', e)
      return false
    }
    if (perm !== 'granted') return false

    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    if (!vapidKey) {
      console.error('[Push] VAPID public key not configured')
      return false
    }

    // 2. Flip the toggle optimistically so the UI responds instantly.
    //    The remaining steps (pushManager.subscribe + server persistence)
    //    commonly take 300–2000ms because they involve a round-trip to
    //    the browser's push service.
    setEnabled(true)

    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
      })
      await fetch('/api/user/push-subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint, keys: subscription.toJSON().keys }),
      })
      return true
    } catch (e) {
      // Revert optimistic flip on failure so the UI reflects reality.
      console.error('[Push] Subscribe failed:', e)
      setEnabled(false)
      return false
    }
  }, [user, supported])

  const unsubscribe = useCallback(async () => {
    if (!user || !supported) return

    // Flip off immediately — unsubscribing has no permission gate, so the
    // UI can reflect the new state before the push-service round-trip.
    setEnabled(false)

    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (!subscription) return

      const endpoint = subscription.endpoint
      await subscription.unsubscribe()
      await fetch('/api/user/push-subscriptions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      })
    } catch (e) {
      // Revert on failure: re-probe actual subscription state rather than
      // assuming true, so we don't lie about a partial teardown.
      console.error('[Push] Unsubscribe failed:', e)
      try {
        const registration = await navigator.serviceWorker.ready
        const subscription = await registration.pushManager.getSubscription()
        setEnabled(!!subscription)
      } catch { /* leave as false */ }
    }
  }, [user, supported])

  const toggle = useCallback(async () => {
    if (enabled) {
      await unsubscribe()
    } else {
      await subscribe()
    }
  }, [enabled, subscribe, unsubscribe])

  return { enabled, supported, permission, toggle, subscribe, unsubscribe }
}

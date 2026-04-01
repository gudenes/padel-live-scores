'use client'
// src/hooks/usePushNotifications.ts
// Manages Web Push subscription lifecycle.
// - subscribe: requests permission, subscribes via Push API, saves to Supabase
// - unsubscribe: removes from Push API and Supabase
// - toggle: subscribes if not subscribed, unsubscribes if subscribed

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/components/AuthProvider'
import { supabase } from '@/lib/supabase'

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

    try {
      const perm = await Notification.requestPermission()
      setPermission(perm)
      if (perm !== 'granted') return false

      const registration = await navigator.serviceWorker.ready
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY

      if (!vapidKey) {
        console.error('[Push] VAPID public key not configured')
        return false
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
      })

      const subJson = subscription.toJSON()

      const { error } = await supabase
        .from('push_subscriptions')
        .upsert({
          user_id: user.id,
          endpoint: subJson.endpoint!,
          keys: subJson.keys!,
        }, { onConflict: 'user_id,endpoint' })

      if (error) {
        console.error('[Push] Failed to save subscription:', error)
        return false
      }

      setEnabled(true)
      return true
    } catch (e) {
      console.error('[Push] Subscribe failed:', e)
      return false
    }
  }, [user, supported])

  const unsubscribe = useCallback(async () => {
    if (!user || !supported) return

    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()

      if (subscription) {
        const endpoint = subscription.endpoint

        await subscription.unsubscribe()

        await supabase
          .from('push_subscriptions')
          .delete()
          .eq('user_id', user.id)
          .eq('endpoint', endpoint)
      }

      setEnabled(false)
    } catch (e) {
      console.error('[Push] Unsubscribe failed:', e)
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

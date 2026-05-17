'use client'
// src/hooks/usePushNotifications.ts
// Manages push subscription lifecycle across BOTH transports:
//   - Web Push (browser PWA): pushManager + serviceWorker + push_subscriptions
//   - Native FCM (Capacitor Android app): @capacitor/push-notifications +
//     native_push_subscriptions table
//
// Why the split: Capacitor's Android WebView doesn't ship Web Push, so the
// Web APIs (PushManager, Notification) report unsupported even when FCM is
// happily delivering pushes via the native side. Pre-fix (2026-05-10), the
// hook only knew about Web Push, so the settings master toggle was disabled
// for users on the Play Store app even though they were receiving pushes.
//
// Public surface is unchanged: { enabled, supported, permission, toggle,
// subscribe, unsubscribe }. Consumers don't need to know about transport.

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/components/AuthProvider'
import { Capacitor } from '@capacitor/core'
import { cacheFcmToken, postFcmToken } from '@/lib/persist-fcm-token'

// Same key the rest of the app uses (see persist-fcm-token.ts).
const FCM_TOKEN_STORAGE_KEY = 'padelnachos:fcm-token'

// @capacitor-firebase/messaging is the same plugin native-init.ts uses
// for boot-time registration. We lazy-import it inside the native code
// paths so the web bundle never sees the Firebase web SDK transitively
// pulled in by its web-fallback file (which would otherwise crash the
// Turbopack build at module-resolution time).

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from(rawData, (char) => char.charCodeAt(0))
}

// Capacitor's permission state uses a different vocabulary
// ('granted' | 'denied' | 'prompt' | 'prompt-with-rationale') than the Web
// Notification API ('granted' | 'denied' | 'default'). Map onto the Web shape
// so the rest of the app (and the Web Push branch below) can treat them
// uniformly. 'prompt' / 'prompt-with-rationale' both fold into 'default'.
function mapNativePermission(
  receive: 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale',
): NotificationPermission {
  if (receive === 'granted') return 'granted'
  if (receive === 'denied') return 'denied'
  return 'default'
}

export function usePushNotifications() {
  const { user } = useAuth()
  const [enabled, setEnabled] = useState(false)
  // Lazy-initialize all the synchronous values at first client render so
  // we never call setState inside useEffect (`react-hooks/set-state-in-effect`)
  // and keep SSR safe (typeof window check runs only on the client).
  // Capacitor doesn't switch between native and web after boot, and the
  // Web APIs we probe are present-or-absent at load time, so these values
  // are stable for the session.
  const [isNative] = useState(
    () => typeof window !== 'undefined' && Capacitor.isNativePlatform(),
  )
  const [supported] = useState(() => {
    if (typeof window === 'undefined') return false
    // Native: FCM is delivered by Android — always supported on this transport.
    if (Capacitor.isNativePlatform()) return true
    // Web Push: requires the trio of APIs.
    return (
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    )
  })
  // Initial permission value: sync-readable on web; native uses an async
  // plugin call so it stays 'default' here and is updated in the effect.
  // Both branches re-set permission later when the user clicks subscribe
  // (Notification.requestPermission / PushNotifications.requestPermissions).
  const [permission, setPermission] = useState<NotificationPermission>(() => {
    if (typeof window === 'undefined') return 'default'
    if (Capacitor.isNativePlatform()) return 'default'
    if ('Notification' in window) return Notification.permission
    return 'default'
  })

  useEffect(() => {
    let cancelled = false

    if (isNative) {
      // ── Native (Capacitor / FCM) ──────────────────────────────────
      // Permission state comes from Capacitor's plugin (which wraps the
      // OS-level permission). Subscription state is queried from the
      // server because the device token is opaque to JS until the next
      // registration event fires.
      void import('@capacitor-firebase/messaging').then(({ FirebaseMessaging }) => {
        return FirebaseMessaging.checkPermissions().then((p) => {
          if (cancelled) return
          setPermission(mapNativePermission(p.receive))
        })
      })
      if (user) {
        void fetch('/api/user/native-push-subscriptions', { cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : { subscribed: false }))
          .then((b: { subscribed: boolean }) => {
            if (!cancelled) setEnabled(!!b.subscribed)
          })
          .catch(() => { /* silent */ })
      }
    } else if (supported && user) {
      // ── Web Push ─────────────────────────────────────────────────
      // permission was already lazy-initialized from Notification.permission;
      // here we only need to probe the active subscription.
      navigator.serviceWorker.ready.then(async (registration) => {
        const subscription = await registration.pushManager.getSubscription()
        if (!cancelled) setEnabled(!!subscription)
      })
    }

    return () => { cancelled = true }
  }, [user, isNative, supported])

  // ── Native subscribe/unsubscribe ────────────────────────────────────
  // Subscribe: ask iOS/Android for notification permission, then pull the
  // FCM token directly via FirebaseMessaging.getToken() and POST it
  // ourselves. We previously delegated this to native-init's plugin event
  // listener, but that left a race window where the toggle would optimistically
  // flip on without ever landing a DB row (no listener = silent drop).
  // Doing the get+post inline guarantees the row exists before the toggle
  // settles. UPSERT on the server side makes duplicate POSTs harmless.
  const subscribeNative = useCallback(async () => {
    if (!user) return false
    try {
      const { FirebaseMessaging } = await import('@capacitor-firebase/messaging')
      const perm = await FirebaseMessaging.requestPermissions()
      const mapped = mapNativePermission(perm.receive)
      setPermission(mapped)
      if (mapped !== 'granted') return false

      const { token } = await FirebaseMessaging.getToken()
      cacheFcmToken(token)
      const ok = await postFcmToken(token)
      setEnabled(ok)
      return ok
    } catch (e) {
      console.error('[Push native] subscribe failed:', e)
      setEnabled(false)
      return false
    }
  }, [user])

  // Unsubscribe: DELETE the cached token's row server-side. Capacitor's
  // plugin doesn't expose an unregister method on Android, so we leave the
  // OS-level FCM registration in place and just stop our fan-out from
  // targeting it. Re-subscribing later re-creates the row via register().
  // If the token isn't in localStorage (e.g. cache cleared), we fall back
  // to a re-probe via GET — the user may need to toggle off again to fully
  // clean up, but this won't lie about the state.
  const unsubscribeNative = useCallback(async () => {
    if (!user) return
    setEnabled(false)
    try {
      const token = typeof window !== 'undefined'
        ? window.localStorage.getItem(FCM_TOKEN_STORAGE_KEY)
        : null
      if (!token) {
        // No cached token — server still owns the row but we can't target
        // it specifically. Re-probe so UI matches reality.
        const res = await fetch('/api/user/native-push-subscriptions', { cache: 'no-store' })
        if (res.ok) {
          const b = await res.json() as { subscribed: boolean }
          setEnabled(!!b.subscribed)
        }
        return
      }
      await fetch('/api/user/native-push-subscriptions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceToken: token }),
      })
      try { window.localStorage.removeItem(FCM_TOKEN_STORAGE_KEY) } catch { /* non-fatal */ }
    } catch (e) {
      console.error('[Push native] unsubscribe failed:', e)
      // Re-probe so we don't lie about a partial teardown.
      try {
        const res = await fetch('/api/user/native-push-subscriptions', { cache: 'no-store' })
        if (res.ok) {
          const b = await res.json() as { subscribed: boolean }
          setEnabled(!!b.subscribed)
        }
      } catch { /* leave as false */ }
    }
  }, [user])

  // ── Web Push subscribe/unsubscribe (unchanged from pre-fix) ─────────
  const subscribeWeb = useCallback(async () => {
    if (!user || !supported) return false

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
      console.error('[Push] Subscribe failed:', e)
      setEnabled(false)
      return false
    }
  }, [user, supported])

  const unsubscribeWeb = useCallback(async () => {
    if (!user || !supported) return

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
      console.error('[Push] Unsubscribe failed:', e)
      try {
        const registration = await navigator.serviceWorker.ready
        const subscription = await registration.pushManager.getSubscription()
        setEnabled(!!subscription)
      } catch { /* leave as false */ }
    }
  }, [user, supported])

  // ── Transport dispatch ──────────────────────────────────────────────
  const subscribe = useCallback(
    () => (isNative ? subscribeNative() : subscribeWeb()),
    [isNative, subscribeNative, subscribeWeb],
  )

  const unsubscribe = useCallback(
    () => (isNative ? unsubscribeNative() : unsubscribeWeb()),
    [isNative, unsubscribeNative, unsubscribeWeb],
  )

  const toggle = useCallback(async () => {
    if (enabled) {
      await unsubscribe()
    } else {
      await subscribe()
    }
  }, [enabled, subscribe, unsubscribe])

  return { enabled, supported, permission, toggle, subscribe, unsubscribe }
}

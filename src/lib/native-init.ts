// src/lib/native-init.ts
// Initializes Capacitor plugins on app boot. Safe to call from a
// browser context — Capacitor's plugins are no-ops when running on
// web (Capacitor.isNativePlatform() returns false). Call once from
// a top-level client mount.

import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { SplashScreen } from '@capacitor/splash-screen'
import { StatusBar, Style } from '@capacitor/status-bar'

let initialized = false

export async function initNative(): Promise<void> {
  if (initialized || !Capacitor.isNativePlatform()) return
  initialized = true

  // Match the page header's background so there's no visible band
  // between the OS status bar and the app's sticky header.
  try {
    await StatusBar.setStyle({ style: Style.Dark })
    await StatusBar.setBackgroundColor({ color: '#0A0A0A' })
  } catch (err) {
    console.warn('[native-init] StatusBar setup failed', err)
  }

  // Hide splash once React's first paint is committed (~1 frame after mount).
  // Capacitor's SplashScreen plugin keeps it visible until we explicitly
  // hide; without this call, splash sticks around until launchShowDuration
  // (1500ms in capacitor.config.ts) regardless of how fast the page loads.
  try {
    await new Promise(r => requestAnimationFrame(r))
    await SplashScreen.hide()
  } catch (err) {
    console.warn('[native-init] SplashScreen.hide failed', err)
  }

  // Hardware back button handling: navigate web router history when
  // possible, otherwise close the app. Capacitor's WebView already
  // triggers `history.back()` by default; we register an explicit
  // listener so the behaviour is owned at this layer — keeps it
  // discoverable, lets us add page-aware overrides later (e.g. close
  // a modal first), and survives any plugin that races to register
  // its own backButton handler. The `initialized` flag guard above
  // makes this a no-op on subsequent mounts; in dev with Fast Refresh
  // the module re-evaluates and a second listener can stack — only a
  // dev-mode quirk, harmless in production builds.
  try {
    App.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) {
        window.history.back()
      } else {
        void App.exitApp()
      }
    })
  } catch (err) {
    console.warn('[native-init] App backButton listener failed', err)
  }

  // Deep link handler: when an https://padelnachos.com URL arrives via
  // Android App Links (or iOS Universal Links, future), route the WebView
  // to the path so OAuth callbacks, magic-link emails, and shared match
  // URLs all land inside the app instead of bouncing out to Chrome.
  try {
    App.addListener('appUrlOpen', ({ url }) => {
      try {
        const parsed = new URL(url)
        if (parsed.host !== 'padelnachos.com') return
        const path = parsed.pathname + parsed.search + parsed.hash
        window.location.href = path || '/'
      } catch {
        // malformed URL — ignore silently
      }
    })
  } catch (err) {
    console.warn('[native-init] App.appUrlOpen listener failed', err)
  }

  // Push notifications: register the device with FCM (Android) / APNs
  // (iOS, future), POST the resulting token to our backend so the
  // /api/push/notify fan-out can target this device. Tap routing: when
  // the user taps a notification, deep-link via window.location to the
  // URL embedded in the notification's data payload.
  try {
    const perm = await PushNotifications.requestPermissions()
    if (perm.receive === 'granted') {
      await PushNotifications.register()
    }

    PushNotifications.addListener('registration', async (token) => {
      try {
        await fetch('/api/user/native-push-subscriptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platform: Capacitor.getPlatform(), // 'android' | 'ios'
            deviceToken: token.value,
            locale: navigator.language?.split('-')[0] || 'en',
          }),
        })
      } catch (err) {
        console.warn('[native-init] push register POST failed', err)
      }
    })

    PushNotifications.addListener('registrationError', (err) => {
      console.warn('[native-init] push registration error', err)
    })

    // When user taps a notification, route the WebView to the deep link
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const url = action.notification.data?.url
      if (typeof url === 'string' && url.startsWith('/')) {
        window.location.href = url
      }
    })
  } catch (err) {
    console.warn('[native-init] PushNotifications setup failed', err)
  }
}

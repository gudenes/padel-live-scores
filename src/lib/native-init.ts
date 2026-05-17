// src/lib/native-init.ts
// Initializes Capacitor plugins on app boot. Safe to call from a
// browser context — Capacitor's plugins are no-ops when running on
// web (Capacitor.isNativePlatform() returns false). Call once from
// a top-level client mount.

import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { FirebaseMessaging } from '@capacitor-firebase/messaging'
import { SplashScreen } from '@capacitor/splash-screen'
import { StatusBar, Style } from '@capacitor/status-bar'
import { cacheFcmToken, postFcmToken } from '@/lib/persist-fcm-token'

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

  // Splash dismissal: wait for first paint AND a minimum brand-moment
  // (1500ms after first paint) before hiding. This guarantees:
  //  - We never reveal a half-rendered React tree (the rAF wait covers that)
  //  - The splash always shows for a noticeable beat, even on fast networks
  //    where the WebView would otherwise paint in <500ms and the brand
  //    would barely register
  // launchShowDuration in capacitor.config.ts is the upper bound; this is
  // the lower bound. The splash is visible for max(rAF + 1500ms, 0) and
  // capped at launchShowDuration if launchAutoHide kicks in first.
  try {
    await new Promise(r => requestAnimationFrame(r))
    await new Promise(r => setTimeout(r, 1500))
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
  // Android App Links or iOS Universal Links, route the WebView to the
  // path so OAuth callbacks, magic-link emails, and shared match URLs
  // all land inside the app instead of bouncing out to Chrome/Safari.
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

  // Push notifications: @capacitor-firebase/messaging delivers FCM tokens
  // on BOTH platforms. On Android the Firebase Cloud Messaging SDK is the
  // native messaging layer (token format unchanged from the previous
  // @capacitor/push-notifications setup — same Firebase project, same
  // app instance, same FCM token). On iOS, the AppDelegate registers
  // with APNs and Firebase exchanges that token for an FCM token, which
  // this plugin surfaces here. Server-side fan-out (/api/push/notify)
  // ships a single firebase-admin send() call per token and doesn't
  // care which platform produced it.
  try {
    const perm = await FirebaseMessaging.requestPermissions()
    if (perm.receive !== 'granted') {
      console.info('[native-init] push permission not granted:', perm.receive)
      return
    }

    // getToken() triggers the native registration on both platforms and
    // also wires up the 'tokenReceived' event for future refreshes.
    // Android: returns immediately with the cached FCM token.
    // iOS: blocks briefly while APNs registration completes, then
    // returns the FCM token derived from the APNs device token.
    try {
      const { token } = await FirebaseMessaging.getToken()
      await persistDeviceToken(token)
    } catch (err) {
      console.warn('[native-init] FirebaseMessaging.getToken failed', err)
    }

    // Token rotates periodically (every ~few weeks per device, or when
    // user reinstalls). Re-persist when that happens.
    await FirebaseMessaging.addListener('tokenReceived', async ({ token }) => {
      await persistDeviceToken(token)
    })

    // When user taps a notification, route the WebView to the deep link
    // embedded in the data payload. FirebaseMessaging types `data` as
    // `{}` (any unknown keys), so cast through `Record<string, unknown>`
    // to read our app-specific `url` field.
    await FirebaseMessaging.addListener('notificationActionPerformed', (event) => {
      const data = event.notification.data as Record<string, unknown> | undefined
      const url = data?.url
      if (typeof url === 'string' && url.startsWith('/')) {
        window.location.href = url
      }
    })
  } catch (err) {
    console.warn('[native-init] FirebaseMessaging setup failed', err)
  }
}

/**
 * Cache + POST a freshly minted device token. Caching lets the
 * usePushNotifications hook DELETE the exact subscription when the
 * user toggles push off in settings, without a separate "list my
 * devices" round-trip. If the POST fails (most commonly because the
 * user isn't signed in yet at app-boot time), AuthProvider re-runs
 * postFcmToken once the auth session loads — see persistCachedFcmToken.
 */
async function persistDeviceToken(token: string): Promise<void> {
  cacheFcmToken(token)
  await postFcmToken(token)
}

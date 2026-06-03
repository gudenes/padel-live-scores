// src/lib/native-init.ts
// Initializes Capacitor plugins on app boot. Safe to call from a
// browser context — Capacitor's plugins are no-ops when running on
// web (Capacitor.isNativePlatform() returns false). Call once from
// a top-level client mount.

import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { SplashScreen } from '@capacitor/splash-screen'
import { StatusBar, Style } from '@capacitor/status-bar'
import { cacheFcmToken, postFcmToken } from '@/lib/persist-fcm-token'
import { recordAppOpen, requestReviewForReason } from '@/lib/app-review'

// @capacitor-firebase/messaging has a web-side implementation that
// imports `firebase/messaging` from the Firebase web SDK. We don't
// install the web SDK (we only use this plugin on native, where it
// hits the Firebase iOS/Android SDKs bundled in the Capacitor host).
// Importing it statically here breaks the web bundle with
// "Module not found: Can't resolve 'firebase/messaging'".
// Lazy-import it inside the native-only code path so the web bundle
// never sees it.

let initialized = false

export async function initNative(): Promise<void> {
  if (initialized || !Capacitor.isNativePlatform()) return
  initialized = true

  // In-app review: count this native boot, then (gated) maybe ask for a
  // rating. requestReviewForReason no-ops unless the gate allows it, so
  // this is safe to call on every launch. Fire-and-forget.
  recordAppOpen()
  void requestReviewForReason('app_opens')

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

  // AdMob: initialize the SDK + run the consent / ATT flow. Placed before
  // the push block because that block can `return` early (when push
  // permission is denied) — kicking AdMob off here guarantees it runs
  // regardless. Fire-and-forget; never blocks boot.
  void initAdMob()

  // Push notifications: route through loadPushPlugin() so the boot path
  // also works on AABs older than 2026-05-17 (before
  // @capacitor-firebase/messaging was wired into android/). Those users
  // auto-register via the legacy @capacitor/push-notifications plugin —
  // no Play Store update required to restore push delivery.
  //
  // Server-side fan-out (/api/push/notify) sends a single firebase-admin
  // call per token regardless of which plugin produced it; both plugins
  // register with the same Firebase project so token shape and delivery
  // path are identical. On iOS, only the modern plugin is available
  // (no legacy fallback in the iOS AAB), which is fine — that's the
  // platform the migration was for.
  try {
    const { loadPushPlugin } = await import('@/lib/push-plugin')
    const plugin = await loadPushPlugin()
    console.info(`[native-init] push plugin kind=${plugin.kind}`)

    const perm = await plugin.requestPermissions()
    if (perm !== 'granted') {
      console.info('[native-init] push permission not granted:', perm)
      return
    }

    try {
      const token = await plugin.getToken()
      await persistDeviceToken(token)
    } catch (err) {
      console.warn(`[native-init] getToken failed (kind=${plugin.kind})`, err)
    }

    // Wire token-refresh + notification-tap listeners only on the modern
    // plugin. The legacy plugin has equivalent events but slightly
    // different shapes; loading its module again just to attach handlers
    // (when this side of the branch only runs on fresh AABs anyway)
    // isn't worth the extra chunk. Old-AAB users miss auto-token-refresh
    // handling — acceptable tradeoff since Android FCM tokens rotate
    // rarely and the Settings toggle re-subscribe picks up a fresh token
    // on demand. They'll get the listeners once we ship a new AAB.
    if (plugin.kind === 'firebase') {
      const { FirebaseMessaging } = await import('@capacitor-firebase/messaging')
      await FirebaseMessaging.addListener('tokenReceived', async ({ token }) => {
        await persistDeviceToken(token)
      })
      await FirebaseMessaging.addListener('notificationActionPerformed', (event) => {
        const data = event.notification.data as Record<string, unknown> | undefined
        const url = data?.url
        if (typeof url === 'string' && url.startsWith('/')) {
          window.location.href = url
        }
      })
    }
  } catch (err) {
    console.warn('[native-init] push setup failed', err)
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

// AdMob: initialize the SDK, run the UMP consent flow (required for EEA),
// then the iOS ATT prompt. Lazy-imported so the plugin never enters the web
// bundle (mirrors the Firebase messaging pattern documented at the top of
// this file). All steps best-effort — never block app boot.
async function initAdMob(): Promise<void> {
  try {
    const { AdMob, AdmobConsentStatus } = await import('@capacitor-community/admob')
    await AdMob.initialize({ initializeForTesting: false })

    // UMP (GDPR / EEA). Show the consent form when one is required + available.
    try {
      const info = await AdMob.requestConsentInfo()
      if (info.isConsentFormAvailable && info.status === AdmobConsentStatus.REQUIRED) {
        await AdMob.showConsentForm()
      }
    } catch (err) {
      console.log('[AdMob] consent flow skipped:', err)
    }

    // iOS App Tracking Transparency — sequenced after UMP. No-op on Android.
    try {
      await AdMob.requestTrackingAuthorization()
    } catch (err) {
      console.log('[AdMob] ATT skipped:', err)
    }
  } catch (err) {
    console.log('[AdMob] init failed:', err)
  }
}

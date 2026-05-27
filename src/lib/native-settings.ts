// src/lib/native-settings.ts
//
// Opens the OS notification-settings page for PadelNachos. Used by:
//   - settings page's permission-blocked banner CTA
//   - settings page's "Notification sounds" deep-link row (only rendered on native)
//   - bookmark nudge's os-blocked state CTA
//
// Native (Android/iOS via Capacitor): jumps directly to the app's
// notification settings — one tap to the right screen.
//
// Web fallback: there's no cross-browser deep-link to OS-level notification
// settings. We surface a browser-native alert with instructions so the user
// knows where to go — better than the previous silent no-op. Components that
// want toast-style feedback instead can check the return value (false on web).

import { Capacitor } from '@capacitor/core'

/**
 * Returns true if the native deep-link opened, false if we fell back to the
 * web alert (so callers can choose to also surface a toast). The Promise
 * resolves after the alert is dismissed on web, or immediately after the
 * native intent is dispatched on Android/iOS.
 */
export async function openSystemNotificationSettings(): Promise<boolean> {
  if (typeof window !== 'undefined' && !Capacitor.isNativePlatform()) {
    // Web (desktop or Capacitor-less mobile browser). The best a web page can
    // do is tell the user where to find browser-level notification settings —
    // there's no reliable cross-browser deep-link.
    const isChrome = /Chrome|Chromium/.test(navigator.userAgent) && !/Edg/.test(navigator.userAgent)
    const isFirefox = /Firefox/.test(navigator.userAgent)
    const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent)

    let path: string
    if (isChrome) path = 'Settings → Privacy and security → Site Settings → Notifications'
    else if (isFirefox) path = 'Settings → Privacy & Security → Permissions → Notifications'
    else if (isSafari) path = 'Safari menu → Settings → Websites → Notifications'
    else path = 'your browser settings → site / notification permissions'

    window.alert(`To manage notifications for PadelNachos, open your browser settings:\n\n${path}`)
    return false
  }

  try {
    const { NativeSettings, AndroidSettings, IOSSettings } = await import('capacitor-native-settings')
    await NativeSettings.open({
      optionAndroid: AndroidSettings.AppNotification,
      optionIOS: IOSSettings.App,
    })
    return true
  } catch (err) {
    console.warn('[native-settings] open failed', err)
    return false
  }
}

/**
 * Boolean used by UI components that should hide native-only affordances
 * (e.g. the "Notification sounds" row, which has no equivalent on web —
 * sounds are managed by the OS notification channel system on Android).
 */
export function isNativeRuntime(): boolean {
  if (typeof window === 'undefined') return false
  return Capacitor.isNativePlatform()
}

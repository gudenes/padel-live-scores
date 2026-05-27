// src/lib/native-settings.ts
//
// Opens the OS notification-settings page for PadelNachos. Used by:
//   - settings page's permission-blocked banner CTA
//   - settings page's "Notification sounds" deep-link row
//   - bookmark nudge's os-blocked state CTA
//
// Native (Android/iOS via Capacitor): jumps directly to the app's
// notification settings — one tap to the right screen.
//
// Web fallback: there's no cross-browser deep-link to OS-level
// notification settings. We log a warning and return — callers should
// ideally show a toast, but this lib stays pure.

import { Capacitor } from '@capacitor/core'

export async function openSystemNotificationSettings(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    console.info('[native-settings] web platform — no deep-link available; user must use browser site settings')
    return
  }

  try {
    const { NativeSettings, AndroidSettings, IOSSettings } = await import('capacitor-native-settings')
    await NativeSettings.open({
      optionAndroid: AndroidSettings.AppNotification,
      optionIOS: IOSSettings.App,
    })
  } catch (err) {
    console.warn('[native-settings] open failed', err)
  }
}

// src/lib/native-init.ts
// Initializes Capacitor plugins on app boot. Safe to call from a
// browser context — Capacitor's plugins are no-ops when running on
// web (Capacitor.isNativePlatform() returns false). Call once from
// a top-level client mount.

import { Capacitor } from '@capacitor/core'
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
}

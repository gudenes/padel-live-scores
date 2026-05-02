// src/lib/native-init.ts
// Initializes Capacitor plugins on app boot. Safe to call from a
// browser context — Capacitor's plugins are no-ops when running on
// web (Capacitor.isNativePlatform() returns false). Call once from
// a top-level client mount.

import { Capacitor } from '@capacitor/core'
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
}

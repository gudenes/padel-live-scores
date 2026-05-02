// src/lib/native-init.ts
// Initializes Capacitor plugins on app boot. Safe to call from a
// browser context — Capacitor's plugins are no-ops when running on
// web (Capacitor.isNativePlatform() returns false). Call once from
// a top-level client mount.

import { App } from '@capacitor/app'
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
}

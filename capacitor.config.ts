import type { CapacitorConfig } from '@capacitor/cli'

// Capacitor app config — drives both Android Studio and Xcode projects
// when they're added in Phase 2b/2c. Bundle ID + app name are
// PERMANENT after first store submission; do not change once apps
// have shipped.
//
// `server.url` puts Capacitor in remote-URL mode: the WebView loads
// the live Vercel deploy at every app open instead of bundling a web
// build. Trade-off: requires network on first launch, but auto-updates
// without store re-review and keeps web/app in lockstep. See
// docs/superpowers/specs/2026-05-02-mobile-apps-capacitor-design.md
// for the full rationale.

const config: CapacitorConfig = {
  appId: 'com.padelnachos.app',
  appName: 'Padel Nachos',
  webDir: 'public',
  server: {
    url: 'https://padelnachos.com',
    androidScheme: 'https',
    cleartext: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: '#1A1A1A',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0A0A0A',
    },
  },
}

export default config

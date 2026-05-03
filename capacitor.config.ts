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
      // Show for 2.5s minimum so the brand moment lands; if WebView
      // first-paint is faster, we extend until launchShowDuration so
      // the splash doesn't flicker out instantly. Hide is still
      // automatic — set launchAutoHide:false if we want to control
      // dismissal entirely from JS.
      launchShowDuration: 2500,
      launchFadeOutDuration: 300,
      launchAutoHide: true,
      // Black brand background — matches the splash.png canvas so there's
      // no flash between Android's pre-WebView splash and the splash image
      // itself, and no flash between splash hide and the WebView's first
      // paint while the page loads.
      backgroundColor: '#000000',
      androidSplashResourceName: 'splash',
      // FIT_CENTER preserves the asset's aspect ratio and never crops.
      // The asset is pre-composed at 1080×2400 (designed in-tool), so we
      // want WYSIWYG. On phones with a different aspect ratio than the
      // asset, FIT_CENTER letterboxes — invisible because the asset's
      // background and `backgroundColor` above are both pure black.
      androidScaleType: 'FIT_CENTER',
      // Show a small lime spinner over the splash so users know it's
      // loading rather than frozen, especially on slow networks.
      showSpinner: true,
      androidSpinnerStyle: 'large',
      spinnerColor: '#7ED321',
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

// src/components/SplashOverlay.tsx
//
// Server-rendered splash overlay shown until the app's first frame
// paints. Replaces the dated iOS UIActivityIndicator that previously
// appeared on top of the native splash logo (see capacitor.config.ts
// `showSpinner: false`).
//
// Architecture:
//   1. Native Capacitor SplashScreen shows the static splash IMAGE for
//      `launchShowDuration` (2500ms). No native spinner.
//   2. Native splash hides, WebView becomes visible.
//   3. The server-rendered HTML below is already painted at the top of
//      <body>. It mirrors the native splash visually (same logo, same
//      background, same vertical layout) so the transition is seamless.
//      Below the logo: a Material-style spinning arc in lime green.
//   4. Inline script fires on window 'load' (or immediately if already
//      complete) → adds `.hidden` class → CSS opacity transitions to 0
//      over 400ms → element is removed from DOM.
//
// Why a server-rendered overlay rather than a React/client component:
//   The overlay must be visible the instant the WebView paints — before
//   any React hydration. A React component wouldn't render until after
//   hydration, leaving a flash of empty page first.
//
// Why an inline <script> rather than calling from native-init.ts:
//   native-init waits on Capacitor import + auth state + first React
//   render. By that time we want the overlay GONE, not just queued for
//   removal. A no-dependencies inline script runs as soon as the DOM
//   finishes parsing, which is when the splash should clear.
//
// Affects iOS Capacitor, Android Capacitor, AND the standard web
// (PWA / mobile Safari). Single implementation, three platforms.

export default function SplashOverlay() {
  return (
    <>
      <div id="splash-overlay" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="splash-overlay-logo"
          /* Same image used for the native splash. Copied to a clean
             root-level path (public/splash-logo.png) because Vercel
             returns 404 for URL-encoded paths containing spaces — the
             original lives at "public/padelNachos - Branding/favicon/
             splash.screen.png" but that path is unservable in prod
             (verified with curl after the first deploy). The master is
             still that branding file; this is just a deployable copy. */
          src="/splash-logo.png"
          alt=""
          fetchPriority="high"
        />
        <div className="splash-overlay-arc" />
      </div>
      <script
        dangerouslySetInnerHTML={{
          __html: `
            (function () {
              function hide() {
                var el = document.getElementById('splash-overlay');
                if (!el) return;
                el.classList.add('hidden');
                // Do NOT removeChild — manually mutating the DOM under React
                // confuses reconciliation and breaks any later updates with
                // NotFoundError ("node to be removed is not a child of this
                // node") and "Rendered more hooks" cascade. Production
                // outage on 2026-05-17 surfaced this. CSS-only hiding
                // (visibility:hidden + opacity:0 + pointer-events:none in
                // globals.css) keeps the node in the tree where React
                // expects it; the overlay is invisible to users + ignored
                // by hit-testing once .hidden is applied.
              }
              // Hide ~150ms after window 'load' so first paint of the app
              // is visible underneath BEFORE the overlay fades out. The
              // tiny delay also lets a CSS animation frame complete.
              if (document.readyState === 'complete') {
                setTimeout(hide, 150);
              } else {
                window.addEventListener('load', function () {
                  setTimeout(hide, 150);
                });
              }
            })();
          `,
        }}
      />
    </>
  )
}

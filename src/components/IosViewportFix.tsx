// src/components/IosViewportFix.tsx
//
// Fixes the "first cold launch renders zoomed in, force-quit + reopen
// fixes it" bug on the Capacitor iOS app.
//
// Root cause:
//   The app runs in Capacitor remote-URL mode (capacitor.config.ts →
//   server.url), so the WKWebView loads padelnachos.com over the network
//   at launch while the full-screen immersive native splash is up. With
//   `viewport-fit=cover` (layout.tsx Viewport export) the WebView's width
//   depends on the safe-area insets, which are still being established by
//   the native view hierarchy on a cold launch. WKWebView resolves
//   `width=device-width` against the WebView frame AT FIRST LAYOUT — if
//   that frame isn't its final on-screen size yet, device-width locks to
//   the wrong CSS-pixel count and the page is scaled up to fill the final
//   (larger) frame → everything looks zoomed in. The wrong-scale paint
//   happens UNDER the splash, so it's baked in by the time the splash
//   fades. Because the viewport intentionally allows pinch-zoom (no
//   maximum-scale / user-scalable=no, see globals.css), the wrong scale
//   is never auto-corrected; only a full reload (= relaunch) resets it.
//   That's the "close and reopen" workaround users discovered.
//
// Fix:
//   When the WebView frame settles to its final size (which fires a
//   `visualViewport` resize around splash dismissal), re-write the
//   viewport <meta> with a momentary `maximum-scale=1`. Re-parsing the
//   viewport against the now-correct frame forces WebKit to recompute the
//   layout viewport AND clamps any stuck zoom back to scale 1. We restore
//   the original content on the next frames so pinch-to-zoom stays
//   enabled. `viewport-fit=cover` is preserved in both states so the
//   safe-area insets never momentarily collapse.
//
// Scope:
//   Gated to the native iOS Capacitor WebView only (window.Capacitor is
//   injected at document-start in remote-URL mode). Mobile Safari / PWA /
//   desktop are untouched — they don't hit the cold-launch frame race and
//   we don't want to flicker their pinch-zoom state.
//
// Why an inline server-rendered <script> (mirrors SplashOverlay):
//   It must run before React hydration and without waiting on the
//   Capacitor JS import, so the re-assert is armed the instant the WebView
//   begins painting under the splash.

export default function IosViewportFix() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `
          (function () {
            var C = window.Capacitor;
            if (!C || typeof C.getPlatform !== 'function' || C.getPlatform() !== 'ios') return;

            var vp = document.querySelector('meta[name="viewport"]');
            if (!vp) return;
            var original = vp.getAttribute('content');
            // Same viewport but with the zoom pinned to 1 — re-parsing this
            // against the current frame recomputes device-width and clamps
            // any stuck zoom. viewport-fit=cover kept so safe areas hold.
            var pinned = 'width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1, user-scalable=no';

            function reassert() {
              if (vp.getAttribute('content') !== original) return; // mid-toggle
              vp.setAttribute('content', pinned);
              // Two frames so WebKit applies the pinned viewport before we
              // restore the pinch-zoom-enabled original.
              requestAnimationFrame(function () {
                requestAnimationFrame(function () {
                  vp.setAttribute('content', original);
                });
              });
            }

            // The frame settling to its final size (status bar / safe areas
            // resolved, splash dismissed) fires visualViewport 'resize' —
            // that's the precise moment the wrong scale needs correcting.
            var vv = window.visualViewport;
            if (vv) {
              vv.addEventListener('resize', reassert);
              // Stop listening once the cold-launch settle window is past so
              // we don't fight a user's intentional pinch later.
              setTimeout(function () { vv.removeEventListener('resize', reassert); }, 4000);
            }

            // Fallbacks: if the frame was already final (no resize fired),
            // these still correct a stuck scale. No-ops when scale is 1.
            window.addEventListener('load', reassert);
            setTimeout(reassert, 2600); // just after the 2500ms native splash hide
          })();
        `,
      }}
    />
  )
}

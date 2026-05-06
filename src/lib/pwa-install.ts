// iOS PWA install nudge helpers.
//
// On iOS, Web Push only works inside an installed PWA (added to home
// screen + opened via the icon → display-mode: standalone). All iOS
// browsers (Safari, Chrome iOS / CriOS, Firefox iOS / FxiOS, Edge iOS /
// EdgiOS) are forced to use WebKit, so they all hit the same restriction.
//
// `isIOSSafariTab()` returns true for the platforms that need our
// install nudge: iPhone/iPad in a regular browser tab. It returns
// false everywhere else, including iOS PWA standalone (push works
// natively there) and all non-iOS platforms.

export function isIOSSafariTab(): boolean {
  if (typeof window === 'undefined') return false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav = (typeof navigator !== 'undefined' ? navigator : w.navigator) as any
  if (!nav) return false
  const ua = typeof nav.userAgent === 'string' ? nav.userAgent : ''
  const isIOS = /iPad|iPhone|iPod/.test(ua)
  if (!isIOS) return false
  // Webkit-forced iOS browsers all need the same install nudge.
  const isWebKitBrowser = /Safari/.test(ua) || /CriOS|FxiOS|EdgiOS/.test(ua)
  if (!isWebKitBrowser) return false
  // Already installed as PWA → push works; no nudge needed.
  // Two ways iOS surfaces standalone mode (legacy + standard).
  const standaloneLegacy = nav.standalone === true
  const standaloneCss =
    typeof w.matchMedia === 'function' &&
    w.matchMedia('(display-mode: standalone)').matches
  if (standaloneLegacy || standaloneCss) return false
  return true
}

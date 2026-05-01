'use client'

// src/components/NavigationTransitionProvider.tsx
//
// Wires the slide-from-right transition into the app by:
//   1. Tagging the navigation direction on `<html data-direction>`
//   2. Wrapping the resulting `router.push` in
//      `document.startViewTransition(...)` so the CSS keyframes in
//      globals.css have something to animate.
//
// Why a manual wrap (vs. Next.js 16's experimental.viewTransition flag):
//   The flag pairs with React's experimental `<ViewTransition>` JSX API
//   which only exists in `react@experimental` — we're on stable
//   `react@19.2`. The flag is a no-op for us. We bypass it by
//   intercepting drill-in Link clicks and calling
//   `document.startViewTransition` manually.
//
// Why a global capture-phase intercept instead of wrapping every Link:
//   40+ Link sites surface drill-in navigation (MatchCard, ResultCard,
//   LiveMatchCard, BracketView, TournamentSpotlightHero, …). One
//   document-level handler catches them all without per-Link changes
//   and won't drift when new components are added.
//
// Forward / back / lateral:
//   - Click an anchor whose href matches a DRILL_IN regex →
//     preventDefault, set direction=forward, call startViewTransition
//     around router.push.
//   - Browser back/forward, swipe-back, router.back() → popstate →
//     set direction=back. Can't easily wrap this in a view transition
//     (popstate fires after navigation), so back uses CSS animation
//     applied to the already-committed DOM via data-direction.
//   - Lateral (bottom-nav tabs, locale switcher, day-pill swipe) →
//     no drill-in match → direction cleared → no transition.

import { startTransition, useEffect } from 'react'
import { useRouter } from '@/i18n/navigation'

const DRILL_IN_PATTERNS: readonly RegExp[] = [
  /^(?:\/[a-z]{2})?\/match\/[^/]+/,
  /^(?:\/[a-z]{2})?\/tournaments\/[^/]+/,
  /^(?:\/[a-z]{2})?\/player\/[^/]+/,
  /^(?:\/[a-z]{2})?\/feed\/article\/[^/]+/,
  /^(?:\/[a-z]{2})?\/achievements/,
  /^(?:\/[a-z]{2})?\/profile\/settings/,
]

function isDrillInPath(path: string): boolean {
  return DRILL_IN_PATTERNS.some((re) => re.test(path))
}

interface AnchorTarget {
  pathWithLocalePrefix: string
  /** Path stripped of the optional 2-letter locale prefix. next-intl's
   *  router.push expects the locale-less form (it re-adds the prefix
   *  based on its own routing config). */
  pathForRouter: string
}

function resolveAnchor(target: EventTarget | null): AnchorTarget | null {
  if (!(target instanceof Element)) return null
  const anchor = target.closest('a')
  if (!anchor) return null
  const href = anchor.getAttribute('href')
  if (!href) return null
  if (
    href.startsWith('#') ||
    href.startsWith('javascript:') ||
    href.startsWith('mailto:')
  ) {
    return null
  }
  if (anchor.target && anchor.target !== '_self') return null

  let url: URL
  try {
    url = new URL(href, window.location.href)
  } catch {
    return null
  }
  if (url.origin !== window.location.origin) return null

  const fullPath = url.pathname + url.search + url.hash
  // Strip the leading /<locale>/ for the i18n router. The router will
  // re-apply the prefix appropriate for the current locale.
  const localePrefixMatch = fullPath.match(/^\/[a-z]{2}(?=\/|$)/)
  const pathForRouter = localePrefixMatch
    ? fullPath.slice(localePrefixMatch[0].length) || '/'
    : fullPath
  return { pathWithLocalePrefix: url.pathname, pathForRouter }
}

export function NavigationTransitionProvider() {
  const router = useRouter()

  useEffect(() => {
    const root = document.documentElement
    const supportsVT = typeof document.startViewTransition === 'function'
    const reducedMotion =
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const onClick = (e: MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      if (e.button !== 0) return
      if (e.defaultPrevented) return

      const resolved = resolveAnchor(e.target)
      if (!resolved) return

      // Same-path no-op: let it through with no transition tag. The
      // i18n router will likely no-op too.
      if (resolved.pathWithLocalePrefix === window.location.pathname) {
        delete root.dataset.direction
        return
      }

      // Lateral nav: clear the tag so CSS keyframes don't accidentally
      // fire from a stale value, and let the click default through to
      // Next.js Link's own handler (which calls router.push internally).
      if (!isDrillInPath(resolved.pathWithLocalePrefix)) {
        delete root.dataset.direction
        return
      }

      // Drill-in path. Take over: preventDefault, set the direction tag,
      // and wrap the router push in startViewTransition so the CSS
      // pseudo-element animations actually fire. On unsupported
      // browsers (Firefox) or reduced-motion users, fall through to a
      // plain push — the data-direction is still set but the keyframes
      // are no-ops.
      e.preventDefault()
      root.dataset.direction = 'forward'

      // React.startTransition tells React the route push is interruptible
      // — it keeps the OLD UI committed (with all its data) until the
      // NEW route's RSC fetch resolves, instead of flashing a Suspense
      // fallback / loading spinner in between. Pairing it with
      // document.startViewTransition means the slide doesn't begin
      // until the destination is fully rendered — no "slide-then-flash-
      // loading-then-content" stutter. The existing "Loading…" UI for
      // detail pages still shows when the fetch genuinely takes a
      // while, just no longer mid-slide.
      const doNavigate = () => {
        startTransition(() => {
          router.push(resolved.pathForRouter as never)
        })
      }

      if (!supportsVT || reducedMotion) {
        doNavigate()
        return
      }
      document.startViewTransition(() => doNavigate())
    }

    const onPopState = () => {
      // popstate fires AFTER the back navigation has already changed the
      // history state. We can only tag the direction; the visual effect
      // from this tag relies on the CSS animation applied to the
      // already-committed DOM, which is limited. Acceptable: most users
      // associate "back" with the OS-level swipe-back gesture (iOS) or
      // an instant swap (desktop / Android), so the lack of a wrapped
      // view transition on back is barely noticeable.
      root.dataset.direction = 'back'
    }

    document.addEventListener('click', onClick, true)
    window.addEventListener('popstate', onPopState)
    return () => {
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('popstate', onPopState)
    }
  }, [router])

  return null
}

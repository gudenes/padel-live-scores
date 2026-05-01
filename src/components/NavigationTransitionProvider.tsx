'use client'

// src/components/NavigationTransitionProvider.tsx
//
// Wires the slide-from-right transition into the app by:
//   1. Tagging the navigation direction on `<html data-direction>`
//   2. Wrapping the resulting `router.push` in
//      `document.startViewTransition(...)` so the CSS keyframes in
//      globals.css have something to animate.
//   3. Pausing the View Transitions API's "NEW snapshot" capture
//      until React has actually committed the new route.
//
// Why a manual wrap (vs. Next.js 16's experimental.viewTransition flag):
//   The flag pairs with React's experimental `<ViewTransition>` JSX API
//   which only exists in `react@experimental` — we're on stable
//   `react@19.2`. The flag is a no-op for us. We bypass it by
//   intercepting drill-in Link clicks and calling
//   `document.startViewTransition` manually.
//
// Why the navigation-completion promise:
//   `document.startViewTransition(callback)` waits for the callback's
//   returned promise (or the next animation frame if no promise) before
//   snapshotting the NEW state. If we just call `router.push()` and
//   return void, the browser snapshots NEW at the next frame — but
//   React hasn't committed the route change yet, so OLD === NEW and
//   the animation runs against two identical snapshots. The visible
//   result is "the current page slides over itself, then the new page
//   appears instantly" — exactly the bug 2026-05-01 user feedback
//   reported. By returning a promise that resolves on the next
//   `usePathname` change (after React commits the route), the browser
//   waits, snapshots NEW = the new route's first paint (typically the
//   shimmer skeleton from src/components/skeletons/DetailPageSkeleton.tsx),
//   and animates between OLD = list and NEW = skeleton. Content streams
//   into the skeleton afterward without animation.
//
// Why a global capture-phase intercept instead of wrapping every Link:
//   40+ Link sites surface drill-in navigation. One document-level
//   handler catches them all without per-Link changes and won't drift
//   when new components are added.
//
// Forward / back / lateral:
//   - Click an anchor whose href matches a DRILL_IN regex →
//     preventDefault, set direction=forward, call startViewTransition
//     against the i18n router with a navigation-completion promise.
//   - Browser back/forward, swipe-back, router.back() → popstate →
//     set direction=back. Can't easily wrap this in a view transition
//     (popstate fires after navigation), so back uses the CSS
//     animation applied to the already-committed DOM via data-direction.
//   - Lateral (bottom-nav tabs, locale switcher, day-pill swipe) →
//     no drill-in match → direction cleared → no transition.

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { useRouter } from '@/i18n/navigation'

const DRILL_IN_PATTERNS: readonly RegExp[] = [
  /^(?:\/[a-z]{2})?\/match\/[^/]+/,
  /^(?:\/[a-z]{2})?\/tournaments\/[^/]+/,
  /^(?:\/[a-z]{2})?\/player\/[^/]+/,
  /^(?:\/[a-z]{2})?\/feed\/article\/[^/]+/,
  /^(?:\/[a-z]{2})?\/achievements/,
  /^(?:\/[a-z]{2})?\/profile\/settings/,
]

/** Hard timeout before we give up on the navigation-completion signal
 *  and let the View Transition snapshot whatever's on screen. Real
 *  navigations commit in tens of milliseconds; this only fires if
 *  something has gone genuinely wrong (e.g. router.push silently
 *  refused to navigate). Avoids leaving the user staring at the OLD
 *  snapshot indefinitely. */
const NAV_COMPLETION_TIMEOUT_MS = 800

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
  const localePrefixMatch = fullPath.match(/^\/[a-z]{2}(?=\/|$)/)
  const pathForRouter = localePrefixMatch
    ? fullPath.slice(localePrefixMatch[0].length) || '/'
    : fullPath
  return { pathWithLocalePrefix: url.pathname, pathForRouter }
}

export function NavigationTransitionProvider() {
  const router = useRouter()
  const pathname = usePathname()

  // Holds the resolver for the most recent in-flight view transition.
  // Set when click handler kicks off a transition; cleared when
  // pathname effect fires (route committed) or the safety timeout
  // expires (something went wrong, don't hang the API).
  const pendingResolveRef = useRef<(() => void) | null>(null)

  // Resolve the pending transition the moment React commits a new
  // pathname. Two RAFs give the new route's first paint (typically
  // the shimmer skeleton) a chance to land in the DOM before we let
  // the browser snapshot — without them the snapshot can race the
  // commit and capture a transitional empty state.
  useEffect(() => {
    if (!pendingResolveRef.current) return
    let cancelled = false
    requestAnimationFrame(() => {
      if (cancelled) return
      requestAnimationFrame(() => {
        if (cancelled) return
        const resolve = pendingResolveRef.current
        if (!resolve) return
        pendingResolveRef.current = null
        resolve()
      })
    })
    return () => { cancelled = true }
  }, [pathname])

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

      // Same-path no-op.
      if (resolved.pathWithLocalePrefix === window.location.pathname) {
        delete root.dataset.direction
        return
      }

      // Lateral nav: clear the tag and let Link's default handler run.
      if (!isDrillInPath(resolved.pathWithLocalePrefix)) {
        delete root.dataset.direction
        return
      }

      // Drill-in path. Take over.
      e.preventDefault()
      root.dataset.direction = 'forward'

      if (!supportsVT || reducedMotion) {
        router.push(resolved.pathForRouter as never)
        return
      }

      // Wrap router.push in a promise that resolves once usePathname
      // observes the new route AND React has had two animation frames
      // to paint. The browser waits on this promise before snapshotting
      // NEW, so the slide animates between OLD = list and NEW = the
      // new route's first paint (skeleton or content), not against two
      // identical OLD snapshots.
      document.startViewTransition(() => {
        return new Promise<void>((resolve) => {
          // If a previous transition's resolver is still pending (rare
          // — would mean the user clicked twice in <800ms), free it
          // before installing the new one so we never leak.
          pendingResolveRef.current = null
          pendingResolveRef.current = resolve

          // Safety net: if the pathname effect somehow doesn't fire
          // (router.push silently refused, navigation was cancelled,
          // …), unblock the View Transition so the browser doesn't
          // stay frozen on the OLD snapshot.
          const timeoutId = window.setTimeout(() => {
            if (pendingResolveRef.current === resolve) {
              pendingResolveRef.current = null
              resolve()
            }
          }, NAV_COMPLETION_TIMEOUT_MS)

          // Replace the resolver with one that also clears the
          // timeout so we don't double-resolve.
          const wrappedResolve = () => {
            window.clearTimeout(timeoutId)
            resolve()
          }
          pendingResolveRef.current = wrappedResolve

          router.push(resolved.pathForRouter as never)
        })
      })
    }

    const onPopState = () => {
      // popstate fires AFTER the back navigation has already changed the
      // history state. We only tag the direction; the visible effect
      // is limited (no wrapping view transition possible after-the-fact).
      // Acceptable: most users associate "back" with the OS-level
      // swipe-back gesture (iOS) or an instant swap (desktop / Android).
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

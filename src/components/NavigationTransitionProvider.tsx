'use client'

// src/components/NavigationTransitionProvider.tsx
//
// Tags each route navigation as `forward` or `back` on
// <html data-direction>. The CSS keyframes in src/app/globals.css read
// that attribute to pick the correct slide direction.
//
// Why a global capture-phase intercept instead of wrapping every Link:
//   - 40+ Link sites surface drill-in navigation (MatchCard, ResultCard,
//     LiveMatchCard, BracketView, TournamentSpotlightHero, …). A
//     document-level click handler catches them all without per-Link
//     wrapping and without missing future components.
//
//   - Lateral surfaces (bottom-nav tabs, locale switcher, day-pill
//     swipe) are excluded by path-pattern matching: only paths matching
//     a known DRILL_IN regex set the forward direction. Any other
//     navigation gets `data-direction` cleared, which the CSS reads as
//     "no slide — let the default cross-fade run" (or, with our rules,
//     no animation at all).
//
// Direction detection:
//   - Click a Link/anchor whose href matches a DRILL_IN pattern → forward
//   - Browser back/forward (popstate) → back
//   - Any other navigation → no direction (no slide)
//
// Browser support:
//   - Chrome / Edge / Safari 18.2+ get the compositor-thread transition
//     via Next.js 16's `experimental.viewTransition` flag, which wraps
//     client-side route changes in `document.startViewTransition`.
//   - Firefox falls through to instant navigation (CSS no-op).
//   - `prefers-reduced-motion: reduce` kills the keyframes (handled in
//     globals.css), so the listeners can run unconditionally.

import { useEffect } from 'react'

// Drill-in route patterns. The leading-locale prefix is optional because
// next-intl emits both `/en/match/...` and `/match/...` depending on the
// route's localePrefix policy ('as-needed' for the default locale).
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

/**
 * Resolve the destination path for a click event's target anchor,
 * honoring same-origin + non-modified-click semantics. Returns null
 * when the click should be ignored (external link, target=_blank,
 * modifier key held, anchor without href, …).
 */
function resolveAnchorPath(target: EventTarget | null): string | null {
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
  return url.pathname
}

export function NavigationTransitionProvider() {
  useEffect(() => {
    const root = document.documentElement

    const onClick = (e: MouseEvent) => {
      // Modifier-key clicks open in a new tab — don't tag them.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      if (e.button !== 0) return
      if (e.defaultPrevented) return
      const path = resolveAnchorPath(e.target)
      if (!path) return
      // Same-path no-op = let it through without a transition.
      if (path === window.location.pathname) {
        delete root.dataset.direction
        return
      }
      if (isDrillInPath(path)) {
        root.dataset.direction = 'forward'
      } else {
        delete root.dataset.direction
      }
    }

    const onPopState = () => {
      // popstate covers browser back/forward AND router.back(). We
      // can't easily tell forward-popstate from back-popstate without
      // a navigation-id history stack; for now treat all popstate as
      // back. In practice forward-popstate is rare in this app
      // (drill-in pages don't have a forward-stack the user lands on).
      root.dataset.direction = 'back'
    }

    document.addEventListener('click', onClick, true)
    window.addEventListener('popstate', onPopState)
    return () => {
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('popstate', onPopState)
    }
  }, [])

  return null
}

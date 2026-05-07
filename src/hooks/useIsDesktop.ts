// src/hooks/useIsDesktop.ts
// Single source of truth for "is the viewport desktop-sized?".
// Returns true for ≥1100px (matches the breakpoint in globals.css).
//
// SSR: this is a client-only hook ('use client'). On the server we
// always emit the mobile tree because document.cookie isn't available
// to a client component during SSR. The device-class cookie set by
// src/proxy.ts is a CLIENT-side fast-path — it lets us synchronously
// return the correct value on the very first render after hydration,
// before window.matchMedia confirms in useEffect. Without the cookie
// hint, every desktop user would briefly see the mobile tree on first
// render. With it, only the first request before the cookie has been
// set sees the flicker.
//
// Once mounted, window.matchMedia confirms and the hook subscribes to
// changes (debounced 100ms so dragging the window across the threshold
// doesn't thrash React state).
//
// ── Expected hydration warning on the very first request ───────────
// Before src/proxy.ts has set the device-class cookie (i.e. on a
// brand-new visit with an empty cookie jar), `readInitialFromCookie`
// returns `false`. The server emits the mobile HTML, then the client
// mounts and `window.matchMedia` corrects to desktop — producing one
// hydration mismatch warning in the console. This is benign and does
// not repeat on subsequent loads (the cookie is now set). Don't try to
// "fix" it by switching to a server-only branch — that would force an
// ugly serverside UA-sniff into every page. The trade-off is documented
// in docs/superpowers/specs/2026-05-07-desktop-redesign-design.md
// (§ Top risks #1).

'use client'

import { useEffect, useState } from 'react'
import { readDeviceClassCookie } from '@/lib/device-class'

const BREAKPOINT_PX = 1100
const QUERY = `(min-width: ${BREAKPOINT_PX}px)`

function readInitialFromCookie(): boolean {
  if (typeof document === 'undefined') return false
  return readDeviceClassCookie(document.cookie) === 'desktop'
}

export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState<boolean>(readInitialFromCookie)

  useEffect(() => {
    const mql = window.matchMedia(QUERY)
    // Confirm immediately on mount (cookie may have been wrong, e.g. user
    // resized after first request, or UA sniff returned 'unknown').
    // Use functional setter to skip the re-render when the cookie guess
    // was already correct.
    setIsDesktop(prev => prev === mql.matches ? prev : mql.matches)

    let timer: ReturnType<typeof setTimeout> | undefined
    const onChange = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        setIsDesktop(prev => prev === mql.matches ? prev : mql.matches)
      }, 100)
    }
    mql.addEventListener('change', onChange)
    return () => {
      clearTimeout(timer)
      mql.removeEventListener('change', onChange)
    }
  }, [])

  return isDesktop
}

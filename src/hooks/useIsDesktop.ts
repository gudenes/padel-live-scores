'use client'

// Single source of truth for "is the viewport desktop-sized?".
// Returns true for ≥1100px (matches the breakpoint in globals.css).
//
// SSR-safe: first render reads the device-class cookie set by src/proxy.ts
// so the SSR HTML is close to what the client will paint. Once mounted,
// window.matchMedia confirms and the hook subscribes to changes.
//
// Resize is debounced 100ms so dragging the window across the threshold
// doesn't thrash React state.

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
    setIsDesktop(mql.matches)

    let timer: ReturnType<typeof setTimeout> | undefined
    const onChange = () => {
      clearTimeout(timer)
      timer = setTimeout(() => setIsDesktop(mql.matches), 100)
    }
    mql.addEventListener('change', onChange)
    return () => {
      clearTimeout(timer)
      mql.removeEventListener('change', onChange)
    }
  }, [])

  return isDesktop
}

'use client'
// src/hooks/useStickyHeaderVisibility.ts
//
// Shared scroll-direction hook. Returns `true` while the user is at the
// top of the page or scrolling UP, `false` while scrolling DOWN. Used to
// toggle the visibility of stacked sticky elements (GlobalHeader + the
// matches page's date-pill / filter strip) in sync — they show together
// when the user wants to navigate, hide together when they want to read.
//
// History: an earlier hide-on-scroll implementation lived inline in
// GlobalHeader and used `transform: translateY(-100%)` to slide the
// header off-screen. On iOS Capacitor it left a pointer dead-zone — the
// header animated back into view on scroll-up but stayed un-tappable
// until the user fully scrolled to the page top. Two changes here
// address that:
//   1. We deliberately ignore micro-scroll movements (< 6px delta) so
//      the visibility state doesn't thrash during inertial scrolling.
//      That kept the previous implementation flipping back to "hidden"
//      mid-scroll and never letting the transition complete cleanly.
//   2. Consumers should also set `pointer-events: none` when hidden so
//      taps during the transition don't get absorbed by the
//      offscreen element.

import { useEffect, useRef, useState } from 'react'

export function useStickyHeaderVisibility(): boolean {
  const [visible, setVisible] = useState(true)
  const lastScrollY = useRef(0)
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY
      // Near top → always visible. Avoids edge-cases on bounce-scroll
      // at the very top where y can briefly go negative on iOS.
      if (y < 10) {
        setVisible(true)
        lastScrollY.current = y
        return
      }
      const delta = y - lastScrollY.current
      // Ignore micro-movements (inertial dribble) to keep the state stable.
      if (Math.abs(delta) < 6) return
      setVisible(delta < 0)
      lastScrollY.current = y
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return visible
}

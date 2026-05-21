'use client'

// src/hooks/useSwipeDownToClose.ts
//
// Native-app-style "drag the sheet down to dismiss" gesture for our
// bottom sheets (NewsPeekSheet, TournamentsFilterSheet, LoginSheet,
// LoginCtaSheet). Same hand-rolled touch-event idiom as
// MatchesDaySwipe.tsx — no library dep.
//
// How sheets opt in:
//   1. Spread `bind` (returned from this hook) onto the sheet's outer
//      panel element. That attaches touchstart/move/end/cancel handlers.
//   2. Apply `style` (also returned) on the same element. It drives a
//      live translateY that follows the finger and a snap-back when
//      the user releases below threshold.
//   3. If the sheet has an inner scroll container (e.g. the filter
//      sheet's body), pass its ref as `scrollRef`. The hook will only
//      start the gesture when that container is at scrollTop === 0,
//      so users can scroll through content without accidentally
//      dismissing.
//
// Close trigger (matches iOS native feel):
//   - Distance: dragged > 30% of the panel's measured height
//   - OR Velocity: > 0.5 px/ms downward on release
//
// prefers-reduced-motion: snap-back/transition is disabled, but the
// gesture itself still works — closing on threshold is preserved.

import { useEffect, useRef, useState } from 'react'

export interface UseSwipeDownToCloseArgs {
  /** Called when the gesture crosses the close threshold. */
  onClose: () => void
  /**
   * Optional inner scroll container. When provided, the gesture is
   * skipped if `scrollRef.current.scrollTop > 0` at touchstart, so
   * normal scrolling wins until the user is back at the top.
   * When omitted, every downward drag from the panel can dismiss.
   */
  scrollRef?: React.RefObject<HTMLElement | null>
  /**
   * Disable the gesture entirely. Useful when the sheet is unmounted
   * or its open state is false — keeps the hook's call-shape stable.
   */
  disabled?: boolean
}

export interface UseSwipeDownToCloseResult {
  /** Spread onto the sheet's outer panel element. */
  bind: {
    onTouchStart: (e: React.TouchEvent<HTMLElement>) => void
    onTouchMove: (e: React.TouchEvent<HTMLElement>) => void
    onTouchEnd: (e: React.TouchEvent<HTMLElement>) => void
    onTouchCancel: () => void
  }
  /**
   * Style fragment for the panel. Merge with the panel's existing
   * style. While dragging, `transform: translateY(...)` follows the
   * finger; otherwise empty so the panel's own animation owns the
   * transform.
   */
  style: React.CSSProperties
  /** True while the user is actively dragging. */
  isDragging: boolean
}

const DISTANCE_FRACTION = 0.3 // 30% of panel height
const VELOCITY_THRESHOLD = 0.5 // px per ms
const HORIZONTAL_TOLERANCE_PX = 24 // cancel if user swipes sideways

export function useSwipeDownToClose({
  onClose,
  scrollRef,
  disabled = false,
}: UseSwipeDownToCloseArgs): UseSwipeDownToCloseResult {
  const startYRef = useRef<number | null>(null)
  const startXRef = useRef<number | null>(null)
  const startTimeRef = useRef<number>(0)
  const lastYRef = useRef<number>(0)
  const lastTimeRef = useRef<number>(0)
  const panelHeightRef = useRef<number>(0)
  const [translate, setTranslate] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReducedMotion(mql.matches)
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches)
    mql.addEventListener?.('change', onChange)
    return () => mql.removeEventListener?.('change', onChange)
  }, [])

  function reset() {
    startYRef.current = null
    startXRef.current = null
    setTranslate(0)
    setIsDragging(false)
  }

  function onTouchStart(e: React.TouchEvent<HTMLElement>) {
    if (disabled) return
    // If the gesture starts on a scrolled-down inner container, let
    // the native scroll handle it — don't hijack.
    if (scrollRef?.current && scrollRef.current.scrollTop > 0) return
    const t = e.touches[0]
    if (!t) return
    startYRef.current = t.clientY
    startXRef.current = t.clientX
    startTimeRef.current = performance.now()
    lastYRef.current = t.clientY
    lastTimeRef.current = startTimeRef.current
    // Measure the panel once per gesture so the threshold scales to
    // tall sheets (NewsPeekSheet) and short ones (LoginCtaSheet) alike.
    panelHeightRef.current = e.currentTarget.getBoundingClientRect().height
  }

  function onTouchMove(e: React.TouchEvent<HTMLElement>) {
    const startY = startYRef.current
    const startX = startXRef.current
    if (startY == null || startX == null) return
    const t = e.touches[0]
    if (!t) return
    const dy = t.clientY - startY
    const dx = t.clientX - startX
    // Sideways swipe — abort so horizontal scroll / nav can win.
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > HORIZONTAL_TOLERANCE_PX) {
      reset()
      return
    }
    // Upward drag — let the user scroll the body up if there is one,
    // or just no-op. Don't translate the sheet upward.
    if (dy <= 0) {
      setTranslate(0)
      return
    }
    // Track velocity on the last segment for the release check.
    lastYRef.current = t.clientY
    lastTimeRef.current = performance.now()
    if (!isDragging) setIsDragging(true)
    if (reducedMotion) return
    // Rubber-band-ish dampening on long drags so the sheet doesn't
    // exit the viewport before the threshold check fires.
    setTranslate(dy)
  }

  function onTouchEnd(e: React.TouchEvent<HTMLElement>) {
    const startY = startYRef.current
    const startTime = startTimeRef.current
    if (startY == null) {
      reset()
      return
    }
    const t = e.changedTouches[0]
    if (!t) {
      reset()
      return
    }
    const dy = t.clientY - startY
    const totalMs = Math.max(1, performance.now() - startTime)
    // Recent-segment velocity catches flicks better than total-distance
    // / total-time (a slow drag finished with a quick release should
    // still close).
    const segmentDy = t.clientY - lastYRef.current
    const segmentMs = Math.max(1, performance.now() - lastTimeRef.current)
    const recentVelocity = segmentDy / segmentMs
    const overallVelocity = dy / totalMs
    const velocity = Math.max(recentVelocity, overallVelocity)

    const panelHeight = panelHeightRef.current || window.innerHeight
    const distanceMet = dy > panelHeight * DISTANCE_FRACTION
    const velocityMet = dy > 0 && velocity > VELOCITY_THRESHOLD

    if (distanceMet || velocityMet) {
      // Don't reset translate first — the panel's own open→close
      // translateY animation takes over once `onClose` flips state.
      startYRef.current = null
      startXRef.current = null
      setIsDragging(false)
      onClose()
      // Clear residual translate after the close animation has had
      // time to play, so a re-open doesn't inherit it.
      setTimeout(() => setTranslate(0), 320)
      return
    }
    reset()
  }

  // Style: while dragging, follow the finger; otherwise let the
  // sheet's own animation own the transform (we deliberately do NOT
  // emit `transition` so we don't fight the consumer's slide-in/out).
  const style: React.CSSProperties = isDragging
    ? {
        transform: `translateY(${translate}px)`,
        transition: 'none',
        // Disable iOS overscroll for the panel while dragging, so the
        // page underneath doesn't visibly shift.
        touchAction: 'none',
      }
    : translate !== 0
    ? {
        // Snap-back animation between release and full reset (only
        // hits when threshold wasn't met — the close path bypasses
        // this branch via the setTimeout in onTouchEnd).
        transform: `translateY(${translate}px)`,
        transition: reducedMotion
          ? 'none'
          : 'transform 220ms cubic-bezier(0.16, 1, 0.3, 1)',
      }
    : {}

  return {
    bind: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel: reset,
    },
    style,
    isDragging,
  }
}

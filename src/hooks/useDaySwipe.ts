'use client'

// src/hooks/useDaySwipe.ts
//
// Touch-driven horizontal swipe gesture for navigating between days on
// /matches/[date]. Lives as a hook (rather than baked into MatchesDaySwipe)
// because the matches page wants to drag BOTH the body and the day-pill
// strip in lockstep — the user gets a real "the page is moving" feel
// instead of the pills sitting still while the body translates.
//
// Returns:
//   - touchHandlers: spread onto whatever element should capture touches
//     (typically the body wrapper).
//   - translate: live pixel offset (negative = swiping left toward
//     `nextIso`). Use this to apply transform: translateX(...) on the
//     body AND on the pill strip so they both follow the finger.
//
// Behaviour:
//   - Swipe left ≥ 80px → fires onSwipe(nextIso)
//   - Swipe right ≥ 80px → fires onSwipe(prevIso)
//   - Vertical drift > 18px aborts the gesture (vertical scroll wins)
//   - During the gesture, translate is clamped to ±48px for tactile
//     feedback without shoving the page off-screen.
//   - Respects prefers-reduced-motion: gesture still navigates, but
//     translate stays 0 so the UI doesn't drift.

import { useEffect, useRef, useState } from 'react'

const SWIPE_THRESHOLD_PX = 80
const VERTICAL_TOLERANCE_PX = 60
const MAX_TRACK_PX = 48

export interface DaySwipeOptions {
  prevIso: string
  nextIso: string
  onSwipe: (targetIso: string) => void
}

export interface DaySwipeBindings {
  touchHandlers: {
    onTouchStart: (e: React.TouchEvent<HTMLElement>) => void
    onTouchMove: (e: React.TouchEvent<HTMLElement>) => void
    onTouchEnd: (e: React.TouchEvent<HTMLElement>) => void
    onTouchCancel: () => void
  }
  /** Live translateX in pixels. 0 when not gesturing. */
  translate: number
  /** Live commitment progress in [-1, 1].
   *  +1 = fully toward `nextIso` (would commit on release).
   *  -1 = fully toward `prevIso`.
   *  0  = at rest. Drives the day-picker's lime indicator slide. */
  progress: number
  /** True while the user's finger is mid-swipe. Use to skip transition
   *  CSS so the page tracks the finger 1:1. */
  active: boolean
}

export function useDaySwipe(opts: DaySwipeOptions): DaySwipeBindings {
  const { prevIso, nextIso, onSwipe } = opts
  const startXRef = useRef<number | null>(null)
  const startYRef = useRef<number | null>(null)
  const [translate, setTranslate] = useState(0)
  const [progress, setProgress] = useState(0)
  const [active, setActive] = useState(false)
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
    startXRef.current = null
    startYRef.current = null
    setTranslate(0)
    setProgress(0)
    setActive(false)
  }

  function onTouchStart(e: React.TouchEvent<HTMLElement>) {
    const t = e.touches[0]
    if (!t) return
    startXRef.current = t.clientX
    startYRef.current = t.clientY
  }

  function onTouchMove(e: React.TouchEvent<HTMLElement>) {
    const startX = startXRef.current
    const startY = startYRef.current
    if (startX == null || startY == null) return
    const t = e.touches[0]
    if (!t) return
    const dx = t.clientX - startX
    const dy = t.clientY - startY
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 18) {
      reset()
      return
    }
    // Progress drives the day-picker's lime-indicator slide. Use the
    // raw delta (not the clamped translate) so the indicator hits the
    // target pill's centre exactly when the gesture would commit.
    // dx<0 = swiping toward nextIso → progress > 0.
    const p = Math.max(-1, Math.min(1, -dx / SWIPE_THRESHOLD_PX))
    setProgress(p)
    if (reducedMotion) {
      setActive(true)
      return
    }
    const clamped = Math.max(-MAX_TRACK_PX, Math.min(MAX_TRACK_PX, dx * 0.4))
    setTranslate(clamped)
    setActive(true)
  }

  function onTouchEnd(e: React.TouchEvent<HTMLElement>) {
    const startX = startXRef.current
    if (startX == null) {
      reset()
      return
    }
    const t = e.changedTouches[0]
    if (!t) {
      reset()
      return
    }
    const dx = t.clientX - startX
    const startY = startYRef.current ?? t.clientY
    const dy = t.clientY - startY

    const horizontalWon =
      Math.abs(dx) > Math.abs(dy) && Math.abs(dy) <= VERTICAL_TOLERANCE_PX
    if (horizontalWon && Math.abs(dx) >= SWIPE_THRESHOLD_PX) {
      onSwipe(dx < 0 ? nextIso : prevIso)
    }
    reset()
  }

  return {
    touchHandlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel: reset,
    },
    translate,
    progress,
    active,
  }
}

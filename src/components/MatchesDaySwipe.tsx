'use client'

// src/components/MatchesDaySwipe.tsx
//
// Touch-driven horizontal swipe gesture that navigates between adjacent
// days on /matches/[date]. Wraps the matches body so the user can flick
// left/right to jump dates without aiming at the small day pills.
//
// Behaviour:
//   - Swipe left → push to next day (prevIso prop)
//   - Swipe right → push to prev day
//   - Threshold: 80px horizontal travel, vertical drift kept under 60px
//     so vertical scroll wins when the user is just scrolling the list
//   - During the gesture, the wrapped content tracks the finger with a
//     subtle translateX (max ±48px) for tactile feedback. Snaps back on
//     release if the threshold wasn't met.
//   - Tapping the wrapper still works (normal click bubbles).
//   - Pointer events: only `touchstart`/`touchmove`/`touchend` so we
//     don't fight desktop drag-to-select. Mouse users stick to the day
//     pills.
//   - prefers-reduced-motion: skips the live-track follow but keeps
//     the swipe → navigate behaviour.

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useRouter } from '@/i18n/navigation'

const SWIPE_THRESHOLD_PX = 80
const VERTICAL_TOLERANCE_PX = 60
const MAX_TRACK_PX = 48

export interface MatchesDaySwipeProps {
  /** ISO `YYYY-MM-DD` of the previous day to navigate to on right-swipe. */
  prevIso: string
  /** ISO `YYYY-MM-DD` of the next day to navigate to on left-swipe. */
  nextIso: string
  /** Active locale — preserved across navigation. */
  locale: string
  children: ReactNode
}

export default function MatchesDaySwipe({
  prevIso,
  nextIso,
  locale,
  children,
}: MatchesDaySwipeProps) {
  const router = useRouter()
  const containerRef = useRef<HTMLDivElement>(null)
  const startXRef = useRef<number | null>(null)
  const startYRef = useRef<number | null>(null)
  const [translate, setTranslate] = useState(0)
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
  }

  function onTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    const t = e.touches[0]
    if (!t) return
    startXRef.current = t.clientX
    startYRef.current = t.clientY
  }

  function onTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    const startX = startXRef.current
    const startY = startYRef.current
    if (startX == null || startY == null) return
    const t = e.touches[0]
    if (!t) return
    const dx = t.clientX - startX
    const dy = t.clientY - startY
    // Vertical scroll wins when the user moves up/down more than they
    // moved horizontally — abort the gesture so the page can scroll.
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 18) {
      reset()
      return
    }
    if (reducedMotion) return
    // Clamp the live-track to ±MAX_TRACK_PX so the user gets feedback
    // without the whole page shoving off-screen.
    const clamped = Math.max(-MAX_TRACK_PX, Math.min(MAX_TRACK_PX, dx * 0.4))
    setTranslate(clamped)
  }

  function onTouchEnd(e: React.TouchEvent<HTMLDivElement>) {
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

    // Confirm horizontal-dominant gesture before navigating.
    const horizontalWon = Math.abs(dx) > Math.abs(dy) && Math.abs(dy) <= VERTICAL_TOLERANCE_PX
    if (horizontalWon && Math.abs(dx) >= SWIPE_THRESHOLD_PX) {
      const targetIso = dx < 0 ? nextIso : prevIso
      router.push(`/matches/${targetIso}`, { locale: locale as 'en' | 'es' | 'pt' | 'it' | 'fr' })
    }
    reset()
  }

  return (
    <div
      ref={containerRef}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={reset}
      style={{
        transform: translate ? `translateX(${translate}px)` : undefined,
        transition: translate ? 'none' : 'transform 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        touchAction: 'pan-y',
      }}
    >
      {children}
    </div>
  )
}
